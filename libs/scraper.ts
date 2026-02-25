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
            let preParsedMarkdown = '';  // set by tweetText DOM path, skips Turndown
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

                // Custom in-browser DOM → Markdown converter for tweetText.
                // Using Turndown caused inline <a> elements to be orphaned into
                // separate paragraphs when X wraps them in block-level containers.
                // We solve this by walking the DOM directly in the browser context.
                const tweetMarkdowns = await articleElement.$$eval(
                    '[data-testid="tweetText"]',
                    (nodes) => nodes.map((root) => {
                        /**
                         * Recursively converts a DOM subtree to inline markdown.
                         * Inside a tweetText block, ALL elements are treated as inline —
                         * X renders each text fragment and link inside block-level <div>/<span>,
                         * but semantically they belong to one continuous paragraph.
                         * Only <br> creates a newline (paragraph break).
                         */
                        function domToMd(el: Node): string {
                            if (el.nodeType === Node.TEXT_NODE) {
                                return el.textContent || '';
                            }
                            if (el.nodeType !== Node.ELEMENT_NODE) return '';

                            const elem = el as Element;
                            const tag = elem.tagName.toLowerCase();

                            // Skip unwanted tags
                            if (['script', 'style', 'svg'].includes(tag)) return '';

                            // <br> → paragraph break
                            if (tag === 'br') return '\n\n';

                            // <img> → markdown image
                            if (tag === 'img') {
                                const src = (elem as HTMLImageElement).src;
                                const alt = elem.getAttribute('alt') || '';
                                if (src && src.includes('pbs.twimg.com/media')) {
                                    return `\n\n![${alt}](${src})\n\n`;
                                }
                                if (src && src.includes('emoji')) return alt; // emoji images → text
                                return '';
                            }

                            // <a> → [text](href), always inline
                            if (tag === 'a') {
                                const href = elem.getAttribute('data-expanded-url')
                                    || elem.getAttribute('href') || '';
                                const text = Array.from(elem.childNodes).map(domToMd).join('').trim();
                                if (!text) return '';
                                if (!href || href === text) return text;
                                return `[${text}](${href})`;
                            }

                            // <strong>/<b> → **bold**
                            if (tag === 'strong' || tag === 'b') {
                                const inner = Array.from(elem.childNodes).map(domToMd).join('');
                                return inner ? `**${inner}**` : '';
                            }

                            // <em>/<i> → *italic*
                            if (tag === 'em' || tag === 'i') {
                                const inner = Array.from(elem.childNodes).map(domToMd).join('');
                                return inner ? `*${inner}*` : '';
                            }

                            // All other tags (div, span, etc.): recurse, treat as inline
                            return Array.from(elem.childNodes).map(domToMd).join('');
                        }

                        const md = domToMd(root)
                            .replace(/\n{3,}/g, '\n\n')
                            .trim();
                        return md;
                    })
                );

                if (tweetMarkdowns.length > 0) {
                    // Already have markdown — skip Turndown entirely
                    preParsedMarkdown = tweetMarkdowns.join('\n\n');
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

            turndownService.addRule('xLinks', {
                filter: 'a',
                replacement: function (content, node: any) {
                    const text = content.trim();
                    if (!text) return '';
                    // X uses data-expanded-url for the real URL (t.co is the short link)
                    const href = node.getAttribute('data-expanded-url') || node.getAttribute('href') || '';
                    if (!href || href === text) return text;
                    return `[${text}](${href})`;
                }
            });

            // Use DOM-parsed markdown if available (tweetText path), otherwise Turndown.
            let markdownContent = preParsedMarkdown || (rawHtml ? turndownService.turndown(rawHtml) : '');

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

            // Fix: orphaned inline text/links that Turndown split into separate paragraphs.
            // X wraps inline elements in block-level <div>/<span>, causing Turndown to
            // treat them as separate paragraphs. We merge them back together.
            // Handles both plain paragraphs and blockquote-prefixed lines (> ...).
            // Run multiple passes to catch consecutive orphaned fragments.
            for (let pass = 0; pass < 3; pass++) {
                // Pattern: line ending with comma/period/text, then a short standalone line
                // (link or lowercase text), then a continuation line starting lowercase.
                // Works with or without blockquote prefix.
                // Merge orphaned short line between two text lines (plain text)
                markdownContent = markdownContent.replace(
                    /^(.+[,.])\n\n(\[.+?\]\(.+?\))\n\n([a-z])/gm,
                    '$1 $2 $3'
                );
                // Same for blockquote lines: > text,\n> \n> [link]\n> \n> continuation
                markdownContent = markdownContent.replace(
                    /^(> .+[,.])\n>\s*\n(> \[.+?\]\(.+?\))\n>\s*\n(> [a-z])/gm,
                    (_, before, link, after) => {
                        // Remove the "> " prefix from link and after, merge inline
                        const linkText = link.replace(/^> /, '');
                        const afterText = after.replace(/^> /, '');
                        return `${before} ${linkText} ${afterText}`;
                    }
                );
                // Merge orphaned short plain-text line (no link, just words like "read it here")
                // between blockquote lines
                markdownContent = markdownContent.replace(
                    /^(> .+[,.])\n>\s*\n(> \S[^\n]{0,60})\n>\s*\n(> [a-z])/gm,
                    (_, before, middle, after) => {
                        const midText = middle.replace(/^> /, '');
                        const afterText = after.replace(/^> /, '');
                        return `${before} ${midText} ${afterText}`;
                    }
                );
                // Merge orphaned link/text in plain paragraphs
                markdownContent = markdownContent.replace(
                    /^(.+\S)\n\n(\[[^\]\n]+\]\([^)\n]+\))\n\n([a-z])/gm,
                    '$1 $2 $3'
                );
                // Merge standalone short word(s) that got separated (e.g., "work.AI")
                markdownContent = markdownContent.replace(
                    /^(> .+\S)\n>\s*\n(> \S[^\n]{0,40})\n>\s*$/gm,
                    (_, before, fragment) => {
                        const fragText = fragment.replace(/^> /, '');
                        return `${before} ${fragText}`;
                    }
                );
            }

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
