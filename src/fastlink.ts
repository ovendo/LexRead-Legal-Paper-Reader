import type { AppState } from "./types";

export const FASTLINK_BASE = "https://kv.3ceng.cn/f/6a77f36feb4137140b832ae9";

const MAX_VALUE_BYTES = 32 * 1024;
const MAX_BATCH_SIZE = 50;
const CHUNK_TARGET_BYTES = 24 * 1024;
const SNAPSHOT_VERSION = 1;

type SnapshotField = "projects" | "annotations" | "cards" | "matrixEntries" | "writingDrafts" | "tasks" | "selectedProjectId";

export type FastLinkSnapshot = Pick<AppState, SnapshotField>;

interface SnapshotManifest {
  version: number;
  updatedAt: string;
  chunks: Partial<Record<Exclude<SnapshotField, "selectedProjectId">, string[]>>;
  selectedProjectId: string;
}

interface FastLinkFailurePayload {
  ok?: boolean;
  code?: string;
  message?: string;
}

export class FastLinkError extends Error {
  constructor(message: string, public readonly code?: string, public readonly status?: number) {
    super(message);
    this.name = "FastLinkError";
  }
}

function getVisitorId() {
  return localStorage.getItem("vid") || (() => {
    const v = crypto.randomUUID();
    localStorage.setItem("vid", v);
    return v;
  })();
}

function namespaceKey(name: string) {
  return `lexread:v${SNAPSHOT_VERSION}:${getVisitorId()}:${name}`;
}

function bytesOf(value: string) {
  return new TextEncoder().encode(value).length;
}

function failureMessage(code?: string) {
  switch (code) {
    case "QUOTA_EXCEEDED": return "快链云端空间已满（最多 2MB / 5000 条）。请减少备份内容后重试。";
    case "VALUE_TOO_LARGE": return "有一段研究资料超过 32KB，无法写入快链。请缩短单条长笔记后重试。";
    case "429": return "快链请求过于频繁，请稍等片刻再试。";
    default: return "快链云端同步失败，请检查网络后重试。";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${FASTLINK_BASE}${path}`, {
      ...init,
      // Do not attach application/json to GET/DELETE: it would cause an unnecessary CORS preflight.
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new FastLinkError("无法连接快链云端，请检查网络后重试。");
  }

  const payload = await response.json().catch(() => ({})) as FastLinkFailurePayload & T;
  if (!response.ok || payload.ok === false) {
    const code = payload.code ?? (response.status === 429 ? "429" : undefined);
    throw new FastLinkError(payload.message || failureMessage(code), code, response.status);
  }
  return payload;
}

type KeyValue = { key: string; value: string };

function splitIntoBatches<T>(items: T[], size = MAX_BATCH_SIZE) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function setValues(entries: KeyValue[]) {
  for (const entry of entries) {
    if (bytesOf(entry.value) > MAX_VALUE_BYTES) {
      throw new FastLinkError(failureMessage("VALUE_TOO_LARGE"), "VALUE_TOO_LARGE", 413);
    }
  }
  for (const batch of splitIntoBatches(entries)) {
    await request("/set", { method: "PUT", body: JSON.stringify(batch) });
  }
}

async function getValues(keys: string[]) {
  if (!keys.length) return {} as Record<string, string | undefined>;
  const data: Record<string, string | undefined> = {};
  for (const batch of splitIntoBatches(keys)) {
    const query = new URLSearchParams();
    batch.forEach((key) => query.append("key", key));
    const response = await request<{ ok: true; data: Record<string, string> }>(`/get?${query.toString()}`);
    Object.assign(data, response.data);
  }
  return data;
}

async function removeValues(keys: string[]) {
  for (const batch of splitIntoBatches(keys)) {
    const query = new URLSearchParams();
    batch.forEach((key) => query.append("key", key));
    await request(`/del?${query.toString()}`, { method: "DELETE" });
  }
}

function chunkItems(items: unknown[], prefix: string): KeyValue[] {
  if (!items.length) return [];
  const groups: unknown[][] = [];
  let group: unknown[] = [];
  for (const item of items) {
    const candidate = [...group, item];
    if (bytesOf(JSON.stringify(candidate)) > CHUNK_TARGET_BYTES && group.length) {
      groups.push(group);
      group = [item];
    } else {
      group = candidate;
    }
    if (bytesOf(JSON.stringify(group)) > MAX_VALUE_BYTES) {
      throw new FastLinkError(failureMessage("VALUE_TOO_LARGE"), "VALUE_TOO_LARGE", 413);
    }
  }
  if (group.length) groups.push(group);
  return groups.map((value, index) => ({ key: namespaceKey(`${prefix}:${index}`), value: JSON.stringify(value) }));
}

function makeSnapshot(state: AppState): FastLinkSnapshot {
  // Document binaries, OCR/full-text output and AI credentials deliberately stay local.
  const { projects, annotations, cards, matrixEntries, writingDrafts, tasks, selectedProjectId } = state;
  return { projects, annotations, cards, matrixEntries, writingDrafts, tasks, selectedProjectId };
}

async function getPreviousManifest() {
  const key = namespaceKey("manifest");
  const raw = (await getValues([key]))[key];
  if (!raw) return undefined;
  try {
    const manifest = JSON.parse(raw) as SnapshotManifest;
    return manifest.version === SNAPSHOT_VERSION ? manifest : undefined;
  } catch {
    return undefined;
  }
}

export async function backupResearchState(state: AppState) {
  const snapshot = makeSnapshot(state);
  const previous = await getPreviousManifest();
  const fields: Exclude<SnapshotField, "selectedProjectId">[] = ["projects", "annotations", "cards", "matrixEntries", "writingDrafts", "tasks"];
  const entries = fields.flatMap((field) => chunkItems(snapshot[field], field));
  const chunks = Object.fromEntries(fields.map((field) => [field, entries.filter((entry) => entry.key.includes(`:${field}:`)).map((entry) => entry.key)])) as SnapshotManifest["chunks"];
  const manifest: SnapshotManifest = { version: SNAPSHOT_VERSION, updatedAt: new Date().toISOString(), chunks, selectedProjectId: snapshot.selectedProjectId };
  const manifestEntry = { key: namespaceKey("manifest"), value: JSON.stringify(manifest) };

  // First write all data, then publish the manifest so a failed backup never becomes restorable as a partial backup.
  await setValues(entries);
  await setValues([manifestEntry]);

  const oldKeys = Object.values(previous?.chunks ?? {}).flat();
  const currentKeys = new Set(entries.map((entry) => entry.key));
  const obsoleteKeys = oldKeys.filter((key) => !currentKeys.has(key));
  if (obsoleteKeys.length) await removeValues(obsoleteKeys);

  const usage = await request<{ ok: true; items: number; maxItems: number; bytes: number; maxBytes: number }>("/usage");
  return { updatedAt: manifest.updatedAt, usage };
}

export async function restoreResearchState(): Promise<FastLinkSnapshot & { updatedAt: string }> {
  const manifestKey = namespaceKey("manifest");
  const rawManifest = (await getValues([manifestKey]))[manifestKey];
  if (!rawManifest) throw new FastLinkError("未找到此设备的快链云端备份。", "NOT_FOUND", 404);

  let manifest: SnapshotManifest;
  try {
    manifest = JSON.parse(rawManifest) as SnapshotManifest;
  } catch {
    throw new FastLinkError("快链云端备份格式异常，无法恢复。", "INVALID_BACKUP");
  }
  if (manifest.version !== SNAPSHOT_VERSION) throw new FastLinkError("该备份版本不受当前页面支持。", "UNSUPPORTED_BACKUP");

  const fields: Exclude<SnapshotField, "selectedProjectId">[] = ["projects", "annotations", "cards", "matrixEntries", "writingDrafts", "tasks"];
  const keys = fields.flatMap((field) => manifest.chunks[field] ?? []);
  const data = await getValues(keys);
  const snapshot = { selectedProjectId: manifest.selectedProjectId, updatedAt: manifest.updatedAt } as FastLinkSnapshot & { updatedAt: string };
  for (const field of fields) {
    const values = (manifest.chunks[field] ?? []).flatMap((key) => {
      try {
        const parsed = JSON.parse(data[key] ?? "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        throw new FastLinkError("快链云端备份内容损坏，无法安全恢复。", "INVALID_BACKUP");
      }
    });
    (snapshot as Record<string, unknown>)[field] = values;
  }
  return snapshot;
}
