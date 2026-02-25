import * as dotenv from 'dotenv';
dotenv.config();

const MOWEN_API_KEY = process.env.MOWEN_API_KEY || '';

async function main() {
    const endpoints = [
        { url: 'https://open.mowen.cn/api/open/api/v1/space/list', method: 'GET' },
        { url: 'https://open.mowen.cn/api/open/api/v1/space/query', method: 'GET' },
        { url: 'https://open.mowen.cn/api/open/api/v1/note/spacelist', method: 'GET' },
    ];

    for (const ep of endpoints) {
        console.log(`\nTrying [${ep.method}]: ${ep.url}`);
        try {
            const res = await fetch(ep.url, {
                method: ep.method,
                headers: {
                    'Authorization': `Bearer ${MOWEN_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            });
            const text = await res.text();
            console.log(`Status: ${res.status}`);
            console.log(`Body: ${text.substring(0, 600)}`);
        } catch (e) {
            console.error(`Error: ${(e as Error).message}`);
        }
    }
}

main();
