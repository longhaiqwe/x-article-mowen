import { Translator } from './libs/translator.js';
import type { ModelConfig } from './libs/translator.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_BASE_URL = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const ARK_MODELS: ModelConfig = {
    draft: process.env.ARK_MODEL_DRAFT || 'doubao-seed-translation-250915',
    reviewFluency: process.env.ARK_MODEL_REVIEW_FLUENCY || 'glm-4-7-251222',
    reviewAccuracy: process.env.ARK_MODEL_REVIEW_ACCURACY || 'deepseek-v3-2-251201',
    reviewStyle: process.env.ARK_MODEL_REVIEW_STYLE || 'kimi-k2-thinking-251104',
    synthesis: process.env.ARK_MODEL_SYNTHESIS || 'deepseek-v3-2-251201',
    final: process.env.ARK_MODEL_FINAL || 'doubao-seed-1-6-251015',
};

async function main() {
    if (!ARK_API_KEY) {
        console.error('❌ Error: ARK_API_KEY is not set in .env');
        process.exit(1);
    }

    const testMarkdown = `
# Human 3.0 – A Map To Reach The Top 1%
![图像](https://pbs.twimg.com/media/HBUzlGwbcAUboWU?format=jpg&name=small)

As corny as this may sound, I've always wanted to become an **absolute unit** of an individual.

Not just having a nice and muscular body, but to be fully developed in every domain of life. I wanted to max out all of my stats. I didn't want to be an NPC. I wanted to be a level 100 player.
`;

    console.log(`Starting translation test with 火山方舟 Multi-Model\n`);
    console.log(`  Draft:          ${ARK_MODELS.draft}`);
    console.log(`  Review Fluency: ${ARK_MODELS.reviewFluency}`);
    console.log(`  Review Accuracy:${ARK_MODELS.reviewAccuracy}`);
    console.log(`  Review Style:   ${ARK_MODELS.reviewStyle}`);
    console.log(`  Synthesis:      ${ARK_MODELS.synthesis}`);
    console.log(`  Final:          ${ARK_MODELS.final}\n`);

    const translator = new Translator(ARK_API_KEY, ARK_BASE_URL, ARK_MODELS);

    try {
        const result = await translator.translateMarkdown(
            testMarkdown,
            (stage: string, content: string) => {
                console.log(`\n\n=== Completed Stage: ${stage} ===\n`);
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
