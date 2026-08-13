import assert from "node:assert/strict";
import { analyzeJudgmentWithKimi } from "../server/kimi-judgment.mjs";

process.env.KIMI_API_KEY = "local-pipeline-check";
process.env.KIMI_BASE_URL = "https://mock.kimi.local/v1";

const blocks = Array.from({ length: 12 }, (_, index) => ({
  id: `block-${index + 1}`,
  page: index + 1,
  readingOrder: 0,
  text: `${index < 4 ? "当事人主张" : index < 8 ? "法院认定事实及证据" : "法律适用、法院说理与裁判结果"}。${"本段为裁判文书管线覆盖测试。".repeat(600)}`,
  bbox: [40, 80, 520, 120],
}));

const document = {
  id: "judgment-pipeline-check",
  kind: "judgment",
  title: "裁判文书全文分析管线测试",
  blocks,
  outline: blocks.map((block) => ({ title: `第 ${block.page} 页`, page: block.page, blockId: block.id })),
};

let mapRequests = 0;
let reduceRequests = 0;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  const system = String(body.messages?.[0]?.content || "");
  const prompt = String(body.messages?.[1]?.content || "");
  let result;

  if (system.includes("裁判文书分段分析器")) {
    mapRequests += 1;
    const sourceBlockIds = [...prompt.matchAll(/\[P\d+#([^\]]+)\]/g)].map((match) => match[1]);
    result = {
      sectionSummary: "本段包含裁判推理材料",
      issues: [{
        title: `裁判节点 ${mapRequests}`,
        stage: mapRequests === 1 ? "争议焦点" : "法院说理",
        claim: "原告主张被告承担责任。",
        courtFact: "法院依据在案证据认定相关事实。",
        evidence: ["书证及其证明对象"],
        laws: ["原文明示法律规范"],
        reasoning: "法院连接事实、规范与结论。",
        conclusion: "形成当前节点结论。",
        sourceBlockIds: sourceBlockIds.slice(0, 2),
        confidence: 88,
      }],
      warnings: [],
    };
  } else {
    reduceRequests += 1;
    const candidateIds = [...prompt.matchAll(/"candidateId":"([^"]+)"/g)].map((match) => match[1]);
    result = {
      caseSummary: {
        caseNumber: "（2026）测01民终1号",
        court: "测试法院",
        cause: "测试案由",
        documentType: "民事判决书",
        procedure: "二审",
        decisionDate: "2026-07-20",
        result: "维持原判",
      },
      issues: candidateIds.map((candidateId, index) => ({
        candidateIds: [candidateId],
        title: `全案节点 ${index + 1}`,
        stage: index === 0 ? "争议焦点" : "法院说理",
        confidence: 86,
      })),
      warnings: [],
    };
  }

  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(result) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const progress = [];
const analysis = await analyzeJudgmentWithKimi(document, "法院如何形成裁判结论？", {
  onProgress: async (event) => progress.push(event.stage),
});

assert.ok(mapRequests >= 2, "长裁判文书必须拆成多个连续分段分析");
assert.equal(reduceRequests, 1, "全案只应执行一次综合分析");
assert.equal(analysis.pipeline.analyzedSections, mapRequests);
assert.equal(analysis.pipeline.textCoverage, 1);
assert.equal(analysis.analysisType, "judgment_reasoning");
assert.ok(analysis.issues.length >= 2);
assert.ok(analysis.issues.every((issue) => issue.sourceAnchors.length > 0), "每个裁判节点必须能回到原文锚点");
assert.ok(progress.includes("synthesizing_judgment"));
assert.ok(progress.includes("finalizing_judgment_anchors"));

console.log(`judgment pipeline ok: ${mapRequests} map requests, ${analysis.issues.length} anchored issues, 100% text coverage`);
