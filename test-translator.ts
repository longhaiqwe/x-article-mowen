import { Translator } from './libs/translator';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'; // Or you can map it to DeepSeek, etc.

async function main() {
    if (!OPENAI_API_KEY) {
        console.error('❌ Error: OPENAI_API_KEY is not set in .env');
        process.exit(1);
    }

    const testMarkdown = `
# Human 3.0 – A Map To Reach The Top 1%
![图像](https://pbs.twimg.com/media/HBUzlGwbcAUboWU?format=jpg&name=small)

As corny as this may sound, I've always wanted to become an **absolute unit** of an individual.

Not just having a nice and muscular body, but to be fully developed in every domain of life. I wanted to max out all of my stats. I didn't want to be an NPC. I wanted to be a level 100 player.
`;

    console.log(`Starting translation test with model: ${MODEL}\n`);
    const translator = new Translator(OPENAI_API_KEY, OPENAI_BASE_URL, MODEL);

    try {
        const result = await translator.translateMarkdown(testMarkdown);

        console.log('\n--- Literal Translation ---');
        console.log(result.literalTranslation);
        console.log('\n---------------------------\n');

        console.log('--- Refined Translation ---');
        console.log(result.refinedTranslation);
        console.log('\n---------------------------\n');

        fs.writeFileSync('output-translation-test.md', result.refinedTranslation);
        console.log('✅ Refined translation saved to output-translation-test.md');
    } catch (error) {
        console.error('❌ Translation failed:', error);
    }
}

main();
