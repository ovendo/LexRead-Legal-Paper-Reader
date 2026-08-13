import { callAiJson } from "./ai-provider.mjs";

const CHUNK_SIZE = 14_000;

function sourceLine(block) {
  return `[${block.id}][第${block.page}页] ${block.text}`;
}

function chunksFor(blocks) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const block of blocks) {
    const line = sourceLine(block) + "\n";
    if (current.length && length + line.length > CHUNK_SIZE) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(block);
    length += line.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const PROMPT = `你是法学论文的目录编辑。只依据给出的原文块，识别论文的实质论证结构并输出目录。
硬约束：
1. 按实体内容判断，不得依据字号、加粗、居中、缩进、编号或页码位置判断。
2. 目录只包含承担论文结构功能的内容：摘要、引言、问题提出、概念界定、规范/案例/比较分析、制度构造、结论、参考文献等。
3. 普通短句、作者和期刊信息、引文、脚注、页眉页脚、页码均不得进入目录。
4. 每个条目必须使用输入中完全存在的 blockId；无法确认时不要输出。层级只按论证包含关系判断。
5. 只返回 JSON：{"outline":[{"blockId":"b-1-1","title":"原文标题","level":1,"confidence":0.9}]}。不要 Markdown 或其他文字。`;

export async function generateOutlineWithAi(document) {
  const blocks = (document.blocks ?? []).filter((block) => block.blockType !== "footnote" && block.blockType !== "header" && block.blockType !== "footer" && block.blockType !== "page_number" && String(block.text ?? "").trim());
  if (!blocks.length) throw new Error("文档没有可用于生成目录的文字块。");
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const results = [];
  for (const chunk of chunksFor(blocks)) {
    const { data } = await callAiJson({ systemPrompt: PROMPT, userPrompt: chunk.map(sourceLine).join("\n"), maxTokens: 3_000 });
    for (const item of Array.isArray(data?.outline) ? data.outline : []) {
      const block = blockMap.get(String(item?.blockId ?? ""));
      if (!block) continue;
      results.push({
        blockId: block.id,
        title: String(item.title ?? block.text).replace(/\s+/g, " ").trim().slice(0, 180),
        level: Math.max(1, Math.min(4, Number(item.level) || 1)),
        page: block.page,
        confidence: Math.max(0.45, Math.min(0.98, Number(item.confidence) || 0.72)),
      });
    }
  }
  return results
    .filter((item, index, all) => all.findIndex((candidate) => candidate.blockId === item.blockId) === index)
    .sort((left, right) => blockMap.get(left.blockId).page - blockMap.get(right.blockId).page || blocks.findIndex((block) => block.id === left.blockId) - blocks.findIndex((block) => block.id === right.blockId))
    .slice(0, 160)
    .map((item, index) => ({ id: `outline-ai-${index + 1}`, ...item, source: "ai_format" }));
}
