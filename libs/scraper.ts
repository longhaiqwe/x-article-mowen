import { chromium } from 'playwright';
import type { Page } from 'playwright';
import TurndownService from 'turndown';

export interface ScrapedResult {
    title: string;
    markdownContent: string;
    url: string;
}

export class XScraper {
    private cookieStr: string;

    constructor(cookieStr: string) {
        this.cookieStr = cookieStr;
    }

    /**
     * Parse raw cookie string to Playwright Cookie objects
     */
    private parseCookies(cookieStr: string, domain: string = '.x.com') {
        return cookieStr.split(';').map(pair => {
            const eqIdx = pair.trim().indexOf('=');
            const name = eqIdx >= 0 ? pair.trim().slice(0, eqIdx) : pair.trim();
            const value = eqIdx >= 0 ? pair.trim().slice(eqIdx + 1) : '';
            return {
                name: name.trim(),
                value: value.trim(),
                domain: domain,
                path: '/',
            };
        });
    }

    /**
     * Extracts text content from a specific X article page 
     */
    public async scrapeArticle(url: string, isHeadless: boolean = true): Promise<ScrapedResult> {
        const browser = await chromium.launch({ headless: isHeadless });
        const context = await browser.newContext();

        if (this.cookieStr) {
            const cookies = this.parseCookies(this.cookieStr);
            await context.addCookies(cookies);
        }

        const page = await context.newPage();

        try {
            console.log(`Navigating to ${url}...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Need to wait for article content to load
            console.log('Waiting for content to render...');
            // Wait for typical tweet content div or article text block
            await page.waitForSelector('article', { state: 'attached', timeout: 30000 });

            // Extract the DOM content for the specific article.
            // Note: X DOM is notoriously obscure. We rely on the `[data-testid="tweetText"]` 
            // and `[data-testid="tweet"]` usually used for tweets.
            // For long "Articles", the DOM might use different test ids like `[data-testid="article"]`.

            // Attempt to get the main article block or the first tweet content
            const articleElement = await page.$('article');
            let rawHtml = '';
            let title = 'X Article'; // Fallback if no specific title is found

            if (articleElement) {
                // Remove unwanted UI elements from the DOM before turndown parsing
                await articleElement.evaluate((el: HTMLElement) => {
                    // Remove elements that look like action bars or view counts
                    const toRemove = el.querySelectorAll('[role="group"], [aria-label*="View"], [aria-label*="Reply"], [aria-label*="Like"], [aria-label*="Repost"]');
                    toRemove.forEach(n => n.remove());
                });

                // Extract the title from h1
                const h1 = await articleElement.$('h1');
                if (h1) {
                    const h1Text = await h1.innerText();
                    if (h1Text) {
                        title = h1Text.trim();
                        // Remove the h1 from the body so it isn't duplicated
                        await h1.evaluate(node => node.remove());
                    }
                }

                // For Note Tweets / Long Form, we want to extract paragraph by paragraph
                // Sometimes X wraps them in spans inside divs. We'll extract raw text as well just in case.
                const textNodes = await articleElement.$$eval('[data-testid="tweetText"]', nodes => nodes.map(n => n.innerHTML));
                if (textNodes.length > 0) {
                    rawHtml = textNodes.join('<br><br>');
                } else {
                    rawHtml = await articleElement.innerHTML() || '';
                }
            }

            const turndownService = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced'
            });

            // Custom rule to handle X images better
            turndownService.addRule('xImages', {
                filter: 'img',
                replacement: function (content, node: any) {
                    const src = node.getAttribute('src');
                    const alt = node.getAttribute('alt') || '';
                    if (src && src.includes('pbs.twimg.com/media')) {
                        return `\n\n![${alt}](${src})\n\n`;
                    }
                    if (src && src.includes('profile_images')) {
                        return '';
                    }
                    return `![${alt}](${src || ''})`;
                }
            });

            turndownService.addRule('emptyLinks', {
                filter: 'a',
                replacement: function (content, node) {
                    return content.trim();
                }
            });

            let markdownContent = turndownService.turndown(rawHtml);

            // Clean up excessive newlines
            markdownContent = markdownContent.replace(/\n{3,}/g, '\n\n').trim();

            // Remove X article UI noise patterns
            // 1. Upgrade prompt
            markdownContent = markdownContent.replace(/Want to publish your own Article\?\s*\n+Upgrade to Premium\s*/gi, '');
            // 2. View count (e.g. "3.1M\n\nViews" or "396K\n\nViews")
            markdownContent = markdownContent.replace(/[\d,.]+[KMB]?\s*\n+Views\s*/gi, '');
            // 4. Reply count (e.g. "Read 396 replies")
            markdownContent = markdownContent.replace(/Read \d+ repl(?:y|ies)\s*/gi, '');

            // Final cleanup after removals
            markdownContent = markdownContent.replace(/\n{3,}/g, '\n\n').trim();

            return {
                title,
                markdownContent,
                url
            };

        } catch (error) {
            console.error('Error during scraping:', error);
            throw error;
        } finally {
            await browser.close();
        }
    }
}
