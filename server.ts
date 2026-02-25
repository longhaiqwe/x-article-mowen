import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { XScraper } from './libs/scraper.js';
import { Translator } from './libs/translator.js';
import { MowenPublisher } from './libs/mowen.js';

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

// ── Step 2-4: Translate & Review & Refine Pipeline ────────────────
async function handleProcessPipeline(markdown: string, res: http.ServerResponse) {
    initSSE(res);
    try {
        sendEvent(res, 'status', { message: '初始化翻译 AI...' });
        const translator = new Translator(OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL);

        await translator.translateMarkdown(
            markdown,
            (stage, content) => {
                // When a stage is complete
                sendEvent(res, `stage_complete`, { stage, content });
            },
            (stage, chunk) => {
                // Real-time streaming chunks
                sendEvent(res, `stage_chunk`, { stage, chunk });
            }
        );
        sendEvent(res, 'done', { message: '翻译评审流程完毕！' });
    } catch (e) {
        sendEvent(res, 'error', { message: `AI处理失败：${(e as Error).message}` });
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

    // Step 2: POST /process  body: { markdown }
    if (pathname === '/process' && req.method === 'POST') {
        const body = await readBody(req);
        const { markdown } = JSON.parse(body);
        if (!markdown) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing markdown' })); return; }
        await handleProcessPipeline(markdown, res);
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
    console.log('   GET  /scrape?url=...   → Step 1 抓取原文');
    console.log('   POST /process          → Step 2 初译、评审及最终润色（全自动）');
    console.log('   POST /publish          → Step 3 提取信息发布\n');
});
