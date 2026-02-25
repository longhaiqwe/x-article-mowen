import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// 填入你的 Hugging Face Access Token (如果环境变量里没有设)
const HF_TOKEN = process.env.HF_TOKEN || 'YOUR_HF_TOKEN';

// 选择你想测试的 TranslateGemma 模型版本
// 可选: "google/translategemma-4b", "google/translategemma-12b", "google/translategemma-27b"
// 注意: 较大的模型在免费的 Hugging Face Serverless API 上可能需要 Pro 账号或者经常冷启动
const MODEL_NAME = 'google/translategemma-4b';

async function testTranslateGemma() {
    console.log(`🚀 正在测试 TranslateGemma 模型直接翻译效果...`);
    console.log(`📦 使用模型: ${MODEL_NAME}`);

    if (HF_TOKEN === 'YOUR_HF_TOKEN') {
        console.error("❌ 错误: 请先在脚本或 .env 中配置你的 HF_TOKEN (Hugging Face Access Token)");
        console.log("👉 获取地址: https://huggingface.co/settings/tokens");
        return;
    }

    // Hugging Face 提供了兼容 OpenAI 的 API
    const openai = new OpenAI({
        apiKey: HF_TOKEN,
        baseURL: `https://router.huggingface.co/hf-inference/v1`,
    });

    const sampleText = `TranslateGemma models retain the strong multimodal capabilities of Gemma 3. Our tests on the Vistra image translation benchmark show that the improvements in text translation also positively impact the ability to translate text within images, even without specific multimodal fine-tuning during the TranslateGemma training process.`;

    const commonRules = `规则：
- 翻译时要准确传达原文的事实和背景。
- 保留术语和公司名称。
- 输出格式说明：每个段落之间加空行。
- 在翻译专业术语时，第一次出现时要在括号里面写上英文原文，之后就只写中文。`;

    const systemPrompt = `你是一位精通简体中文的专业翻译。请将以下英文文本翻译成中文。\n\n${commonRules}`;

    console.log(`\n📄 原文:\n${sampleText}\n`);
    console.log(`⏳ 正在请求 API翻译中，请稍候...`);

    try {
        const response = await openai.chat.completions.create({
            model: MODEL_NAME, // 使用选定的模型名字
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: sampleText }
            ],
            temperature: 0.3, // 翻译任务通常使用较低的 temperature 以保证稳定性
            max_tokens: 1024,
        });

        console.log(`\n✅ 翻译结果:`);
        console.log(`----------------------------------------`);
        console.log(response.choices[0]?.message.content);
        console.log(`----------------------------------------`);

    } catch (error: any) {
        console.error(`\n❌ API请求失败:`, error.message);
        if (error.message.includes('404')) {
            console.error(`提示：该模型可能暂未在 Hugging Face 免费 Serverless API 完全部署，或端点处于休眠状态。可以尝试更小的模型 'google/translategemma-4b'。`);
        }
    }
}

testTranslateGemma();
