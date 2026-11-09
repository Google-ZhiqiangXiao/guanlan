import { evaluateBindPolicy } from "../bind-policy.mjs";
import { startScheduler } from "./runtime";

export function assertBindPolicy() {
  const host = process.env.HOST || "127.0.0.1";
  const decision = evaluateBindPolicy(host, process.env.ADMIN_TOKEN);
  if (!decision.ok) {
    console.error(decision.reason);
    process.exit(1);
  }
}

export function boot() {
  assertBindPolicy();
  startScheduler();
}
