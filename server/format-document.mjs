import { callAiJson } from "./ai-provider.mjs";

const MAX_CHARS = 12_000;

function blockLine(block, index) {
  return `[BLOCK_${index}][P${block.page}][${block.blockType}] ${block.text}`;
}

export async function formatDocumentBlocks(document) {
  const blocks = (document.blocks ?? [])
    .filter((b) => typeof b.text === "string" && b.text.trim())
    .sort((a, b) => a.page - b.page || a.readingOrder - b.readingOrder);

  if (!blocks.length) return { blocks: [], outline: [] };

  const chunks = [];
  let current = [];
  let charCount = 0;

  for (let i = 0; i < blocks.length; i++) {
    const line = blockLine(blocks[i], i) + "\n";
    if (current.length && charCount + line.length > MAX_CHARS) {
      chunks.push({ blocks: current, startIndex: chunks.reduce((s, c) => s + c.blocks.length, 0) });
      current = [];
      charCount = 0;
    }
    current.push(blocks[i]);
    charCount += line.length;
  }
  if (current.length) chunks.push({ blocks: current, startIndex: chunks.reduce((s, c) => s + c.blocks.length, 0) });

  const formatted = [];
  const semanticOutline = [];
  const usage = { requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const sourceText = chunk.blocks.map((b, j) => blockLine(b, chunk.startIndex + j)).join("\n");

    const { data, usage: u } = await callAiJson({
      systemPrompt: FORMAT_PROMPT,
      userPrompt: sourceText,
      maxTokens: 8_000,
    });

    usage.requests++;
    if (u) for (const k of ["prompt_tokens", "completion_tokens", "total_tokens"]) usage[k] += Number(u[k] ?? 0);

    if (Array.isArray(data.blocks)) {
      for (const item of data.blocks) {
        const blockIndex = Number(item.block_index);
        const originalBlock = blocks[blockIndex];
        if (!originalBlock || blockIndex < 0) continue;
        const blockType = validateBlockType(item.block_type);
        const text = String(item.text ?? originalBlock.text).trim().slice(0, 6000);
        if (!text) continue;
        formatted.push({
          ...originalBlock,
          blockType,
          text,
          formatCorrected: true,
        });
      }
    }

    if (Array.isArray(data.outline)) {
      semanticOutline.push(...data.outline.map((o) => ({
        id: "",
        title: String(o.title ?? "").trim().slice(0, 200),
        level: Math.max(1, Math.min(4, Number(o.level) || 1)),
        page: Number(o.page) || 1,
        blockId: null,
        confidence: 85,
        source: "ai_format",
      })).filter((item) => item.title));
    }
  }

  const outline = semanticOutline
    .filter((item, index, all) => all.findIndex((candidate) => candidate.title === item.title && candidate.page === item.page) === index)
    .slice(0, 160)
    .map((item, index) => ({ ...item, id: `fmt-h${index + 1}` }));

  return { blocks: formatted, outline, usage };
}

function validateBlockType(type) {
  const valid = ["heading", "paragraph", "footnote", "table", "caption"];
  return valid.includes(String(type)) ? String(type) : "paragraph";
}

const FORMAT_PROMPT = `你是法律论文结构识别器。接收 OCR 提取的逐页文本块，输出校正后的文本结构和语义目录。

硬约束：
1. 仅校正格式和结构，绝不修改原文措辞、法条引用或数字
2. 每行是一个文本块，以 [BLOCK_N][页号][类型] 开头
3. 必须为每个输入块输出一个对应的校正项（不新增、不删除块）
4. 目录必须按实体内容判断，而不是字号、粗体、缩进、居中、编号或所在位置。只把实际承担“摘要、引言、问题提出、概念界定、规范/案例/比较分析、结论、参考文献”等论证功能的文本列入目录；普通短句、作者信息、期刊信息、引文、页眉页脚、脚注和格式化编号不得列入目录。
5. 标题层级根据论证包含关系判断：全文结构为 H1，H1 下的实质论证部分为 H2，只有确实在展开上一论点的子问题才是 H3/H4。无法从内容确认层级时宁可不输出。
6. 脚注识别：以 *, ①, [1], (1) 开头、位于页底部、字号较小的文本块标为 footnote
7. 页面噪声删除：页码、页眉（重复出现的文档标题/作者名）、纯分隔线标记为删除（返回空 text）
8. 跨页断句合并：上一页尾部和下一页首部的文本如果是同一个句子断开，合并为一个块
9. 保留表格 block_type = "table"
10. 只返回 JSON，不使用 Markdown

JSON 结构：
{
  "blocks": [
    {"block_index": 0, "block_type": "heading", "text": "校正后的文本", "merged_from": []},
    {"block_index": 1, "block_type": "paragraph", "text": "校正文本"},
    {"block_index": 2, "block_type": "footnote", "text": "① 参见..."}
  ],
  "outline": [
    {"title": "一级标题", "level": 1, "page": 1},
    {"title": "二级标题", "level": 2, "page": 3}
  ]
}`;
