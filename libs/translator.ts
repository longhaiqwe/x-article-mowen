import OpenAI from 'openai';

export interface ModelConfig {
    // 新版三步翻译法使用的模型配置
    literal: string;
    issues: string;
    freeTranslation: string;
}

// 逐段翻译相关类型
export interface ParagraphResult {
    index: number;
    original: string;
    literal: string;
    issues: string;
    freeTranslation: string;
}

export interface ParagraphTranslationResult {
    paragraphs: ParagraphResult[];
    finalArticle: string;
}

export type ParagraphProgressCallback = (
    event: 'paragraph_start' | 'paragraph_complete' | 'final_article',
    data: { index?: number; total?: number; original?: string; result?: ParagraphResult; content?: string }
) => void;

export type ParagraphChunkCallback = (
    index: number,
    step: 'literal' | 'issues' | 'free',
    chunk: string
) => void;

export class Translator {
    private openai: OpenAI;
    private models: ModelConfig;
    private apiKey: string;
    private baseURL: string;

    constructor(apiKey: string, baseURL: string, models: ModelConfig) {
        this.openai = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL,
        });
        this.models = models;
        this.apiKey = apiKey;
        this.baseURL = baseURL;
    }

    /**
     * 通用流式对话方法 (Chat Completions API)
     */
    private async streamChat(
        model: string,
        systemPrompt: string,
        userPrompt: string,
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        const stream = await this.openai.chat.completions.create({
            model: model,
            stream: true,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
        });

        let full = '';
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) {
                full += delta;
                onChunk?.(delta);
            }
        }
        return full;
    }

    /**
     * 分块翻译：对合并后的文本块分别调用三个不同的模型（直译→问题→意译）
     */
    public async translateParagraph(
        paragraph: string,
        onChunk?: (chunk: string) => void
    ): Promise<{ literal: string; issues: string; freeTranslation: string }> {
        const commonRules = `规则：
- 翻译时要准确传达原文的事实和背景。
- 即使上意译也要保留原始段落格式，以及保留术语，例如 FLAC，JPEG 等。保留公司缩写，例如 Microsoft, Amazon, OpenAI 等。
- 人名不翻译
- 对于 Figure 和 Table，翻译的同时保留原有格式，例如："Figure 1: "翻译为"图 1: "，"Table 1: "翻译为："表 1: "。
- 全部使用全角标点符号。
- 删除原文的数字备注角标。
- 输出格式说明：标题加粗，每个段落之间加空行，原文加粗的话继续加粗，引用格式以'> '开始，无序列表，用'• '开始，有序列表，用类似'1. '开始。
- 在翻译专业术语时，第一次出现时要在括号里面写上英文原文，例如："生成式 AI (Generative AI)"，之后就只写中文。
- 以下是常见的 AI 相关术语词汇对应表（English -> 中文）：
  * Transformer -> Transformer
  * Token -> Token
  * LLM/Large Language Model -> 大语言模型
  * Zero-shot -> 零样本
  * Few-shot -> 少样本
  * AI Agent -> AI 智能体
  * AGI -> 通用人工智能
  * ANI -> 专用人工智能
  * ASI -> 超级人工智能
  * SaaS -> SaaS
  * API -> API
  * AI -> AI`;

        // ── 步骤 1：直译 (支持本地 Ollama 切入) ──
        const step1System = `你是一位精通简体中文的专业翻译。请将以下英文文本块（可能包含多段）直译成中文，保持原有格式，绝对不要遗漏任何信息。\n\n${commonRules}\n\n只需直接输出直译结果，不要包含任何前缀、解释或多余的标记。`;
        // 为前端展示组装 chunk
        onChunk?.('### 直译\n');

        let literal = '';
        if (this.models.literal === 'ollama') {
            // 使用临时内联的客户端请求本地 Ollama
            const localOllama = new OpenAI({
                apiKey: 'ollama',
                baseURL: 'http://127.0.0.1:11434/v1',
            });
            const stream = await localOllama.chat.completions.create({
                model: 'hf.co/mradermacher/translategemma-4b-it-GGUF',
                stream: true,
                messages: [
                    { role: 'system', content: step1System },
                    { role: 'user', content: paragraph }
                ],
                temperature: 0.3, // 本地小模型低 temp 更稳定
            });
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content || '';
                if (delta) {
                    literal += delta;
                    onChunk?.(delta);
                }
            }
        } else {
            literal = await this.streamChat(this.models.literal, step1System, paragraph, onChunk);
        }

        // ── 步骤 2：问题分析 (使用统一高质量模型，如 DeepSeek) ──
        const step2System = `你是一位资深的校对编辑。以下是一段英文原文及其直译结果。
请严格根据直译结果，指出其中存在的具体问题。要准确描述，不宜笼统，也不需要增加原文不存在的内容或格式，包括但不限于：
1. 不符合中文表达习惯，明确指出不符合的地方。
2. 语句不通顺，指出位置（不需要给出修改意见）。
3. 晦涩难懂，不易理解，可以尝试给出解释。

无需任何开场白，只需直接输出具体问题列表。如果没有问题，请输出“未发现明显问题”。`;
        const step2User = `原文：\n${paragraph}\n\n直译结果：\n${literal}`;
        onChunk?.('\n\n### 问题\n');
        const issues = await this.streamChat(this.models.issues, step2System, step2User, onChunk);

        // ── 步骤 3：意译 (使用统一高质量模型，如 DeepSeek) ──
        const step3System = `你是一位资深的翻译专家，擅长将技术内容转化为通顺地道的中文科普文章。
以下是一段英文原文、初版直译及其问题分析。请重新进行意译。
保证内容原意的基础上，使其更易于理解，更符合中文表达习惯，同时严格保持原有的排版、列表、加粗等 Markdown 格式不变。
\n\n${commonRules}\n\n无需任何开场白或解释，直接且仅输出重新意译后的文本。`;
        const step3User = `原文：\n${paragraph}\n\n初版直译：\n${literal}\n\n存在的问题：\n${issues}`;
        onChunk?.('\n\n### 意译\n');
        const freeTranslation = await this.streamChat(this.models.freeTranslation, step3System, step3User, onChunk);

        return { literal, issues, freeTranslation };
    }

    /**
     * 分块翻译编排方法：拆分并合并段落 → 逐块三步法 → 整合最终文章
     */
    public async translateByParagraphs(
        content: string,
        onProgress?: ParagraphProgressCallback,
        onChunk?: ParagraphChunkCallback
    ): Promise<ParagraphTranslationResult> {
        // 先按双换行拆分出基本段落
        const originalParagraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);

        // 分块逻辑：尽量把多段合并，但不截断单段，不超过 1500 字符
        const MAX_CHUNK_LENGTH = 1500;
        const paragraphs: string[] = [];
        let currentChunk = '';

        for (const p of originalParagraphs) {
            if (currentChunk.length + p.length > MAX_CHUNK_LENGTH && currentChunk.length > 0) {
                paragraphs.push(currentChunk.trim());
                currentChunk = p;
            } else {
                currentChunk = currentChunk ? currentChunk + '\n\n' + p : p;
            }
        }
        if (currentChunk.length > 0) {
            paragraphs.push(currentChunk.trim());
        }

        const total = paragraphs.length;
        const results: ParagraphResult[] = [];

        console.log(`[Translator] 逐块翻译：原文共 ${originalParagraphs.length} 段，合并为 ${total} 个处理块`);

        for (let i = 0; i < total; i++) {
            const paragraph = paragraphs[i]!.trim();
            console.log(`[Translator] 翻译第 ${i + 1}/${total} 块...`);

            onProgress?.('paragraph_start', { index: i, total, original: paragraph });

            // 追踪当前处于哪个步骤，以便发送 chunk 事件
            let currentStep: 'literal' | 'issues' | 'free' = 'literal';
            const chunkTracker = (chunk: string) => {
                // 检测步骤切换标记
                if (chunk.includes('### 问题') || chunk.includes('###问题')) {
                    currentStep = 'issues';
                } else if (chunk.includes('### 意译') || chunk.includes('###意译')) {
                    currentStep = 'free';
                }
                onChunk?.(i, currentStep, chunk);
            };

            const parsed = await this.translateParagraph(paragraph, chunkTracker);

            const result: ParagraphResult = {
                index: i,
                original: paragraph,
                literal: parsed.literal,
                issues: parsed.issues,
                freeTranslation: parsed.freeTranslation,
            };
            results.push(result);

            onProgress?.('paragraph_complete', { index: i, total, result });
        }

        // 整合所有意译结果
        const finalArticle = results.map(r => r.freeTranslation).join('\n\n');

        console.log(`[Translator] 逐段翻译完成，整合文章 ${finalArticle.length} 字符`);
        onProgress?.('final_article', { content: finalArticle });

        return { paragraphs: results, finalArticle };
    }

}
