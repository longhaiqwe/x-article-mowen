# Product Requirements Document (PRD)
**项目：** X-Article 到墨问 (Mowen) 自动翻译与发布系统
**当前状态：** 构思与方案设计阶段
**最后更新：** 2026-02-24

## 1. 产品概述 (Product Overview)
本系统旨在解决用户阅读和转译 X (Twitter) 平台上深度长文 (X Articles / Long Tweets) 的痛点。通过自动化工作流，系统能够提取难以直接访问的长文原文内容，经由 AI 进行高质量的中文翻译与润色，并最终以结构化的笔记形式发布至“墨问”平台，极大地降低用户的阅读门槛和操作成本。

## 2. 目标用户与使用场景 (Target Audience & Scenarios)
**目标用户：** 频繁阅读海外深度技术/商业/研究长文，并希望在中文内容社区（墨问）沉淀和分享这些高质量内容的用户。
**使用场景：**
1. 用户看到一篇优秀的 X Article 链接。
2. 用户将链接输入系统（或发送给机器人的 Webhook）。
3. 稍等片刻后，用户在自己的墨问主页上看到了一篇排版精美、翻译流畅的中文版长文，且包含了原文的配图和必要的链接引用。

## 3. 核心功能与模块 (Core Features & Modules)

### 3.1 内容提取模块 (Data Ingestion)
- **输入支持：** 支持处理标准的 X 状态链接（如 `https://twitter.com/thedankoe/status/2023779299367809063`）及直接的 Article 链接。
- **获取能力：** 能够应对 X 的风控（如必需登录、限制机器访问等），完整提取出隐匿在推文背后的 Article 完整标题、段落、引用及媒体图片。
- **格式转化：** 统一将提取到的复杂 HTML 或 JSON 结构清洗为标准 Markdown 格式。

### 3.2 AI 智能翻译与润色引擎 (Translation Engine)
_参考“文润 (wenrun.ai)”平台的多级流水线设计。_
- **直译阶段 (Literal Translation)：** 借助大语言模型准确保留原语言的技术术语、逻辑结构及全部细节。
- **润色阶段 (Refinement)：** 将初筛译文与原文进行对照，消除“机器翻译腔”，使之符合中文母语使用者的阅读习惯，达到“自然、流畅甚至富有深度”的文风效果。
- **排版还原：** 确保润色后保留了 Markdown 原有的各类格式标记（加粗、倾斜、标题层级、超链接以及配图标记等）。

### 3.3 墨问同步发布模块 (Mowen Publisher)
- **AST 解析 (Markdown -> NoteAtom)：** 根据墨问 OpenAPI 规范（NoteAtom），将 Markdown 文本精确解析并转化为墨问特有的原子节点结构（包含 `doc`, `paragraph`, `text`, `image`, `marks` 等类型）。
- **资源转存 (Asset Migration)：** 若源图片存在防盗链，支持在后端下载后，调用墨问文件上传 API 进行云端转存并替换原 URL / uuid。
- **一键发布接口：** 利用用户的 `API-KEY` 进行权限校验，自动调用 `NoteCreate` 接口推送至平台，并支持自动发布选项。

## 4. 技术栈选型 (Tech Stack)
* **编程语言：** Node.js (TypeScript)
* **爬取方式：** 无头浏览器 (Playwright + 本地 Cookie，绕过风控)
* **AI 代理框架：** 手写代码直接调用大模型 API (如 Gemini/DeepSeek/OpenAI) 编排多轮翻译流

## 5. 里程碑与后续规划 (Milestones & Roadmap)
1. [ ] **第一阶段 - 概念验证 (PoC)：** 成功利用脚本将一篇随机的 X Article 抽取出 Markdown原文。
2. [ ] **第二阶段 - 翻译流调优：** 将一段 500 字的双语长难句放入 Prompt 工作流中，验收润色的质量与 Markdown 格式保持率。
3. [ ] **第三阶段 - 墨问 API 对接：** 编写一个基于测试 Markdown 的解析器，向墨问发送发布请求，并确保返回成功的 `noteId`。
4. [ ] **第四阶段 - 整体联调 (End-to-End)：** 将提取、翻译、发布三个模块无缝串联形成可执行的完整工具。

## 6. 修订记录 (Revision History)
* **2026-02-24:** 首次建立文档，记录核心三段式业务流（提取 -> 翻译 -> 发布），同步了文润的翻译理念与墨问开放API的要求。
