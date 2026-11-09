"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { Button, Input } from "./ui";

export function LoginView() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    try {
      await api("/api/session", { method: "POST", body: JSON.stringify({ token }) });
      window.location.href = "/";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-3xl border border-[var(--line)] bg-[var(--paper-2)] p-6">
      <h1 className="font-serif text-4xl">管理口令</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">这不是交易所密钥。只有在这台电脑把服务绑到非回环地址时才需要它。口令不会发给币安。</p>
      <Input className="mt-4" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="ADMIN_TOKEN" />
      {error ? <p className="mt-2 text-sm text-[var(--cinnabar)]">{error}</p> : null}
      <Button className="mt-4" onClick={submit}>
        进入
      </Button>
    </div>
  );
}
