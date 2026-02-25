import { marked, Token, Tokens } from 'marked';

export interface NoteAtom {
    type: string;
    attrs?: any;
    marks?: any[];
    content?: NoteAtom[];
    text?: string;
}

export class MowenPublisher {
    private apiKey: string;
    private spaceId: string;
    private baseUrl = 'https://open.mowen.cn/api/open/api/v1';

    constructor(apiKey: string, spaceId: string) {
        this.apiKey = apiKey;
        this.spaceId = spaceId;
    }

    /**
     * Upload an image from a URL using Mowen's OpenAPI
     */
    public async uploadImageFromUrl(imageUrl: string): Promise<string | null> {
        try {
            console.log(`[Mowen] Uploading image: ${imageUrl}`);
            const response = await fetch(`${this.baseUrl}/upload/url`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fileType: 1, // 1 for Image
                    url: imageUrl
                })
            });

            if (!response.ok) {
                console.error(`[Mowen] Image upload failed: ${response.statusText}`);
                return null;
            }

            const data = await response.json();
            return data?.file?.fileId || null;
        } catch (error) {
            console.error('[Mowen] Exception during image upload:', error);
            return null;
        }
    }

    /**
     * Parse a single marked token to NoteAtom
     */
    private async parseToken(token: Token): Promise<NoteAtom | null> {
        switch (token.type) {
            case 'paragraph': {
                const pToken = token as Tokens.Paragraph;
                const childAtoms: NoteAtom[] = [];
                // Process inline tokens
                if (pToken.tokens) {
                    for (const t of pToken.tokens) {
                        const inlineAtom = await this.parseToken(t);
                        if (inlineAtom) childAtoms.push(inlineAtom);
                    }
                }

                // If the paragraph only contains an image atom, elevate it to block level
                if (childAtoms.length === 1 && childAtoms[0].type === 'image') {
                    return childAtoms[0];
                }

                return {
                    type: 'paragraph',
                    content: childAtoms.length > 0 ? childAtoms : [{ type: 'text', text: pToken.text }]
                };
            }
            case 'heading': {
                const hToken = token as Tokens.Heading;
                const childAtoms: NoteAtom[] = [];
                if (hToken.tokens) {
                    for (const t of hToken.tokens) {
                        const inlineAtom = await this.parseToken(t);
                        if (inlineAtom) childAtoms.push(inlineAtom);
                    }
                }
                return {
                    type: 'heading',
                    attrs: { level: String(hToken.depth) }, // must be string per Mowen schema
                    content: childAtoms.length > 0 ? childAtoms : [{ type: 'text', text: hToken.text }]
                };
            }
            case 'blockquote': {
                const bToken = token as Tokens.Blockquote;
                const childAtoms: NoteAtom[] = [];
                if (bToken.tokens) {
                    for (const t of bToken.tokens) {
                        const inlineAtom = await this.parseToken(t);
                        if (inlineAtom) childAtoms.push(inlineAtom);
                    }
                }
                return {
                    type: 'quote',
                    content: childAtoms
                };
            }
            case 'image': {
                const imgToken = token as Tokens.Image;
                // Upload the image to Mowen first to get the uuid
                const uuid = await this.uploadImageFromUrl(imgToken.href);
                if (uuid) {
                    // Successfully uploaded - use the Mowen file ID
                    return {
                        type: 'image',
                        attrs: {
                            uuid: uuid,
                            alt: imgToken.text || '',
                            align: 'center'
                        }
                    };
                } else {
                    // Upload failed (X anti-hotlinking, etc.) - show as a link paragraph instead
                    console.warn(`[Mowen] Using URL fallback for image: ${imgToken.href}`);
                    return {
                        type: 'paragraph',
                        content: [{
                            type: 'text',
                            text: `[${imgToken.text || '图片'}](${imgToken.href})`,
                        }]
                    };
                }
            }
            case 'text':
            case 'escape': {
                const textToken = token as Tokens.Text | Tokens.Escape;
                return {
                    type: 'text',
                    text: textToken.text
                };
            }
            case 'strong': {
                const strongToken = token as Tokens.Strong;
                return {
                    type: 'text',
                    text: strongToken.text,
                    marks: [
                        { type: 'bold' }
                    ]
                };
            }
            case 'em': {
                const emToken = token as Tokens.Em;
                return {
                    type: 'text',
                    text: emToken.text,
                    marks: [
                        { type: 'italic' }
                    ]
                };
            }
            case 'link': {
                const linkToken = token as Tokens.Link;
                return {
                    type: 'text',
                    text: linkToken.text,
                    marks: [
                        {
                            type: 'link',
                            attrs: {
                                href: linkToken.href,
                                target: "_blank"
                            }
                        }
                    ]
                };
            }
            case 'list': {
                const listToken = token as Tokens.List;
                const listItems: NoteAtom[] = [];
                for (const item of listToken.items) {
                    const itemChildren: NoteAtom[] = [];
                    if (item.tokens) {
                        for (const t of item.tokens) {
                            // list_item contains a 'text' token that itself has inline tokens
                            if (t.type === 'text' && (t as Tokens.Text).tokens) {
                                const textToken = t as Tokens.Text;
                                if (textToken.tokens) {
                                    for (const inline of textToken.tokens) {
                                        const inlineAtom = await this.parseToken(inline);
                                        if (inlineAtom) itemChildren.push(inlineAtom);
                                    }
                                }
                            } else {
                                const childAtom = await this.parseToken(t);
                                if (childAtom) itemChildren.push(childAtom);
                            }
                        }
                    }
                    listItems.push({
                        type: 'list_item',
                        content: [{ type: 'paragraph', content: itemChildren }]
                    });
                }
                return {
                    type: listToken.ordered ? 'ordered_list' : 'bullet_list',
                    content: listItems
                };
            }
            case 'space':
            case 'hr':
            case 'br':
            case 'html':
                return null;
            // Add more token types if necessary
            default:
                console.warn(`[Mowen] Unhandled token type: ${token.type}`);
                return null;
        }
    }

    /**
     * Convert markdown string to NoteAtom structure
     */
    public async markdownToAtoms(markdown: string): Promise<NoteAtom[]> {
        const tokens = marked.lexer(markdown);
        const atoms: NoteAtom[] = [];

        for (const token of tokens) {
            const atom = await this.parseToken(token);
            if (atom) atoms.push(atom);
        }

        return atoms;
    }

    /**
     * Publish the note to Mowen
     */
    public async publishNote(title: string, markdown: string): Promise<any> {
        console.log(`[Mowen] Starting to convert and publish note: ${title}`);
        const contentAtoms = await this.markdownToAtoms(markdown);

        const docNode: NoteAtom = {
            type: 'doc',
            content: contentAtoms
        };

        // Based on Mowen API spec: NoteCreateRequest uses `body` (NoteAtom) + optional `settings`
        const payload = {
            body: docNode,
            settings: {
                autoPublish: true,
            }
        };

        console.log(`[Mowen] Sending ${contentAtoms.length} atoms to Mowen API...`);
        const response = await fetch(`${this.baseUrl}/note/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(`Failed to publish note to Mowen: ${response.status} ${response.statusText} - ${responseText}`);
        }

        const data = JSON.parse(responseText);
        console.log(`[Mowen] Note published successfully!`);
        console.log(`[Mowen] Response:`, JSON.stringify(data, null, 2));
        return data;
    }
}
