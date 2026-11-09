export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 401 && !path.startsWith("/api/session")) {
    window.location.href = "/login";
    throw new Error("需要管理口令");
  }
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
  return body as T;
}
