function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[,:;；]/g, (mark) => ({ ",": "，", ":": "：", ";": "；", "；": "；" }[mark]))
    .trim();
}

function removeMarker(value) {
  return clean(value).replace(/^(?:\[?\d{1,3}\]?|[①-⑳]|[＊*])(?:[\.、\s]+)?/, "").trim();
}

function withStop(value) {
  if (!value) return value;
  return /[。！？]$/.test(value) ? value : value + "。";
}

function page(value, suffix = "页") {
  const matches = [...value.matchAll(/(?:第\s*)?(\d+(?:\s*[-—]\s*\d+)?)\s*(?:页|条)/g)];
  const match = matches.at(-1);
  return match ? "第" + match[1].replace(/\s/g, "") + suffix : "";
}

export function normalizeLegalCitation(raw) {
  const original = removeMarker(raw);
  const title = original.match(/《([^》]+)》/);
  const issues = [];
  let type = "其他文献";
  let formatted = original;

  if (/https?:\/\//i.test(original)) {
    type = "网络资料";
    const url = original.match(/https?:\/\/[^\s，。]+/i)?.[0] ?? "";
    const beforeUrl = clean(original.slice(0, original.indexOf(url))).replace(/[，。]+$/, "");
    const access = original.match(/(?:最后)?访问(?:日期|时间)?[：:]?\s*(\d{4}[-./年]\d{1,2}[-./月]\d{1,2}日?)/)?.[1];
    if (!title) issues.push("未识别到网络资料标题");
    if (!access) issues.push("缺少访问日期");
    formatted = withStop((beforeUrl ? beforeUrl + "，" : "") + url + (access ? "，最后访问日期：" + access : ""));
  } else if (/(?:人民法院|法院).{0,30}(?:案|字)|（\d{4}）[^\s，。]{2,30}号/.test(original)) {
    type = "裁判文书";
    const court = original.match(/([^，。；：]+法院)/)?.[1];
    const number = original.match(/（\d{4}）[^\s，。；]{2,40}?号/)?.[0];
    if (!court) issues.push("未识别到审理法院");
    if (!number) issues.push("未识别到案号");
    const pinpoint = page(original);
    formatted = withStop((court ? court + "：" : "") + (number ?? "") + (title ? "《" + title[1] + "》" : "") + (pinpoint ? "，" + pinpoint : ""));
  } else if (/第\s*\d+\s*条/.test(original) || /(?:法|条例|办法|规定|解释)》/.test(original) && !/载《/.test(original)) {
    type = "法律法规";
    if (!title) issues.push("未识别到法规名称");
    if (!/第\s*\d+\s*条/.test(original)) issues.push("缺少具体条文号");
    formatted = withStop((title ? "《" + title[1] + "》" : original.replace(/[。]+$/, "")) + page(original, "条"));
  } else if (/载《/.test(original) || /\d{4}\s*年第\s*\d+\s*期/.test(original)) {
    type = "期刊论文";
    const author = original.match(/^([^：:，]+)[：:]/)?.[1];
    const source = original.match(/载《([^》]+)》/)?.[1];
    const year = original.match(/(\d{4})\s*年/)?.[1];
    const issue = original.match(/第\s*(\d+)\s*期/)?.[1];
    if (!author) issues.push("未识别到作者");
    if (!title) issues.push("未识别到篇名");
    if (!source) issues.push("未识别到刊名");
    if (!year || !issue) issues.push("缺少年份或期号");
    if (!/第\s*\d+(?:\s*[-—]\s*\d+)?\s*页/.test(original)) issues.push("缺少引证页码");
    const pinpoint = page(original);
    formatted = withStop((author ? author + "：" : "") + (title ? "《" + title[1] + "》" : "") + (source ? "，载《" + source + "》" : "") + (year ? year + "年" : "") + (issue ? "第" + issue + "期" : "") + (pinpoint ? "，" + pinpoint : ""));
  } else if (/出版社|出版/.test(original)) {
    type = "专著";
    const author = original.match(/^([^：:，]+)[：:]/)?.[1];
    const publisher = original.match(/，([^，。]*?(?:出版社|出版))/)?.[1];
    const year = original.match(/(\d{4})\s*年(?:版)?/)?.[1];
    if (!author) issues.push("未识别到作者");
    if (!title) issues.push("未识别到书名");
    if (!publisher || !year) issues.push("缺少出版社或版本年份");
    if (!/第\s*\d+(?:\s*[-—]\s*\d+)?\s*页/.test(original)) issues.push("缺少引证页码");
    const pinpoint = page(original);
    formatted = withStop((author ? author + "：" : "") + (title ? "《" + title[1] + "》" : "") + (publisher ? "，" + publisher : "") + (year ? year + "年版" : "") + (pinpoint ? "，" + pinpoint : ""));
  } else {
    issues.push("无法可靠识别文献类型，已保留原文");
    formatted = withStop(original);
  }

  return { type, original, formatted, issues, confidence: issues.length ? 0.62 : 0.9 };
}

export function normalizeLegalCitations(footnotes) {
  return (footnotes ?? []).map((footnote, index) => ({
    id: footnote.id ?? "citation-" + index,
    page: Number(footnote.page) || 1,
    marker: String(footnote.footnoteMarker ?? index + 1),
    ...normalizeLegalCitation(footnote.text),
  }));
}
