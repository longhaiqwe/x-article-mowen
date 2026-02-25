import { XScraper } from './scraper.js';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('Starting scraper...');

    // Load cookie from environment to bypass login wall
    const cookie = process.env.X_COOKIE || '';
    const scraper = new XScraper(cookie);

    try {
        const url = process.argv[2] || 'https://x.com/DanKoe/status/1893977536340660608';
        const result = await scraper.scrapeArticle(url, true);

        console.log('--- TITLE ---');
        console.log(result.title);

        console.log('\n--- MARKDOWN ---');
        console.log(result.markdownContent);

        fs.writeFileSync('output-test.md', result.markdownContent);
        console.log('Saved to output-test.md');
    } catch (e) {
        console.error(e);
    }
}

main();
