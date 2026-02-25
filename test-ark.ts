import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const apiKey = process.env.ARK_API_KEY || '';
const baseURL = process.env.ARK_BASE_URL || '';
const model = process.env.ARK_MODEL_DRAFT || '';

console.log(`Testing API connection...`);
console.log(`  Base URL: ${baseURL}`);
console.log(`  Model: ${model}`);
console.log(`  API Key: ${apiKey.substring(0, 8)}...`);

const client = new OpenAI({ apiKey, baseURL });

async function test() {
    try {
        console.log(`\n[${new Date().toISOString()}] Sending request...`);

        const stream = await client.chat.completions.create({
            model: model,
            stream: true,
            messages: [
                { role: 'system', content: '你是一个翻译助手，将英文翻译为中文。' },
                { role: 'user', content: 'Hello, how are you?' }
            ],
            temperature: 0.7,
        });

        console.log(`[${new Date().toISOString()}] Got stream, reading chunks...`);

        let full = '';
        let chunkCount = 0;
        for await (const chunk of stream) {
            chunkCount++;
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) {
                full += delta;
                process.stdout.write(delta);
            }
        }

        console.log(`\n\n[${new Date().toISOString()}] Done!`);
        console.log(`Total chunks: ${chunkCount}`);
        console.log(`Full response: ${full}`);
    } catch (err) {
        console.error(`\n[${new Date().toISOString()}] Error:`, err);
    }
}

test();
