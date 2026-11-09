export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.npm_lifecycle_event === "build") return;
  const { boot } = await import("./lib/server/boot");
  boot();
}
