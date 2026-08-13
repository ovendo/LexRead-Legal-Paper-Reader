const PROVIDER_DEFAULTS = {
  kimi: {
    // 文本任务默认选择响应最快的通用模型；OCR 仍由独立配置决定。
    analysisModel: "moonshot-v1-32k",
    ocrModel: "moonshot-v1-8k-vision-preview",
    baseUrl: "https://api.moonshot.cn/v1",
  },
  zhipu: {
    analysisModel: "glm-4-flash",
    ocrModel: "glm-ocr",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  deepseek: {
    analysisModel: "deepseek-chat",
    baseUrl: "https://api.deepseek.com/v1",
  },
};

const PROVIDER_OPTIONS = {
  kimi: {
    analysis: [
      { value: "moonshot-v1-32k", label: "Moonshot V1 32K (默认·最快)" },
      { value: "moonshot-v1-128k", label: "Moonshot V1 128K (快)" },
      { value: "kimi-k2.6", label: "K2.6 (慢但准)" },
      { value: "kimi-k2.5", label: "K2.5" },
    ],
    ocr: [],
  },
  zhipu: {
    analysis: [
      { value: "glm-4-flash", label: "GLM-4-Flash (推荐·最快)" },
      { value: "glm-4-plus", label: "GLM-4-Plus" },
      { value: "glm-4", label: "GLM-4" },
      { value: "glm-4-air", label: "GLM-4-Air" },
    ],
    ocr: [
      { value: "glm-ocr", label: "GLM-OCR 专用 (推荐·最准·最快)" },
      { value: "glm-4v-flash", label: "GLM-4V-Flash OCR" },
      { value: "glm-4v", label: "GLM-4V OCR" },
    ],
  },
  deepseek: {
    analysis: [
      { value: "deepseek-chat", label: "DeepSeek Chat (默认·最快)" },
    ],
    ocr: [],
  },
};

export function getProviderOptions() {
  return PROVIDER_OPTIONS;
}

export function getOcrConfig() {
  const provider = process.env.LEXREAD_OCR_PROVIDER || process.env.AI_PROVIDER || "zhipu";
  const key = provider === "zhipu" ? process.env.ZHIPU_API_KEY || process.env.AI_API_KEY : process.env.KIMI_API_KEY || process.env.AI_API_KEY;
  const baseUrl = provider === "zhipu"
    ? (process.env.ZHIPU_BASE_URL || process.env.AI_BASE_URL || "https://open.bigmodel.cn/api/paas/v4")
    : (process.env.KIMI_BASE_URL || process.env.AI_BASE_URL || "https://api.moonshot.cn/v1");
  const model = process.env.LEXREAD_OCR_MODEL || process.env.AI_OCR_MODEL || PROVIDER_DEFAULTS[provider]?.ocrModel || "glm-ocr";
  return { provider, apiKey: key, baseUrl: baseUrl.replace(/\/$/, ""), model };
}

export function getTextConfig() {
  const provider = process.env.LEXREAD_TEXT_PROVIDER || process.env.AI_PROVIDER || "kimi";
  const key = provider === "zhipu" ? process.env.ZHIPU_API_KEY || process.env.AI_API_KEY
    : provider === "deepseek" ? process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY
      : process.env.KIMI_API_KEY || process.env.AI_API_KEY;
  const baseUrl = provider === "zhipu"
    ? (process.env.ZHIPU_BASE_URL || process.env.AI_BASE_URL || "https://open.bigmodel.cn/api/paas/v4")
    : provider === "deepseek" ? (process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL || "https://api.deepseek.com/v1")
      : (process.env.KIMI_BASE_URL || process.env.AI_BASE_URL || "https://api.moonshot.cn/v1");
  const model = process.env.LEXREAD_TEXT_MODEL || process.env.AI_MODEL || PROVIDER_DEFAULTS[provider]?.analysisModel || "moonshot-v1-32k";
  return { provider, apiKey: key, baseUrl: baseUrl.replace(/\/$/, ""), model };
}

export function getProviderConfig() {
  const cfg = getTextConfig();
  return { provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model, ocrModel: getOcrConfig().model };
}

function providerApiOptions(provider, model) {
  if (provider === "kimi") {
    if (model === "kimi-k3") return { reasoning_effort: "low" };
    if (/^kimi-k2\.(5|6)$/.test(model)) return { thinking: { type: "disabled" }, temperature: 0.6 };
    return { temperature: 0.3 };
  }
  if (provider === "zhipu") {
    return { temperature: 0.3 };
  }
  if (provider === "deepseek") return { temperature: 0.3 };
  return { temperature: 0.3 };
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 504);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callAiJson({ systemPrompt, userPrompt, maxTokens = 8_000 }) {
  const config = getTextConfig();
  const { provider, apiKey, baseUrl, model } = config;

  if (!apiKey) throw new Error(`${providerLabel(provider)} API 尚未配置。`);

  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const body = {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        ...providerApiOptions(provider, model),
        max_tokens: maxTokens,
        stream: false,
      };

      if (provider === "kimi" || provider === "deepseek") {
        body.response_format = { type: "json_object" };
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });

      if (!response.ok) {
        let message = `${providerLabel(provider)} API 请求失败（HTTP ${response.status}）`;
        try {
          const payload = await response.json();
          if (payload?.error?.message) message += `：${String(payload.error.message).slice(0, 300)}`;
        } catch { /* keep sanitized */ }
        const error = new Error(message);
        if (!retryableStatus(response.status) || attempt === 2) throw error;
        await sleep(800 * 2 ** attempt);
        continue;
      }

      const completion = await response.json();
      const content = completion?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error(`${providerLabel(provider)} 未返回分析正文。`);
      }
      return { data: safeJsonParse(content, provider), usage: completion.usage ?? null };
    } catch (error) {
      lastError = error;
      if (!error?.retryable || attempt === 2) break;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function callZhipuLayoutParsing({ dataUrl, pageNumber }) {
  const config = getOcrConfig();
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error("智谱 API 尚未配置。");

  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/api\/paas\/v4$/, "")}/api/paas/v4/layout_parsing`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "glm-ocr",
          file: dataUrl,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        let message = `智谱 OCR 请求失败（HTTP ${response.status}）`;
        try {
          const payload = await response.json();
          if (payload?.error?.message) message += `：${String(payload.error.message).slice(0, 240)}`;
        } catch { /* keep sanitized */ }
        const error = new Error(message);
        if (!retryableStatus(response.status) || attempt === 2) throw error;
        await sleep(800 * 2 ** attempt);
        continue;
      }

      const result = await response.json();
      const mdResults = String(result.md_results ?? "");
      const layoutDetails = Array.isArray(result.layout_details) ? result.layout_details : [];
      const pageLayouts = layoutDetails.flatMap((pageItems) => (Array.isArray(pageItems) ? pageItems : []));

      if (!pageLayouts.length && !mdResults) throw new Error(`智谱 OCR 未返回第 ${pageNumber} 页内容。`);

      const blocks = pageLayouts
        .filter((item) => ["text", "formula", "table"].includes(item.label))
        .map((item, index) => {
          const bbox = Array.isArray(item.bbox_2d) && item.bbox_2d.length === 4
            ? item.bbox_2d.map(Number)
            : [0, 0, 1, 1];
          const x = Math.max(0, (bbox[0] || 0)) * 1000;
          const y = Math.max(0, (1 - (bbox[3] || 1))) * 1000;
          const w = Math.max(0, (bbox[2] || 1) - (bbox[0] || 0)) * 1000;
          const h = Math.max(0, (bbox[3] || 1) - (bbox[1] || 0)) * 1000;
          return {
            index: item.index ?? index + 1,
            label: item.label === "formula" ? "text" : item.label,
            content: String(item.content ?? "").slice(0, 6000),
            bbox: [x, y, w, h],
          };
        });

      return { blocks, mdResults, model: result.model ?? "glm-ocr", usage: result.usage ?? null };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!error?.retryable || attempt === 2) break;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastError ?? new Error("智谱 OCR 请求失败。");
}
export async function callAiVision({ dataUrl, systemPrompt, userPrompt, maxTokens = 7_000 }) {
  const config = getOcrConfig();
  const { provider, apiKey, baseUrl, model } = config;

  if (!apiKey) throw new Error(`${providerLabel(provider)} API 尚未配置。`);

  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          { type: "text", text: userPrompt },
        ],
      },
    ],
    max_tokens: model.includes("8k") ? 7_000 : 16_000,
    temperature: 0,
    stream: false,
  };

  if (provider === "kimi") {
    body.thinking = { type: "disabled" };
    body.response_format = { type: "json_object" };
  }
  if (provider === "zhipu") {
    body.do_sample = false;
  }

  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });

    if (response.ok) {
      try {
        const completion = await response.json();
        const content = completion?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
          throw new Error(`${providerLabel(provider)} 视觉 API 未返回正文。`);
        }
        return { data: safeJsonParse(content, provider), usage: completion.usage ?? null };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === 2) break;
        await sleep(500 * 2 ** attempt);
        continue;
      }
    }

    let upstreamMessage = "";
    try {
      const payload = await response.json();
      upstreamMessage = payload?.error?.message ? String(payload.error.message).slice(0, 240) : "";
    } catch { /* retain status-only error */ }
    lastError = new Error(`${providerLabel(provider)} 视觉 API 请求失败（HTTP ${response.status}）${upstreamMessage ? `：${upstreamMessage}` : ""}`);
    if (!retryableStatus(response.status) || attempt === 2) break;
    await sleep(retryDelay(response, attempt));
  }
  throw lastError ?? new Error(`${providerLabel(provider)} 视觉 API 请求失败。`);
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(15_000, retryAfter * 1000);
  return Math.min(8_000, 800 * 2 ** attempt);
}

function providerLabel(provider) {
  return provider === "zhipu" ? "智谱" : provider === "deepseek" ? "DeepSeek" : "Kimi";
}

function safeJsonParse(content, provider) {
  const label = providerLabel(provider);
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error(`${label} 未返回可解析的 JSON 结果。`);
  }
}
