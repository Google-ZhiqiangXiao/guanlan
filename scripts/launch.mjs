import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { evaluateBindPolicy } from "../lib/bind-policy.mjs";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("用法: node scripts/launch.mjs dev|start");
  process.exit(1);
}

const host = process.env.HOST || "127.0.0.1";
const port = String(process.env.PORT || "47291");
const decision = evaluateBindPolicy(host, process.env.ADMIN_TOKEN);
if (!decision.ok) {
  console.error(decision.reason);
  process.exit(1);
}

process.env.HOST = host;
process.env.PORT = port;
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, mode, "--hostname", host, "--port", port], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
