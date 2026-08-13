<div align="center">

# LexRead

以研究任务为中心，在保留 PDF 原文的同时重建论文论证路线与裁判推理路线，<br>
把阅读结果转化为可理解、可核验、可引用、可进入写作流程的结构化研究材料。

<a href="https://ovendo.github.io/LexRead-Legal-Paper-Reader/">
  <img src="docs/assets/demo-entry.svg" width="820" alt="立即进入 LexRead 在线演示">
</a>



无需安装，打开即可浏览预置研究项目。<br>
PDF 上传、OCR 与 AI 分析等完整功能，请 [下载完整版](https://github.com/ovendo/LexRead-Legal-Paper-Reader/archive/refs/heads/main.zip) 体验。

![React](https://img.shields.io/badge/React-18-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![Local First](https://img.shields.io/badge/Data-Local--first-0F9D8A)

</div>

![LexRead 项目概览](docs/assets/readme-02-project-overview.png)

## LexRead 是什么

LexRead 是一款面向深度法律研究的桌面端工作台。它关注的不是“把一篇 PDF 缩短成几段摘要”，而是帮助研究者回答更重要的问题：

- 作者究竟试图证明什么，结论是如何一步步推出的？
- 当前段落是谁的观点，在整体论证中承担什么作用？
- 法院认定了哪些事实，依据什么证据，又如何适用法律规范？
- 一项阅读判断能否返回原文、页码和上下文重新核验？
- 阅读产生的材料如何进入研究项目、论文提纲与写作过程？

> LexRead 的核心定义：把法学论文与裁判文书转化为可理解、可核验、可比较、可引用、可进入写作流程的结构化研究材料。

## 为什么需要 LexRead

法律数据库解决了“找到材料”，通用 PDF 工具解决了“快速概括”，但检索之后仍有一条漫长的研究链路。

| 研究阶段 | 常见困难 | LexRead 的处理方式 |
| --- | --- | --- |
| **选择** | 不知道文章是否值得精读、应该读哪一部分 | 围绕研究问题查看项目、材料与分析结果 |
| **理解** | 知道结论，却不知道作者如何推出结论 | 重建核心问题、结论、理由、反对与回应 |
| **判断** | 无法确认观点归属、依据与适用边界 | 让关键判断绑定原文页码、上下文与核验状态 |
| **综合** | 多篇材料只能逐作者罗列 | 将观点、案例、规范和引用沉淀为研究卡片 |
| **写作** | 笔记与原文、用途和论文提纲脱节 | 在写作工作台中调用已核验材料并随时回查 |

## 三项核心价值

### 1. 重建推理路线，而不只是生成章节摘要

LexRead 尝试识别论文中的核心问题、主要结论、论证节点、观点归属、理由、反对意见与限定条件；对裁判文书，则区分当事人主张、法院认定事实、证据、争点、规范、说理和裁判结果。

### 2. AI 结果始终可以回到原文核验

研究判断保留页码、原文片段与来源关系。AI 的分析是可修改、可确认的阅读辅助，而不是替代原文的最终答案。

### 3. 阅读结果直接进入研究与写作

观点卡、案例卡、规范卡和引用卡统一进入项目资料库；完成核验后，可在写作工作台中回顾、引用和再次检查来源。

## 从 PDF 到研究成果

```text
创建研究项目，明确核心问题
              ↓
上传论文或裁判文书
              ↓
PDF 文字层解析 / 低置信页面 OCR / 目录校对
              ↓
重建论文论证路线或裁判推理路线
              ↓
沿原文阅读，核验观点、事实、证据与规范
              ↓
保存观点卡、案例卡、规范卡和引用卡
              ↓
进入项目资料库、引注校对与写作工作台
```

LexRead 不替代知网、北大法宝等专业数据库，而是承接“检索完成之后”的深度阅读、材料整理与研究转化。

## 核心功能

| 模块 | 主要能力 |
| --- | --- |
| **研究项目** | 围绕核心问题组织论文、裁判文书、研究卡片、待核验任务与写作进度 |
| **上传与解析** | 读取 PDF 原生文字层，识别低置信页面，支持 OCR、页面对照和目录校对 |
| **论文辅助阅读** | 提取核心问题、主要结论、论证节点、观点归属、理由、反对与边界 |
| **裁判文书阅读** | 区分请求、抗辩、主张事实、法院认定事实、证据、规范、说理与结果 |
| **原文核验** | 保留页码、上下文与来源锚点，让分析结果能够返回原文检查 |
| **研究材料库** | 统一管理观点卡、案例卡、规范卡与引用卡，区分待核验和已核验状态 |
| **引注校对** | 汇总研究材料与引用关系，辅助检查来源和使用状态 |
| **写作工作台** | 论文提纲、正文草稿与已核验研究材料同屏呈现 |

## 界面预览

### 选择研究项目

每个研究项目都是独立的材料空间，围绕一个核心问题组织文档、卡片和写作成果。

![LexRead 研究项目列表](docs/assets/readme-01-projects.png)

### 掌握项目全局

在项目概览中查看研究问题、文档、研究卡片、进度与待核验任务。

![LexRead 研究项目概览](docs/assets/readme-02-project-overview.png)

### 把阅读判断保存为研究卡片

保存观点时同时记录类型、归属、态度、置信度、标签、用途和核验状态。

![LexRead 研究卡片编辑](docs/assets/readme-03-research-card.png)

### 在资料库中核验与复用

按类型和状态管理观点、案例、规范与引用；只有经过核验的卡片才进入成果和引用流程。

![LexRead 项目资料库](docs/assets/readme-04-materials.png)

### 让写作始终连接来源

草稿右侧展示当前项目中可用的研究材料，便于插入正文并回查原文。

![LexRead 论文写作工作台](docs/assets/readme-05-writing.png)

## 设计原则

- **原文优先**：AI 结果服务于原文阅读，不替代原文。
- **研究任务优先**：所有文档与卡片归属于明确的研究问题和项目。
- **可溯源**：核心问题、结论、节点和研究卡片保留来源信息。
- **人机协作**：AI 重构用于辅助判断，最终核验与修改由用户完成。
- **渐进呈现**：优先展示完成当前任务所需的信息，减少标签干扰。
- **不制造虚假完成感**：阅读位置不等于理解，AI 结果不等于研究结论。

## 下载与运行

### macOS 一键启动

1. [下载完整版 ZIP](https://github.com/ovendo/LexRead-Legal-Paper-Reader/archive/refs/heads/main.zip) 并解压。
2. 双击项目根目录中的 `LexRead 一键启动.command`。
3. 启动器会检查依赖、启动本地服务并自动打开浏览器。
4. 关闭启动器终端窗口即可停止本次服务。

首次运行需要安装 [Node.js 18 或更高版本](https://nodejs.org/)。

### 使用终端启动

```bash
git clone https://github.com/ovendo/LexRead-Legal-Paper-Reader.git
cd LexRead-Legal-Paper-Reader
npm install
npm run dev
```

## 配置 AI 能力

可直接点击网页顶栏的“AI API”，按界面引导配置 Kimi、智谱或 DeepSeek；也可以复制环境变量模板：

```bash
cp .env.local.example .env.local
```

然后在 `.env.local` 中填写所需服务的 API Key。密钥只保存在本机私有配置中，不会进入前端构建或 Git 仓库。

## 数据与隐私

LexRead 当前采用本地优先的数据策略：

- 上传的原文件、解析文本、目录、分析任务和结果保存在本机 `data/` 目录。
- 阅读状态、项目卡片和写作草稿保存在本机研究空间。
- `.env.local`、`data/`、构建产物和依赖目录均已排除在 Git 之外。
- OCR 仅处理需要识别的页面；不会把整本原始 PDF 上传到 GitHub。
- API 密钥只供本地服务读取，不写入浏览器页面和仓库。

请勿在截图、聊天记录或公开 Issue 中粘贴 API Key。如果密钥曾经公开，请及时在服务商控制台轮换。

## 技术架构

```text
React + TypeScript + Vite
          ↓
本地 Express API
          ↓
PDF.js 解析 / 页面渲染 / OCR / AI 结构化分析
          ↓
本地 JSON 与文件存储
```

| 目录 | 说明 |
| --- | --- |
| `src/pages/` | 研究项目、上传解析、阅读器、资料库与写作页面 |
| `src/components/` | 应用框架、导航和通用交互组件 |
| `src/api.ts` | 前端与本地 API 的类型化通信层 |
| `src/store.tsx` | 项目、文档、阅读节点和研究卡片状态 |
| `server/` | 本地 API、PDF 解析、OCR、AI 分析与持久化 |
| `scripts/` | 一键启动、开发检查和辅助脚本 |

## 开发检查

```bash
npm run typecheck
npm run check:judgment
npm run build
```

## 当前状态

LexRead 目前是可在本地运行的 MVP，已经打通：

**研究项目 → 文档上传 → PDF 解析 / OCR → 论文或裁判分析 → 原文核验 → 研究卡片 → 资料库 / 写作**

项目仍在持续开发。AI 生成内容仅用于辅助研究，重要观点、事实、法律规范与引用应回到原文和权威法律来源中人工核验。

---

<div align="center">

### [立即进入在线演示](https://ovendo.github.io/LexRead-Legal-Paper-Reader/)

[下载完整版](https://github.com/ovendo/LexRead-Legal-Paper-Reader/archive/refs/heads/main.zip) · [查看源代码](https://github.com/ovendo/LexRead-Legal-Paper-Reader)

</div>
