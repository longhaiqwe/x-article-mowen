import OpenAI from 'openai';

export interface ModelConfig {
    draft: string;
    reviewFluency: string;
    reviewAccuracy: string;
    reviewStyle: string;
    synthesis: string;
    final: string;
}

export interface TranslationResult {
    draftTranslation: string;
    reviews: {
        fluency: string;
        accuracy: string;
        style: string;
    };
    synthesizedTranslation: string;
    finalTranslation: string;
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

export type TranslationProgressCallback = (
    stage: 'draft' | 'review_fluency' | 'review_accuracy' | 'review_style' | 'synthesis' | 'final',
    content: string
) => void;

export type TranslationChunkCallback = (
    stage: 'draft' | 'review_fluency' | 'review_accuracy' | 'review_style' | 'synthesis' | 'final',
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
     * 阶段 1：初步改写 (Draft Translation)
     * 使用模型：Doubao-Seed-1.6 (Chat Completions API)
     */
    public async draftTranslate(
        content: string,
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        const systemPrompt = `你是一位资深的语言专家，专精于将英文文章改写为高质量、地道的中文内容。你的任务不是简单的翻译，而是进行深度的内容重塑，在保持原文核心含义和信息完整性的前提下，使文本更符合中文读者的阅读习惯和表达方式。

**任务目标：**
1. **深入理解原文，精准把握含义：** 结合语境，精准翻译术语。
2. **中文表达，地道自然：** 调整语序，拆分长句，选用贴合语境的词汇。
3. **信息完整，准确传达：** 不得遗漏、增添或歪曲关键信息。
4. **Markdown 格式保留：** 完整保留原文的图片链接、超链接、代码块、加粗、各级标题等所有 Markdown 格式。
5. **只输出正文内容**，不允许有任何解释性前言或多余的话。`;

        const userPrompt = `**英文原文：**\n\n${content}`;

        return this.streamChat(this.models.draft, systemPrompt, userPrompt, onChunk);
    }

    /**
     * 阶段 2: 语言流畅性与地道性评审 (Review 1)
     * 使用模型：GLM-4.7
     */
    public async reviewFluency(
        original: string,
        draft: string,
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        const systemPrompt = `你是一位资深的中文语言专家和技术编辑，专精于评估中文文本的流畅性、地道性和自然度。
请仔细阅读以下由英文改写而来的中文技术文章（\`draft\`部分），并从语言表达的角度进行细致的评审。

**评审重点：**
1. 句子流畅度、衔接自然度。
2. 词汇选择是否地道，是否符合现代标准汉语规范。
3. 避免翻译腔和生硬表达。

**输出要求：**
指出问题并在不需要改变原意的基础上给出明确具体的修改建议。只输出建议内容。`;

        return this.runReviewStream(this.models.reviewFluency, systemPrompt, original, draft, onChunk);
    }

    /**
     * 阶段 2: 内容准确性与逻辑性评审 (Review 2)
     * 使用模型：DeepSeek-V3.2
     */
    public async reviewAccuracy(
        original: string,
        draft: string,
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        const systemPrompt = `你是一位资深的学术编辑和技术内容审核专家。
请仔细阅读以下由英文改写而来的中文技术文章，并与原始英文文本进行对比，从内容和逻辑的角度进行严格的评审。

**评审重点：**
1. 信息是否与原文一致，有无遗漏、歪曲或擅自增添。
2. 专业术语翻译是否准确。
3. 逻辑关系是否顺畅连贯。

**输出要求：**
指出问题并给出明确具体的改善建议。只输出建议内容。`;

        return this.runReviewStream(this.models.reviewAccuracy, systemPrompt, original, draft, onChunk);
    }

    /**
     * 阶段 2: 风格一致性与目标读者适配性评审 (Review 3)
     * 使用模型：Kimi-K2
     */
    public async reviewStyle(
        original: string,
        draft: string,
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        const systemPrompt = `你是一位资深的文案策划和用户体验研究员。
请仔细阅读以下由英文改写而来的中文技术文章，从风格、受众和传播效果的角度进行全面评审。

**评审重点：**
1. 语言风格是否一致。
2. 术语和难度是否适配技术人员和感兴趣的一般读者，是否需要在术语后增加简单解释以增强通俗性。
3. 是否能给读者留下深刻印象，表达有无过分晦涩抽象之处。

**输出要求：**
指出问题并给出明确具体的完善建议。只输出建议内容。`;

        return this.runReviewStream(this.models.reviewStyle, systemPrompt, original, draft, onChunk);
    }

    private async runReviewStream(model: string, systemPrompt: string, original: string, draft: string, onChunk?: (chunk: string) => void): Promise<string> {
        const userPrompt = `<article>
  <source lang="en"><content><![CDATA[${original}]]></content></source>
  <rewritten lang="zh"><draft><![CDATA[${draft}]]></draft></rewritten>
</article>`;

        return this.streamChat(model, systemPrompt, userPrompt, onChunk);
    }

    /**
     * 阶段 3: 综合改进 (Synthesis)
     * 使用模型：DeepSeek-V3.2
     */
    public async synthesizeReviews(
        original: string,
        draft: string,
        reviews: { fluency: string; accuracy: string; style: string },
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        const systemPrompt = `你是一位资深的技术编辑和语言专家，擅长整合多方意见，对文本进行综合改进和优化。你的任务是：基于英文原文、初步改写稿以及三个评审 LLM 的意见，生成一份最终改进版的中文改写文章。

**任务目标：**
精准完整传达原文信息，语言流畅地道，全面采纳评审LLM的合理建议。

要求：
1. 保持原有 Markdown 结构。
2. 融合三方有效建议优化正文表达。
3. 只输出修改后的文章正文，不要输出修改说明或多余废话。`;

        const userPrompt = `<article>
  <source lang="en"><content><![CDATA[${original}]]></content></source>
  <rewritten lang="zh">
    <draft><![CDATA[${draft}]]></draft>
    <review>
      <llm1><![CDATA[${reviews.fluency}]]></llm1>
      <llm2><![CDATA[${reviews.accuracy}]]></llm2>
      <llm3><![CDATA[${reviews.style}]]></llm3>
    </review>
  </rewritten>
</article>`;

        return this.streamChat(this.models.synthesis, systemPrompt, userPrompt, onChunk);
    }

    /**
     * 阶段 4: 最终润色 (Final Polish)
     * 使用模型：Doubao-Seed-1.6
     */
    public async finalPolish(
        synthesizedText: string,
        onChunk?: (chunk: string) => void
    ): Promise<string> {
        const systemPrompt = `你是一位资深的语言专家、技术编辑和校对员，专精于文本的润色、校对和一致性检查。请对输入文章进行最后的润色和格式检查。

**终检重点：**
1. 语言纯正自然，毫无语病。
2. Markdown 格式完好无损（配图链接，加粗标题全部完好）。
3. 只进行微调润色，不要伤筋动骨大幅删改。
4. 请直接输出最终版正文，不要有任何多余的开场白或结尾语。`;

        const userPrompt = `<article>\n<rewritten lang="zh">\n<revised><![CDATA[${synthesizedText}]]></revised>\n</rewritten>\n</article>`;

        return this.streamChat(this.models.final, systemPrompt, userPrompt, onChunk);
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

        // ── 步骤 1：直译 (使用统一高质量模型，如 DeepSeek) ──
        const step1System = `你是一位精通简体中文的专业翻译。请将以下英文文本块（可能包含多段）直译成中文，保持原有格式，绝对不要遗漏任何信息。\n\n${commonRules}\n\n只需直接输出直译结果，不要包含任何前缀、解释或多余的标记。`;
        // 为前端展示组装 chunk
        onChunk?.('### 直译\n');
        const literal = await this.streamChat(this.models.synthesis, step1System, paragraph, onChunk);

        // ── 步骤 2：问题分析 (使用统一高质量模型，如 DeepSeek) ──
        const step2System = `你是一位资深的校对编辑。以下是一段英文原文及其直译结果。
请严格根据直译结果，指出其中存在的具体问题。要准确描述，不宜笼统，也不需要增加原文不存在的内容或格式，包括但不限于：
1. 不符合中文表达习惯，明确指出不符合的地方。
2. 语句不通顺，指出位置（不需要给出修改意见）。
3. 晦涩难懂，不易理解，可以尝试给出解释。

无需任何开场白，只需直接输出具体问题列表。如果没有问题，请输出“未发现明显问题”。`;
        const step2User = `原文：\n${paragraph}\n\n直译结果：\n${literal}`;
        onChunk?.('\n\n### 问题\n');
        const issues = await this.streamChat(this.models.synthesis, step2System, step2User, onChunk);

        // ── 步骤 3：意译 (使用统一高质量模型，如 DeepSeek) ──
        const step3System = `你是一位资深的翻译专家，擅长将技术内容转化为通顺地道的中文科普文章。
以下是一段英文原文、初版直译及其问题分析。请重新进行意译。
保证内容原意的基础上，使其更易于理解，更符合中文表达习惯，同时严格保持原有的排版、列表、加粗等 Markdown 格式不变。
\n\n${commonRules}\n\n无需任何开场白或解释，直接且仅输出重新意译后的文本。`;
        const step3User = `原文：\n${paragraph}\n\n初版直译：\n${literal}\n\n存在的问题：\n${issues}`;
        onChunk?.('\n\n### 意译\n');
        const freeTranslation = await this.streamChat(this.models.synthesis, step3System, step3User, onChunk);

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

    /**
     * 完整的多轮翻译评审流 (Orchestrator)
     */
    public async translateMarkdown(
        markdownContent: string,
        onProgress?: TranslationProgressCallback,
        onChunk?: TranslationChunkCallback
    ): Promise<TranslationResult> {

        console.log(`[Translator] Stage 1: Draft Translation (${this.models.draft})...`);
        const draft = await this.draftTranslate(markdownContent, (c) => onChunk?.('draft', c));
        onProgress?.('draft', draft);

        console.log(`[Translator] Stage 2: Parallel Reviews (${this.models.reviewFluency} / ${this.models.reviewAccuracy} / ${this.models.reviewStyle})...`);
        const [fluency, accuracy, style] = await Promise.all([
            this.reviewFluency(markdownContent, draft, (c) => onChunk?.('review_fluency', c)),
            this.reviewAccuracy(markdownContent, draft, (c) => onChunk?.('review_accuracy', c)),
            this.reviewStyle(markdownContent, draft, (c) => onChunk?.('review_style', c))
        ]);
        onProgress?.('review_fluency', fluency);
        onProgress?.('review_accuracy', accuracy);
        onProgress?.('review_style', style);

        console.log(`[Translator] Stage 3: Synthesis (${this.models.synthesis})...`);
        const synth = await this.synthesizeReviews(markdownContent, draft, { fluency, accuracy, style }, (c) => onChunk?.('synthesis', c));
        onProgress?.('synthesis', synth);

        console.log(`[Translator] Stage 4: Final Polish (${this.models.final})...`);
        const finalContent = await this.finalPolish(synth, (c) => onChunk?.('final', c));
        onProgress?.('final', finalContent);

        return {
            draftTranslation: draft,
            reviews: { fluency, accuracy, style },
            synthesizedTranslation: synth,
            finalTranslation: finalContent
        };
    }
}
