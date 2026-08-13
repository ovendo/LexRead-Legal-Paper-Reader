import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const host = "127.0.0.1";
const candidatePorts = Array.from({ length: 20 }, (_, index) => 4173 + index);
const noOpen = process.argv.includes("--no-open") || process.env.LEXREAD_NO_OPEN === "1";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isLexReadRunning(port) {
  try {
    const [pageResponse, healthResponse] = await Promise.all([
      fetch(`http://${host}:${port}/workspace`, { signal: AbortSignal.timeout(700) }),
      fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(700) }),
    ]);
    if (!pageResponse.ok || !healthResponse.ok) return false;
    const [html, health] = await Promise.all([pageResponse.text(), healthResponse.json()]);
    return html.includes("LexRead 法研阅读器") && health?.service === "lexread-api";
  } catch {
    return false;
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => server.close(() => resolve(true)));
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectDir, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} 执行失败，退出码 ${code ?? "未知"}`)));
  });
}

function openBrowser(url) {
  if (noOpen) return;
  const opener = spawn("open", [url], { detached: true, stdio: "ignore" });
  opener.unref();
}

async function ensureDependencies() {
  try {
    await Promise.all([
      access(path.join(projectDir, "node_modules", ".bin", "vite")),
      access(path.join(projectDir, "node_modules", "express", "package.json")),
      access(path.join(projectDir, "node_modules", "pdfjs-dist", "package.json")),
      access(path.join(projectDir, "node_modules", "@napi-rs", "canvas", "package.json")),
    ]);
  } catch {
    console.log("首次启动：正在安装 LexRead 运行依赖，请稍候…\n");
    await run("npm", ["install", "--no-audit", "--no-fund"]);
    console.log("\n依赖安装完成。\n");
  }
}

async function findExistingInstance() {
  for (const port of candidatePorts) {
    if (await isLexReadRunning(port)) return port;
  }
  return null;
}

async function findFreePort() {
  for (const port of candidatePorts) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("4173–4192 端口均被占用，请关闭部分本地开发服务后重试。");
}

async function waitUntilReady(port, child) {
  let exited = false;
  child.once("exit", () => { exited = true; });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (exited) throw new Error("LexRead 服务在启动完成前意外退出。");
    if (await isLexReadRunning(port)) return;
    await sleep(250);
  }
  throw new Error("LexRead 启动超时，请检查上方日志。");
}

async function main() {
  const existingPort = await findExistingInstance();
  if (existingPort !== null) {
    const url = `http://${host}:${existingPort}/workspace`;
    console.log(`LexRead 已在运行，正在打开：${url}`);
    openBrowser(url);
    return;
  }

  await ensureDependencies();
  const port = await findFreePort();
  const url = `http://${host}:${port}/workspace`;

  console.log(`正在启动 LexRead：${url}\n`);
  const child = spawn(
    "npm",
    ["run", "dev", "--", "--host", host, "--port", String(port), "--strictPort"],
    { cwd: projectDir, stdio: "inherit" },
  );

  const stopChild = () => {
    if (!child.killed) child.kill("SIGINT");
  };
  process.once("SIGINT", stopChild);
  process.once("SIGTERM", stopChild);
  process.once("SIGHUP", stopChild);

  await waitUntilReady(port, child);
  console.log(`\nLexRead 已就绪：${url}`);
  console.log("浏览器将自动打开。关闭此窗口或按 Control+C 可停止服务。\n");
  openBrowser(url);

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 || code === 130 ? resolve() : reject(new Error(`LexRead 服务退出，退出码 ${code ?? "未知"}`)));
  });
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
