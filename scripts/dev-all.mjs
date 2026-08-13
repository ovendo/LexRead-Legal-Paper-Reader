import { spawn } from "node:child_process";
import net from "node:net";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const webHost = valueAfter("--host", "127.0.0.1");
const webPort = Number(valueAfter("--port", process.env.LEXREAD_WEB_PORT ?? "4173"));

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)));
  });
}

async function chooseApiPort() {
  const requested = Number(process.env.LEXREAD_API_PORT ?? "8787");
  for (let port = requested; port < requested + 10; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("无法找到可用的 LexRead API 端口（8787–8796）。");
}

const apiPort = await chooseApiPort();
const childEnv = { ...process.env, LEXREAD_API_PORT: String(apiPort) };
const children = [];

function start(command, commandArgs) {
  const child = spawn(command, commandArgs, { stdio: "inherit", env: childEnv });
  children.push(child);
  return child;
}

const api = start(process.execPath, ["--watch", "server/index.mjs"]);
const web = start(process.execPath, ["node_modules/vite/bin/vite.js", "--host", webHost, "--port", String(webPort), "--strictPort"]);

console.log(`LexRead Web: http://${webHost}:${webPort}/workspace`);
console.log(`LexRead API: http://127.0.0.1:${apiPort}/api/health`);

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 100).unref();
}

api.once("exit", (code) => { if (!stopping) stop(code ?? 1); });
web.once("exit", (code) => { if (!stopping) stop(code ?? 1); });
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
process.once("SIGHUP", () => stop(0));
