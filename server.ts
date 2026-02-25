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

/** 发送 SSE 事件 */
function sendEvent(res: http.ServerResponse, event: string, data: unknown) {
    const payload = JSON.stringify(data);
    res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

/** 设置 SSE 响应头 */
function initSSE(res: http.ServerResponse) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
}

/** 读取 POST body */
async function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

// ── Step 1: Scrape ──────────────────────────────────────────────
async function handleScrape(url: string, res: http.ServerResponse) {
    initSSE(res);
    try {
        sendEvent(res, 'status', { message: '正在抓取原文...' });
        const scraper = new XScraper(X_COOKIE);
        const data = await scraper.scrapeArticle(url, true);
        sendEvent(res, 'scraped', {
            title: data.title,
            content: data.markdownContent,
            url: data.url,
        });
        sendEvent(res, 'done', { message: '抓取完成' });
    } catch (e) {
        sendEvent(res, 'error', { message: `抓取失败：${(e as Error).message}` });
    } finally {
        res.end();
    }
}

// ── Step 2: Translate (literal) ─────────────────────────────────
async function handleTranslate(markdown: string, res: http.ServerResponse) {
    initSSE(res);
    try {
        sendEvent(res, 'status', { message: '正在直译...' });
        const translator = new Translator(OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL);
        let literalContent = '';
        await translator.translateMarkdown(
            markdown,
            (stage, content) => {
                if (stage === 'literal') {
                    literalContent = content;
                    sendEvent(res, 'literal', { content });
                }
            },
            (stage, chunk) => {
                if (stage === 'literal') {
                    sendEvent(res, 'literal_chunk', { chunk });
                }
            }
        );
        sendEvent(res, 'done', { message: '直译完成' });
    } catch (e) {
        sendEvent(res, 'error', { message: `直译失败：${(e as Error).message}` });
    } finally {
        res.end();
    }
}

// ── Step 3: Refine ──────────────────────────────────────────────
async function handleRefine(original: string, literal: string, res: http.ServerResponse) {
    initSSE(res);
    try {
        sendEvent(res, 'status', { message: '正在润色...' });
        const translator = new Translator(OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL);
        await translator.refineMarkdown(
            original,
            literal,
            (content: string) => {
                sendEvent(res, 'refined', { content });
            },
            (chunk: string) => {
                sendEvent(res, 'refined_chunk', { chunk });
            }
        );
        sendEvent(res, 'done', { message: '润色完成' });
    } catch (e) {
        sendEvent(res, 'error', { message: `润色失败：${(e as Error).message}` });
    } finally {
        res.end();
    }
}

// ── Step 4: Publish ─────────────────────────────────────────────
async function handlePublish(title: string, markdown: string, res: http.ServerResponse) {
    initSSE(res);
    if (!MOWEN_API_KEY) {
        sendEvent(res, 'published', { success: false, message: '未配置 MOWEN_API_KEY，跳过发布。' });
        res.end();
        return;
    }
    try {
        sendEvent(res, 'status', { message: '正在发布到墨问...' });
        const publisher = new MowenPublisher(MOWEN_API_KEY, MOWEN_SPACE_ID);
        const result = await publisher.publishNote(title, markdown, false);
        sendEvent(res, 'published', {
            success: true,
            noteId: result?.data?.noteId || result?.noteId || null,
            message: '已成功发布到墨问（非公开）',
        });
    } catch (e) {
        sendEvent(res, 'published', { success: false, message: `发布失败：${(e as Error).message}` });
    } finally {
        res.end();
    }
}

// ── HTTP Server ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;

    // 静态文件
    if (pathname === '/' || pathname === '/index.html') {
        const filePath = path.join(__dirname, 'public', 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); res.end('Not Found'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end();
        return;
    }

    // Step 1: GET /scrape?url=...
    if (pathname === '/scrape' && req.method === 'GET') {
        const articleUrl = parsedUrl.searchParams.get('url');
        if (!articleUrl) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing url' })); return; }
        await handleScrape(articleUrl, res);
        return;
    }

    // Step 2: POST /translate  body: { markdown }
    if (pathname === '/translate' && req.method === 'POST') {
        const body = await readBody(req);
        const { markdown } = JSON.parse(body);
        if (!markdown) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing markdown' })); return; }
        await handleTranslate(markdown, res);
        return;
    }

    // Step 3: POST /refine  body: { original, literal }
    if (pathname === '/refine' && req.method === 'POST') {
        const body = await readBody(req);
        const { original, literal } = JSON.parse(body);
        if (!literal) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing literal' })); return; }
        await handleRefine(original || '', literal, res);
        return;
    }

    // Step 4: POST /publish  body: { title, markdown }
    if (pathname === '/publish' && req.method === 'POST') {
        const body = await readBody(req);
        const { title, markdown } = JSON.parse(body);
        if (!markdown) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing markdown' })); return; }
        await handlePublish(title || 'X Article (中文翻译)', markdown, res);
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`\n🚀 X Article → Mowen 可视化服务已启动`);
    console.log(`📡 访问地址: http://localhost:${PORT}\n`);
    console.log('📋 调试模式：步骤可单独手动触发');
    console.log('   GET  /scrape?url=...   → Step 1 抓取');
    console.log('   POST /translate        → Step 2 直译');
    console.log('   POST /refine           → Step 3 润色');
    console.log('   POST /publish          → Step 4 发布\n');
});
