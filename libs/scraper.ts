import { chromium } from 'playwright';
import type { Page } from 'playwright';
import TurndownService from 'turndown';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

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
     * Extracts text content from a specific URL
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

            console.log('Waiting for content to render...');

            const isXArticle = url.includes('x.com/') || url.includes('twitter.com/');

            let markdownContent = '';
            let title = '';

            if (isXArticle) {
                // Wait for typical tweet content div or article text block, or fallback
                try {
                    await page.waitForSelector('article, main, body', { state: 'attached', timeout: 30000 });
                } catch (e) {
                    console.log('Timeout waiting for specific content selector, proceeding anyway...');
                }

                let articleElement = await page.$('article') ||
                    await page.$('main') ||
                    await page.$('.entry') ||
                    await page.$('.post') ||
                    await page.$('.content') ||
                    await page.$('body');
                let rawHtml = '';
                let preParsedMarkdown = '';

                try {
                    title = await page.title();
                } catch (e) {
                    title = 'X Article';
                }

                if (articleElement) {
                    await articleElement.evaluate((el: HTMLElement) => {
                        const toRemove = el.querySelectorAll(`
                            [role="group"], [aria-label*="View"], [aria-label*="Reply"], [aria-label*="Like"], [aria-label*="Repost"],
                            script, style, noscript, footer, header, nav, aside, 
                            .sidebar, #sidebar, .widget, .comments, #comments
                        `);
                        toRemove.forEach(n => n.remove());
                    });

                    try {
                        const h1 = await articleElement.$('h1');
                        if (h1) {
                            const h1Text = await h1.innerText();
                            if (h1Text) {
                                title = h1Text.trim();
                                await h1.evaluate(node => node.remove());
                            }
                        } else if (!title || title === 'X Article') {
                            const globalH1 = await page.$('h1');
                            if (globalH1) {
                                const h1Text = await globalH1.innerText();
                                if (h1Text) title = h1Text.trim();
                            }
                        }
                    } catch (e) {
                        console.log('Error extracting title', e);
                    }

                    const tweetMarkdowns = await articleElement.$$eval(
                        '[data-testid="tweetText"]',
                        (nodes) => nodes.map((root) => {
                            function domToMd(el: Node): string {
                                if (el.nodeType === Node.TEXT_NODE) return el.textContent || '';
                                if (el.nodeType !== Node.ELEMENT_NODE) return '';

                                const elem = el as Element;
                                const tag = elem.tagName.toLowerCase();

                                if (['script', 'style', 'svg'].includes(tag)) return '';
                                if (tag === 'br') return '\n\n';
                                if (tag === 'img') {
                                    const src = (elem as HTMLImageElement).src;
                                    const alt = elem.getAttribute('alt') || '';
                                    if (src && src.includes('pbs.twimg.com/media')) return `\n\n![${alt}](${src})\n\n`;
                                    if (src && src.includes('emoji')) return alt;
                                    return '';
                                }
                                if (tag === 'a') {
                                    const href = elem.getAttribute('data-expanded-url') || elem.getAttribute('href') || '';
                                    const text = Array.from(elem.childNodes).map(n => domToMd(n)).join('').trim();
                                    if (!text) return '';
                                    if (!href || href === text) return text;
                                    return `[${text}](${href})`;
                                }
                                if (tag === 'strong' || tag === 'b') {
                                    const inner = Array.from(elem.childNodes).map(n => domToMd(n)).join('');
                                    return inner ? `**${inner}**` : '';
                                }
                                if (tag === 'em' || tag === 'i') {
                                    const inner = Array.from(elem.childNodes).map(n => domToMd(n)).join('');
                                    return inner ? `*${inner}*` : '';
                                }
                                if (/^h[1-6]$/.test(tag)) {
                                    const level = parseInt(tag[1] || '1', 10);
                                    const prefix = '#'.repeat(level);
                                    const inner = Array.from(elem.childNodes).map(n => domToMd(n)).join('').trim();
                                    return inner ? `\n\n${prefix} ${inner}\n\n` : '';
                                }
                                if (tag === 'blockquote') {
                                    const inner = Array.from(elem.childNodes).map(n => domToMd(n)).join('').trim();
                                    if (!inner) return '';
                                    const quoted = inner.split('\n').map(line => `> ${line}`).join('\n');
                                    return `\n\n${quoted}\n\n`;
                                }
                                if (tag === 'ul' || tag === 'ol') {
                                    const inner = Array.from(elem.childNodes).map(n => domToMd(n)).join('\n');
                                    return inner ? `\n\n${inner}\n\n` : '';
                                }
                                if (tag === 'li') {
                                    const parent = elem.parentElement;
                                    const isOrdered = parent && parent.tagName.toLowerCase() === 'ol';
                                    const inner = Array.from(elem.childNodes).map(n => domToMd(n)).join('').trim();
                                    if (!inner) return '';
                                    if (isOrdered) return `1. ${inner}`;
                                    return `* ${inner}`;
                                }
                                if (tag === 'p') {
                                    const inner = Array.from(elem.childNodes).map(n => domToMd(n)).join('');
                                    return inner ? `\n\n${inner}\n\n` : '';
                                }
                                return Array.from(elem.childNodes).map(n => domToMd(n)).join('');
                            }

                            return domToMd(root as Node).replace(/\n{3,}/g, '\n\n').trim();
                        })
                    );

                    if (tweetMarkdowns.length > 0) {
                        preParsedMarkdown = tweetMarkdowns.join('\n\n');
                    } else {
                        rawHtml = await articleElement.innerHTML() || '';
                    }
                }

                const turndownService = new TurndownService({
                    headingStyle: 'atx',
                    codeBlockStyle: 'fenced'
                });

                turndownService.addRule('xImages', {
                    filter: 'img',
                    replacement: function (content, node: any) {
                        const src = node.getAttribute('src');
                        const alt = node.getAttribute('alt') || '';
                        if (src && src.includes('pbs.twimg.com/media')) return `\n\n![${alt}](${src})\n\n`;
                        if (src && src.includes('profile_images')) return '';
                        return `![${alt}](${src || ''})`;
                    }
                });

                turndownService.addRule('xLinks', {
                    filter: 'a',
                    replacement: function (content, node: any) {
                        const text = content.trim();
                        if (!text) return '';
                        const href = node.getAttribute('data-expanded-url') || node.getAttribute('href') || '';
                        if (!href || href === text) return text;
                        return `[${text}](${href})`;
                    }
                });

                markdownContent = preParsedMarkdown || (rawHtml ? turndownService.turndown(rawHtml) : '');
                markdownContent = markdownContent.replace(/\n{3,}/g, '\n\n').trim();
                markdownContent = markdownContent.replace(/Want to publish your own Article\?\s*\n+Upgrade to Premium\s*/gi, '');
                markdownContent = markdownContent.replace(/[^\n]*\n+\[[^\]]*\]\([^)]*\/i\/premium_sign_up[^)]*\)\s*/gi, '');
                markdownContent = markdownContent.replace(/[\d,.]+[KMB]?\s*\n+Views\s*/gi, '');
                markdownContent = markdownContent.replace(/Read \d+ repl(?:y|ies)\s*/gi, '');
                markdownContent = markdownContent.replace(/\n{3,}/g, '\n\n').trim();

                for (let pass = 0; pass < 3; pass++) {
                    markdownContent = markdownContent.replace(/^(.+[,.])\n\n(\[.+?\]\(.+?\))\n\n([a-z])/gm, '$1 $2 $3');
                    markdownContent = markdownContent.replace(/^(> .+[,.])\n>\s*\n(> \[.+?\]\(.+?\))\n>\s*\n(> [a-z])/gm, (_, before, link, after) => `${before} ${link.replace(/^> /, '')} ${after.replace(/^> /, '')}`);
                    markdownContent = markdownContent.replace(/^(> .+[,.])\n>\s*\n(> \S[^\n]{0,60})\n>\s*\n(> [a-z])/gm, (_, before, middle, after) => `${before} ${middle.replace(/^> /, '')} ${after.replace(/^> /, '')}`);
                    markdownContent = markdownContent.replace(/^(.+\S)\n\n(\[[^\]\n]+\]\([^)\n]+\))\n\n([a-z])/gm, '$1 $2 $3');
                    markdownContent = markdownContent.replace(/^(> .+\S)\n>\s*\n(> \S[^\n]{0,40})\n>\s*$/gm, (_, before, fragment) => `${before} ${fragment.replace(/^> /, '')}`);
                }
            } else {
                // Not an X article, fallback to Mozilla Readability
                console.log('Using Readability for non-X article...');

                await page.waitForTimeout(2000); // Give CSR apps some time to render

                try {
                    title = await page.title();
                } catch (e) {
                    title = 'Web Article';
                }

                const html = await page.content();
                const dom = new JSDOM(html, { url });
                const document = dom.window.document;

                const noiseElements = document.querySelectorAll(
                    'nav, footer, aside, .sidebar, [class*="sidebar"], [class*="share"], [class*="newsletter"], [class*="subscribe"], [class*="related"], [class*="cta"], [class*="author-box"], [class*="metadata"], [class*="post-meta"], form, .w-dyn-list, .w-dyn-empty, .w-slider, [class*="carousel"]'
                );
                noiseElements.forEach(el => el.remove());

                // Aggressively remove lists that represent Metadata blocks (like Claude blog)
                document.querySelectorAll('ul, ol, div').forEach(el => {
                    if (el.tagName === 'DIV' && el.children.length > 0) return; // only target text-heavy or lists
                    const text = el.textContent || '';
                    if (text.includes('Category') && text.includes('Reading time')) {
                        el.remove();
                    }
                });

                const reader = new Readability(document);
                const article = reader.parse();

                if (article && article.content) {
                    if (article.title) title = article.title;
                    const turndownService = new TurndownService({
                        headingStyle: 'atx',
                        codeBlockStyle: 'fenced'
                    });
                    markdownContent = turndownService.turndown(article.content);

                    // Claude-specific and generic blog noise cleanup
                    markdownContent = markdownContent.replace(/\*\s*Category[\s\S]*?Copy link\S*[\s\S]*?https:\/\/\S+/gi, '');
                    markdownContent = markdownContent.replace(/## Transform how your organization[\s\S]*$/gi, '');
                    markdownContent = markdownContent.replace(/Get the developer newsletter[\s\S]*?later\./gi, '');
                    markdownContent = markdownContent.replace(/0\/5\s*\n*\s*eBook[\s\S]*$/gi, '');
                    markdownContent = markdownContent.replace(/!\[.*?\]\(.*?placeholder\.svg\)/gi, '');

                    markdownContent = markdownContent.replace(/\n{3,}/g, '\n\n').trim();

                    if (article.title && !markdownContent.startsWith('# ')) {
                        let header = `# ${article.title}\n\n`;
                        if (article.excerpt) {
                            header += `> ${article.excerpt}\n\n`;
                        }
                        markdownContent = header + markdownContent;
                    }
                } else {
                    console.log('Readability failed, falling back to basic extraction...');
                    let rawHtml = await page.$eval('body', el => el.innerHTML).catch(() => html);
                    const turndownService = new TurndownService({
                        headingStyle: 'atx',
                        codeBlockStyle: 'fenced'
                    });
                    markdownContent = turndownService.turndown(rawHtml);
                }
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
