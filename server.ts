import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { XScraper } from './libs/scraper.ts';
import { Translator } from './libs/translator.ts';
import { MowenPublisher } from './libs/mowen.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const X_COOKIE = process.env.X_COOKIE || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MOWEN_API_KEY = process.env.MOWEN_API_KEY || '';
const MOWEN_SPACE_ID = process.env.MOWEN_SPACE_ID || '';

const PORT = 3000;

/**
 * 发送 SSE 事件到客户端
 */
function sendEvent(res: http.ServerResponse, event: string, data: unknown) {
    const payload = JSON.stringify(data);
    res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

/**
 * 主处理流程，通过 SSE 推送各阶段结果
 */
async function processArticle(url: string, res: http.ServerResponse) {
    try {
        // Phase 1: Scrape
        sendEvent(res, 'status', { phase: 'scraping', message: '正在抓取原文...' });
        const scraper = new XScraper(X_COOKIE);
        const scrapedData = await scraper.scrapeArticle(url, true);
        sendEvent(res, 'scraped', {
            title: scrapedData.title,
            content: scrapedData.markdownContent,
            url: scrapedData.url,
        });

        // Phase 2: Translate
        sendEvent(res, 'status', { phase: 'translating', message: '正在进行直译...' });
        const translator = new Translator(OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL);

        const translatedData = await translator.translateMarkdown(
            scrapedData.markdownContent,
            (stage, content) => {
                if (stage === 'literal') {
                    sendEvent(res, 'literal', { content });
                    sendEvent(res, 'status', { phase: 'refining', message: '正在进行润色...' });
                } else if (stage === 'refined') {
                    sendEvent(res, 'refined', { content });
                }
            }
        );

        // Phase 3: Publish to Mowen
        if (!MOWEN_API_KEY) {
            sendEvent(res, 'published', {
                success: false,
                message: '未配置 MOWEN_API_KEY，跳过发布步骤。',
            });
        } else {
            sendEvent(res, 'status', { phase: 'publishing', message: '正在发布到墨问...' });
            const publisher = new MowenPublisher(MOWEN_API_KEY, MOWEN_SPACE_ID);
            const translatedTitle = `${scrapedData.title} (中文翻译)`;
            try {
                const result = await publisher.publishNote(
                    translatedTitle,
                    translatedData.refinedTranslation,
                    false // 默认非公开
                );
                sendEvent(res, 'published', {
                    success: true,
                    noteId: result?.data?.noteId || result?.noteId || null,
                    message: '已成功发布到墨问（非公开）',
                });
            } catch (e) {
                sendEvent(res, 'published', {
                    success: false,
                    message: `发布失败：${(e as Error).message}`,
                });
            }
        }

        sendEvent(res, 'done', { message: '处理完成！' });
    } catch (error) {
        sendEvent(res, 'error', { message: `处理出错：${(error as Error).message}` });
    } finally {
        res.end();
    }
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;

    // 静态文件服务
    if (pathname === '/' || pathname === '/index.html') {
        const filePath = path.join(__dirname, 'public', 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    // SSE 处理流程接口
    if (pathname === '/process') {
        const articleUrl = parsedUrl.searchParams.get('url');
        if (!articleUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing url parameter' }));
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });

        processArticle(articleUrl, res);
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`\n🚀 X Article -> Mowen 可视化服务已启动`);
    console.log(`📡 访问地址: http://localhost:${PORT}\n`);
});
