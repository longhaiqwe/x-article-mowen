import { XScraper } from './libs/scraper.js';

async function main() {
    const scraper = new XScraper('');
    try {
        const res = await scraper.scrapeArticle('https://simonwillison.net/2026/Feb/25/claude-code-remote-control/');
        console.log('Title:', res.title);
        console.log('Content preview:', res.markdownContent.substring(0, 500));
        console.log('SUCCESS');
    } catch (e) {
        console.error('FAILED', e);
    }
}
main();
