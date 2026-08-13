import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const projectDir = path.resolve(serverDir, "..");
export const dataDir = process.env.LEXREAD_DATA_DIR ? path.resolve(process.env.LEXREAD_DATA_DIR) : path.join(projectDir, "data");
export const uploadDir = path.join(dataDir, "uploads");
const databasePath = path.join(dataDir, "lexread.json");

const emptyDatabase = () => ({ version: 2, documents: [], jobs: [], annotations: [] });
let writeQueue = Promise.resolve();

export async function ensureStorage() {
  await mkdir(uploadDir, { recursive: true });
  try {
    await readFile(databasePath, "utf8");
  } catch {
    await writeFile(databasePath, JSON.stringify(emptyDatabase(), null, 2), "utf8");
  }
}

export async function readDatabase() {
  await ensureStorage();
  try {
    const raw = await readFile(databasePath, "utf8");
    const database = JSON.parse(raw);
    return {
      ...database,
      version: Math.max(2, Number(database.version) || 1),
      documents: Array.isArray(database.documents) ? database.documents : [],
      jobs: Array.isArray(database.jobs) ? database.jobs : [],
      annotations: Array.isArray(database.annotations) ? database.annotations : [],
    };
  } catch (error) {
    throw new Error(`无法读取 LexRead 数据文件：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeDatabase(database) {
  const temporaryPath = `${databasePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(database, null, 2), "utf8");
  await rename(temporaryPath, databasePath);
}

export function updateDatabase(mutator) {
  const operation = writeQueue.catch(() => undefined).then(async () => {
    const database = await readDatabase();
    const result = await mutator(database);
    await writeDatabase(database);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function documentFilePath(documentId) {
  return path.join(uploadDir, documentId, "original.pdf");
}

export async function saveDocumentFile(documentId, bytes) {
  const directory = path.join(uploadDir, documentId);
  await mkdir(directory, { recursive: true });
  const target = documentFilePath(documentId);
  await writeFile(target, bytes);
  return target;
}
