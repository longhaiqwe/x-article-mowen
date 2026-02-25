import OpenAI from 'openai';

export interface TranslationResult {
    literalTranslation: string;
    refinedTranslation: string;
}

export type TranslationProgressCallback = (stage: 'literal' | 'refined', content: string) => void;
export type TranslationChunkCallback = (stage: 'literal' | 'refined', chunk: string) => void;

export class Translator {
    private openai: OpenAI;
    private model: string;

    constructor(apiKey: string, baseURL?: string, model: string = 'gpt-4o') {
        this.openai = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL,
        });
        this.model = model;
    }

    /**
     * 流式直译，每个 chunk 通过 onChunk 回调推送
     */
    public async literalTranslateStream(
        content: string,
        onChunk: (chunk: string) => void
    ): Promise<string> {
        const systemPrompt = `你是一个专业的技术与商业文章翻译官。请将下方用户提供的包含 Markdown 格式的英文原文直接翻译为中文。
要求：
1. 必须忠实于原文，不要增加原本不存在的信息，也不要删减细节。
2. 保持原有的 Markdown 格式（如标题、由于加粗、图片链接、超链接等）必须一丝不差地保留在译文的相应位置。
3. 对于专有名词和术语，尽量使用行业内常用的中文表达。`;

        const stream = await this.openai.chat.completions.create({
            model: this.model,
            stream: true,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content }
            ],
            temperature: 0.3,
        });

        let full = '';
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) {
                full += delta;
                onChunk(delta);
            }
        }
        return full;
    }

    /**
     * 流式润色，每个 chunk 通过 onChunk 回调推送
     */
    public async refineTranslationStream(
        sourceText: string,
        literalText: string,
        onChunk: (chunk: string) => void
    ): Promise<string> {
        const systemPrompt = `你是一个资深的中文作家和文字编辑。我给你一段英文原文和对应的中文直译稿。你需要对直译稿进行深度润色，使其读起来就像是中文母语者写出的一篇高质量文章。

要求：
1. **彻底消除翻译腔**：用词要地道、自然，句式可以根据中文表达习惯进行适当的倒装、拆分或合并。
2. **语气与风格匹配**：原文是深度长文分析风格，带有一定的哲思或技术探讨色彩。请调整译文语气，使其更具说服力和专业感。
3. **完美保留原格式**：所有原 Markdown 结构（包括 \`#\` 标题、\`![](url)\` 图片、\`[]()\` 链接等）绝对不能改变、遗漏或破坏。
4. **只输出润色后的内容**，不要添加任何额外的问候语或解释说明。`;

        const userPrompt = `【英文原文】\n${sourceText}\n\n【中文直译】\n${literalText}\n\n请输出仅包含润色后内容的完整 Markdown：`;

        const stream = await this.openai.chat.completions.create({
            model: this.model,
            stream: true,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.6,
        });

        let full = '';
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) {
                full += delta;
                onChunk(delta);
            }
        }
        return full;
    }

    /**
     * 单独润色（流式）——用于调试模式下步骤 3 单独触发
     * @param original 英文原文 markdown
     * @param literal  直译后的 markdown
     */
    public async refineMarkdown(
        original: string,
        literal: string,
        onComplete?: (content: string) => void,
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        console.log(`[Translator] Starting standalone refinement (streaming)...`);
        const refined = await this.refineTranslationStream(original, literal, (chunk) => {
            onChunk?.(chunk);
        });
        onComplete?.(refined);
        return refined;
    }

    /**
     * 完整翻译流程（流式），通过 onChunk 实时推送每个阶段的增量内容
     */
    public async translateMarkdown(
        markdownContent: string,
        onProgress?: TranslationProgressCallback,
        onChunk?: TranslationChunkCallback
    ): Promise<TranslationResult> {
        console.log(`[Translator] Starting literal translation (streaming)...`);
        const literal = await this.literalTranslateStream(markdownContent, (chunk) => {
            onChunk?.('literal', chunk);
        });
        onProgress?.('literal', literal);

        console.log(`[Translator] Starting refinement (streaming)...`);
        const refined = await this.refineTranslationStream(markdownContent, literal, (chunk) => {
            onChunk?.('refined', chunk);
        });
        onProgress?.('refined', refined);

        return {
            literalTranslation: literal,
            refinedTranslation: refined
        };
    }
}
