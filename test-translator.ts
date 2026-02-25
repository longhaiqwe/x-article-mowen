import { Translator } from './libs/translator.js';
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
        const result = await translator.translateMarkdown(
            testMarkdown,
            (stage: string, content: string) => {
                console.log(`\n\n=== Completed Stage: ${stage} ===\n`);
                // You can uncomment below to see intermediate results in console
                // console.log(content.substring(0, 200) + '...\n');
            }
        );

        console.log('\n=============================================');
        console.log('--- Draft Translation ---');
        console.log(result.draftTranslation);
        console.log('\n--- Review (Fluency) ---');
        console.log(result.reviews.fluency);
        console.log('\n--- Review (Accuracy) ---');
        console.log(result.reviews.accuracy);
        console.log('\n--- Review (Style) ---');
        console.log(result.reviews.style);
        console.log('\n--- Synthesized Translation ---');
        console.log(result.synthesizedTranslation);
        console.log('\n--- Final Polish Translation ---');
        console.log(result.finalTranslation);
        console.log('=============================================\n');

        fs.writeFileSync('output-translation-test.md', result.finalTranslation);
        fs.writeFileSync('output-translation-debug.json', JSON.stringify(result, null, 2));
        console.log('✅ Final translation saved to output-translation-test.md');
        console.log('✅ Full debug pipeline saved to output-translation-debug.json');
    } catch (error) {
        console.error('❌ Translation failed:', error);
    }
}

main();
