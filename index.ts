import { XScraper } from './libs/scraper.js';
import { Translator } from './libs/translator.js';
import type { ModelConfig } from './libs/translator.js';
import { MowenPublisher } from './libs/mowen.js';
import * as dotenv from 'dotenv';

dotenv.config();

const X_COOKIE = process.env.X_COOKIE || '';
const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_BASE_URL = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const ARK_MODELS: ModelConfig = {
    literal: process.env.ARK_MODEL_LITERAL || 'doubao-seed-2-0-mini-260215',
    issues: process.env.ARK_MODEL_ISSUES || 'doubao-seed-2-0-pro-260215',
    freeTranslation: process.env.ARK_MODEL_FREE_TRANSLATION || 'doubao-seed-2-0-lite-260215',
};
const MOWEN_API_KEY = process.env.MOWEN_API_KEY || '';
const MOWEN_SPACE_ID = process.env.MOWEN_SPACE_ID || '';

async function main() {
    const url = process.argv[2];
    if (!url) {
        console.error('Usage: npx tsx index.ts <x_article_url>');
        process.exit(1);
    }

    if (!MOWEN_API_KEY || !MOWEN_SPACE_ID) {
        console.error('⚠️ Warning: MOWEN_API_KEY and MOWEN_SPACE_ID are missing in .env. Execution will dry-run or fail at publishing phase.');
    }

    console.log('====================================');
    console.log(`🚀 X Article -> Mowen Publisher`);
    console.log('====================================\n');

    // 1. Scrape Article
    console.log('--- Phase 1: Data Ingestion (Scraping) ---');
    const scraper = new XScraper(X_COOKIE);
    const scrapedData = await scraper.scrapeArticle(url, true); // true for headless
    console.log(`✅ Scraped Title: ${scrapedData.title}`);
    console.log(`✅ Text Length: ${scrapedData.markdownContent.length} characters\n`);

    // 2. Translate Markdown
    console.log('--- Phase 2: AI Translation Engine (三步法: Literal -> Issues -> Free) ---');
    const translator = new Translator(ARK_API_KEY, ARK_BASE_URL, ARK_MODELS);
    console.log(`🤖 Models: Literal=${ARK_MODELS.literal}, Issues=${ARK_MODELS.issues}, Free=${ARK_MODELS.freeTranslation}`);

    const translatedData = await translator.translateByParagraphs(scrapedData.markdownContent);
    console.log(`✅ Final Translated Article: ${translatedData.finalArticle.length} chars\n`);

    // 3. Publish to Mowen
    console.log('--- Phase 3: Mowen Publisher ---');
    if (!MOWEN_API_KEY) {
        console.log('⏭️ Skipping publish step because MOWEN_API_KEY is not set.');
        console.log('\nFinal Refined Output Preview:\n');
        console.log(translatedData.finalArticle.substring(0, 1000) + '...\n');
        return;
    }

    const publisher = new MowenPublisher(MOWEN_API_KEY, MOWEN_SPACE_ID);
    // Determine the title - we can use the original or ask AI to translate it earlier.
    // For now, using Original Title + "(中文版)"
    const translatedTitle = `${scrapedData.title} (中文翻译)`;

    try {
        await publisher.publishNote(translatedTitle, translatedData.finalArticle);
        console.log('✅ Publication Workflow Completed Successfully!');
    } catch (e) {
        console.error('❌ Failed to publish to Mowen:', (e as Error).message);
    }
}

main();
