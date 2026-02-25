import { XScraper } from './libs/scraper.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const X_COOKIE = process.env.X_COOKIE || '';
const TEST_URL = 'https://twitter.com/thedankoe/status/2023779299367809063';

async function main() {
    if (!X_COOKIE) {
        console.warn('⚠️ Warning: No X_COOKIE found in .env. Attempting headless scrape without auth.');
        console.warn('To extract full X Articles properly, please set X_COOKIE="your_cookie_string" in .env');
    }

    const scraper = new XScraper(X_COOKIE);

    console.log(`Starting to scrape: ${TEST_URL}`);
    try {
        const result = await scraper.scrapeArticle(TEST_URL, false); // false for headless so we can see what's happening
        console.log('\n--- Scraping Result ---');
        console.log(`Title: ${result.title}`);
        console.log('\nMarkdown Preview:\n');
        console.log(result.markdownContent.substring(0, 500) + (result.markdownContent.length > 500 ? '...\n' : '\n'));
        console.log('-----------------------');

        // Save to file for easy review
        fs.writeFileSync('output-test.md', `# ${result.title}\n\n${result.markdownContent}`);
        console.log('✅ Full output saved to output-test.md');

    } catch (error) {
        console.error('❌ Scraping failed:', error);
    }
}

main();
