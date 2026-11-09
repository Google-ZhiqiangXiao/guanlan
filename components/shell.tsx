"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

const links = [
  { href: "/", label: "观察" },
  { href: "/alerts", label: "提醒" },
  { href: "/settings", label: "设置" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stop = false;
    api<{ required: boolean; authenticated: boolean }>("/api/session")
      .then((session) => {
        if (stop) return;
        if (session.required && !session.authenticated && pathname !== "/login") {
          window.location.href = "/login";
          return;
        }
        setReady(true);
      })
      .catch(() => setReady(true));
    return () => {
      stop = true;
    };
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--paper-2)]/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="block">
            <div className="font-serif text-3xl leading-none">观澜</div>
            <div className="mt-1 text-xs tracking-wide text-[var(--muted)]">公开行情观察台</div>
          </Link>
          <nav className="flex gap-1 rounded-full bg-[#efe8dc] p-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full px-4 py-2 text-sm ${pathname === link.href ? "bg-[var(--tide-ink)] text-[#f6f3ea]" : "text-[var(--ink)]"}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{ready ? children : <p className="text-sm text-[var(--muted)]">正在确认本机访问权限…</p>}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs leading-6 text-[var(--muted)]">
        观澜只读取币安公开行情，并按你设定的阈值做站内提醒。它不下单、不连接账户、不保存密钥，也不判断盈亏。指标描述已经发生的已收盘 K 线，不是买卖建议。回测未实现。
      </footer>
    </div>
  );
}
