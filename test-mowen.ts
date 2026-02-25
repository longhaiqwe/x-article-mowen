import { MowenPublisher } from './libs/mowen.js';

async function main() {
    const publisher = new MowenPublisher('dummy-key', 'dummy-space');

    const testMarkdown = `
# 测试文章标题

这是一段测试文本，包含**加粗**和*斜体*，还有一个[超链接](https://example.com)。

![一张图片](https://pbs.twimg.com/media/HBUzlGwbcAUboWU?format=jpg&name=small)

> 这是一段引用文本。
    `;

    console.log('--- Testing Markdown to NoteAtom ---');
    const atoms = await publisher.markdownToAtoms(testMarkdown);
    const doc = { type: 'doc', content: atoms };

    console.log(JSON.stringify(doc, null, 2));
}

main();
