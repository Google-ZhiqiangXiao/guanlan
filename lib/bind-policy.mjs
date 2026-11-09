/** 与启动脚本、服务端共用。非回环地址必须带至少 16 位管理口令。 */

export function isLoopbackHost(host) {
  const value = String(host || "")
    .trim()
    .toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1" || value === "[::1]";
}

export function evaluateBindPolicy(host, token) {
  const secret = typeof token === "string" ? token : "";
  if (isLoopbackHost(host)) return { ok: true };
  if (secret.length >= 16) return { ok: true };
  return {
    ok: false,
    reason:
      "拒绝启动：监听地址不是本机回环。不要把没有口令的管理台暴露到局域网或公网。请改回 HOST=127.0.0.1，或设置至少 16 位的 ADMIN_TOKEN。",
  };
}
