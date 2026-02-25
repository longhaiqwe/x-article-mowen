import OpenAI from 'openai';

const MODEL_NAME = 'hf.co/mradermacher/translategemma-4b-it-GGUF';

async function testLocalTranslateGemma() {
    console.log(`🚀 正在测试本地 Ollama 部署的 TranslateGemma-4b 模型...`);

    // 使用本地 Ollama 提供的兼容 OpenAI 的 API
    const openai = new OpenAI({
        apiKey: 'ollama', // 本地 ollama 其实不需要 apiKey，不过 openai sdk 可能会必须要一个字符串
        baseURL: `http://localhost:11434/v1`,
    });

    const sampleText = `TranslateGemma models retain the strong multimodal capabilities of Gemma 3. Our tests on the Vistra image translation benchmark show that the improvements in text translation also positively impact the ability to translate text within images, even without specific multimodal fine-tuning during the TranslateGemma training process.`;

    const commonRules = `规则：
- 翻译时要准确传达原文的事实和背景。
- 保留术语和公司名称。
- 输出格式说明：每个段落之间加空行。
- 在翻译专业术语时，第一次出现时要在括号里面写上英文原文，之后就只写中文。`;

    const systemPrompt = `你是一位精通简体中文的专业翻译。请将以下英文文本翻译成中文。\n\n${commonRules}`;

    console.log(`\n📄 原文:\n${sampleText}\n`);
    console.log(`⏳ 正在请求本地 Ollama 推理中，请稍候...`);

    try {
        const response = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: sampleText }
            ],
            temperature: 0.3,
            max_tokens: 1024,
        });

        console.log(`\n✅ 翻译结果:`);
        console.log(`----------------------------------------`);
        console.log(response.choices[0]?.message.content);
        console.log(`----------------------------------------`);

    } catch (error: any) {
        console.error(`\n❌ 调用本地 Ollama 失败:`, error.message);
        console.log(`请确保 Ollama 正在后台运行，并且已完成模型的 pull`);
    }
}

testLocalTranslateGemma();
