import { MowenPublisher } from './libs/mowen.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

const MOWEN_API_KEY = process.env.MOWEN_API_KEY || '';

async function main() {
    // Read the already-scraped markdown from file
    const markdown = fs.readFileSync('output-translation-test.md', 'utf8');

    const publisher = new MowenPublisher(MOWEN_API_KEY, '');
    const atoms = await publisher.markdownToAtoms(markdown);
    const payload = {
        body: { type: 'doc', content: atoms },
        settings: { autoPublish: true }
    };

    fs.writeFileSync('debug-full-payload.json', JSON.stringify(payload, null, 2));
    console.log(`✅ Payload saved to debug-full-payload.json (${atoms.length} atoms)`);

    // Validate: walk all atoms and check for non-string text fields
    let issues = 0;
    function validateAtom(a: any, path: string) {
        if (a.text !== undefined && typeof a.text !== 'string') {
            console.error(`⚠️ Non-string text at ${path}: ${typeof a.text} = ${a.text}`);
            issues++;
        }
        if (a.attrs) {
            for (const [k, v] of Object.entries(a.attrs)) {
                if (typeof v === 'number') {
                    console.warn(`⚠️ Number value at ${path}.attrs.${k}: ${v}`);
                }
            }
        }
        if (a.content) {
            a.content.forEach((child: any, i: number) => validateAtom(child, `${path}[${i}]`));
        }
        if (a.marks) {
            a.marks.forEach((m: any, i: number) => validateAtom(m, `${path}.marks[${i}]`));
        }
    }
    payload.body.content.forEach((a: any, i: number) => validateAtom(a, `atoms[${i}]`));

    if (issues === 0) {
        console.log('\n✅ No validation issues found!');
    }

    // Try to post to Mowen
    console.log('\n--- Testing Mowen API with full article ---');
    const res = await fetch('https://open.mowen.cn/api/open/api/v1/note/create', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${MOWEN_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${text}`);
}

main();
