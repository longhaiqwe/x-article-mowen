import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { XScraper } from './libs/scraper.js';
import { Translator } from './libs/translator.js';
import type { ModelConfig } from './libs/translator.js';
import { MowenPublisher } from './libs/mowen.js';
import { prisma } from './libs/db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const X_COOKIE = process.env.X_COOKIE || '';
const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_BASE_URL = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const ARK_MODELS: ModelConfig = {
    draft: process.env.ARK_MODEL_DRAFT || 'doubao-seed-translation-250915',
    reviewFluency: process.env.ARK_MODEL_REVIEW_FLUENCY || 'glm-4-7-251222',
    reviewAccuracy: process.env.ARK_MODEL_REVIEW_ACCURACY || 'deepseek-v3-2-251201',
    reviewStyle: process.env.ARK_MODEL_REVIEW_STYLE || 'kimi-k2-thinking-251104',
    synthesis: process.env.ARK_MODEL_SYNTHESIS || 'deepseek-v3-2-251201',
    final: process.env.ARK_MODEL_FINAL || 'doubao-seed-1-6-251015',
};
const MOWEN_API_KEY = process.env.MOWEN_API_KEY || '';
const MOWEN_SPACE_ID = process.env.MOWEN_SPACE_ID || '';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api'; // 例如 'http://localhost:11434/v1' 也可以兼容 openai SDK

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

// ── Step 2: Draft ──────────────────────────────────────────────
async function handleDraft(markdown: string, res: http.ServerResponse) {
    initSSE(res);
    try {
        sendEvent(res, 'status', { message: '开始初步改写...' });
        const translator = new Translator(ARK_API_KEY, ARK_BASE_URL, ARK_MODELS);

        const draft = await translator.draftTranslate(
            markdown,
            (chunk) => sendEvent(res, `stage_chunk`, { stage: 'draft', chunk })
        );
        sendEvent(res, 'stage_complete', { stage: 'draft', content: draft });
        sendEvent(res, 'done', { message: '初步改写完成' });
    } catch (e) {
        sendEvent(res, 'error', { message: `初步改写失败：${(e as Error).message}` });
    } finally {
        res.end();
    }
}

// ── Step 3: Review ─────────────────────────────────────────────
async function handleReview(original: string, draft: string, res: http.ServerResponse) {
    initSSE(res);
    try {
        sendEvent(res, 'status', { message: '开始并行评审...' });
        const translator = new Translator(ARK_API_KEY, ARK_BASE_URL, ARK_MODELS);

        const [fluency, accuracy, style] = await Promise.all([
            translator.reviewFluency(original, draft, (c) => sendEvent(res, 'stage_chunk', { stage: 'review_fluency', chunk: c })),
            translator.reviewAccuracy(original, draft, (c) => sendEvent(res, 'stage_chunk', { stage: 'review_accuracy', chunk: c })),
            translator.reviewStyle(original, draft, (c) => sendEvent(res, 'stage_chunk', { stage: 'review_style', chunk: c }))
        ]);

        sendEvent(res, 'stage_complete', { stage: 'reviews', content: { fluency, accuracy, style } });
        sendEvent(res, 'done', { message: '评审完毕' });
    } catch (e) {
        sendEvent(res, 'error', { message: `评审失败：${(e as Error).message}` });
    } finally {
        res.end();
    }
}

// ── Step 4: Synthesis ──────────────────────────────────────────
async function handleSynthesis(original: string, draft: string, reviews: { fluency: string; accuracy: string; style: string }, res: http.ServerResponse) {
    initSSE(res);
    try {
        sendEvent(res, 'status', { message: '开始综合改写...' });
        const translator = new Translator(ARK_API_KEY, ARK_BASE_URL, ARK_MODELS);

        const synth = await translator.synthesizeReviews(
            original,
            draft,
            reviews,
            (c) => sendEvent(res, 'stage_chunk', { stage: 'synthesis', chunk: c })
        );
        sendEvent(res, 'stage_complete', { stage: 'synthesis', content: synth });
        sendEvent(res, 'done', { message: '综合改写完成' });
    } catch (e) {
        sendEvent(res, 'error', { message: `综合处理失败：${(e as Error).message}` });
    } finally {
        res.end();
    }
}

// ── Step 5: Final Polish ───────────────────────────────────────
async function handleFinalPolish(synth: string, res: http.ServerResponse) {
    initSSE(res);
    try {
        sendEvent(res, 'status', { message: '开始最终润色...' });
        const translator = new Translator(ARK_API_KEY, ARK_BASE_URL, ARK_MODELS);

        const finalContent = await translator.finalPolish(
            synth,
            (c) => sendEvent(res, 'stage_chunk', { stage: 'final', chunk: c })
        );
        sendEvent(res, 'stage_complete', { stage: 'final', content: finalContent });
        sendEvent(res, 'done', { message: '最终润色完成' });
    } catch (e) {
        sendEvent(res, 'error', { message: `润色失败：${(e as Error).message}` });
    } finally {
        res.end();
    }
}

// ── Step 4.5 (Alternative): Paragraph Translate ──────────────────────────
async function handleParagraphTranslate(markdown: string, res: http.ServerResponse) {
    initSSE(res);
    try {
        sendEvent(res, 'status', { message: '开始逐段分析与翻译...' });
        const translator = new Translator(ARK_API_KEY, ARK_BASE_URL, ARK_MODELS);

        // 如果有 url flag 参数，比如 mode=ollama，可以传给 translateByParagraphs
        const result = await translator.translateByParagraphs(
            markdown,
            (event, data) => sendEvent(res, event, data),
            (index, step, chunk) => sendEvent(res, 'paragraph_chunk', { index, step, chunk })
        );

        sendEvent(res, 'stage_complete', { stage: 'paragraph_translate', content: result.finalArticle });
        sendEvent(res, 'done', { message: '逐段翻译完成' });
    } catch (e) {
        sendEvent(res, 'error', { message: `逐段翻译失败：${(e as Error).message}` });
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

    // Step 2: POST /process/draft
    if (pathname === '/process/draft' && req.method === 'POST') {
        const body = await readBody(req);
        const { markdown } = JSON.parse(body);
        if (!markdown) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing markdown' })); return; }
        await handleDraft(markdown, res);
        return;
    }

    // Step 3: POST /process/review
    if (pathname === '/process/review' && req.method === 'POST') {
        const body = await readBody(req);
        const { original, draft } = JSON.parse(body);
        if (!original || !draft) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing original or draft' })); return; }
        await handleReview(original, draft, res);
        return;
    }

    // Step 4: POST /process/synthesis
    if (pathname === '/process/synthesis' && req.method === 'POST') {
        const body = await readBody(req);
        const { original, draft, reviews } = JSON.parse(body);
        if (!original || !draft || !reviews) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing specific params' })); return; }
        await handleSynthesis(original, draft, reviews, res);
        return;
    }

    // Step 5: POST /process/final
    if (pathname === '/process/final' && req.method === 'POST') {
        const body = await readBody(req);
        const { synthesis } = JSON.parse(body);
        if (!synthesis) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing synthesis payload' })); return; }
        await handleFinalPolish(synthesis, res);
        return;
    }

    // Step 5.5: POST /process/paragraph-translate
    if (pathname === '/process/paragraph-translate' && req.method === 'POST') {
        const body = await readBody(req);
        const { markdown, backend } = JSON.parse(body);
        if (!markdown) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing markdown payload' })); return; }

        initSSE(res);
        try {
            sendEvent(res, 'status', { message: `开始逐段分析与翻译 (${backend === 'ollama' ? '本地 Ollama' : '云端模型'})...` });

            // 我们只需要传标记即可，Translator 的实现会通过第四个参数将首步直译重发给 Ollama，
            // 而保留问题分析、意译和修饰发往默认大模型 (Volcengine/DeepSeek)。
            let activeTranslator = new Translator(ARK_API_KEY, ARK_BASE_URL, ARK_MODELS);
            // 为了简单直接，我们可以把 backend 标记传进 translator (或者在这里修改 translator)
            // 修改 Translator 以支持局部切本地模型
            const result = await activeTranslator.translateByParagraphs(
                markdown,
                (event, data) => sendEvent(res, event, data),
                (index, step, chunk) => sendEvent(res, 'paragraph_chunk', { index, step, chunk }),
                backend === 'ollama' ? 'hf.co/mradermacher/translategemma-4b-it-GGUF' : undefined // 如果有需要本地的就在这个参数传
            );

            sendEvent(res, 'stage_complete', { stage: 'paragraph_translate', content: result.finalArticle });
            sendEvent(res, 'done', { message: '逐段翻译完成' });
        } catch (e) {
            sendEvent(res, 'error', { message: `逐段翻译失败：${(e as Error).message}` });
        } finally {
            res.end();
        }
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

    // ── Database History API ───────────────────────────────────────
    if (pathname === '/api/history' && req.method === 'GET') {
        try {
            const records = await prisma.translationRecord.findMany({
                orderBy: { updatedAt: 'desc' },
                take: 50,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(records));
        } catch (e) {
            res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
        }
        return;
    }

    if (pathname === '/api/history' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        if (!data.url) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing url' })); return; }

        try {
            let record = await prisma.translationRecord.findFirst({ where: { url: data.url } });
            if (record) {
                record = await prisma.translationRecord.update({
                    where: { id: record.id },
                    data: {
                        title: data.title !== undefined ? data.title : undefined,
                        originalContent: data.originalContent !== undefined ? data.originalContent : undefined,
                        translatedContent: data.translatedContent !== undefined ? data.translatedContent : undefined,
                        status: data.status !== undefined ? data.status : undefined,
                        errorMessage: data.errorMessage !== undefined ? data.errorMessage : undefined
                    }
                });
            } else {
                record = await prisma.translationRecord.create({
                    data: {
                        url: data.url,
                        title: data.title,
                        originalContent: data.originalContent,
                        translatedContent: data.translatedContent,
                        status: data.status || 'PENDING',
                        errorMessage: data.errorMessage
                    }
                });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(record));
        } catch (e) {
            res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
        }
        return;
    }

    // ── 404 Fallback ────────────────────────────────────────────────
    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`\n🚀 X Article → Mowen 可视化服务已启动`);
    console.log(`📡 访问地址: http://localhost:${PORT}\n`);
    console.log('📋 调试模式：步骤可单独手动触发');
    console.log('   GET  /scrape?url=...   → Step 1 抓取原文');
    console.log('   POST /process/draft    → Step 2 初稿');
    console.log('   POST /process/review   → Step 3 并行评审');
    console.log('   POST /process/synthesis→ Step 4 综合改写');
    console.log('   POST /process/final    → Step 5 润色');
    console.log('   POST /publish          → Step 3 提取信息发布\n');
});
