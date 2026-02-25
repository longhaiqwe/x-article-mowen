import { XScraper } from './libs/scraper';
import { Translator } from './libs/translator';
import { MowenPublisher } from './libs/mowen';
import * as dotenv from 'dotenv';

dotenv.config();

const X_COOKIE = process.env.X_COOKIE || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
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
    console.log('--- Phase 2: AI Translation Engine ---');
    const translator = new Translator(OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL);
    console.log(`🤖 Using Model: ${OPENAI_MODEL}`);

    // Note: If the text is extremely long (e.g. 50,000 words), it may exceed token limits.
    // In a production environment, you would split the markdown into chunks here before passing to translator.
    const translatedData = await translator.translateMarkdown(scrapedData.markdownContent);
    console.log(`✅ Literal Translation: ${translatedData.literalTranslation.length} chars`);
    console.log(`✅ Refined Translation: ${translatedData.refinedTranslation.length} chars\n`);

    // 3. Publish to Mowen
    console.log('--- Phase 3: Mowen Publisher ---');
    if (!MOWEN_API_KEY) {
        console.log('⏭️ Skipping publish step because MOWEN_API_KEY is not set.');
        console.log('\nFinal Refined Output Preview:\n');
        console.log(translatedData.refinedTranslation.substring(0, 1000) + '...\n');
        return;
    }

    const publisher = new MowenPublisher(MOWEN_API_KEY, MOWEN_SPACE_ID);
    // Determine the title - we can use the original or ask AI to translate it earlier.
    // For now, using Original Title + "(中文版)"
    const translatedTitle = `${scrapedData.title} (中文翻译)`;

    try {
        const publishResult = await publisher.publishNote(translatedTitle, translatedData.refinedTranslation);
        console.log('✅ Publication Workflow Completed Successfully!');
    } catch (e) {
        console.error('❌ Failed to publish to Mowen:', (e as Error).message);
    }
}

main();
