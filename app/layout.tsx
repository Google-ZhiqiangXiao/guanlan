import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "观澜 · 公开行情观察台",
  description: "币安现货与 USDT 本位永续的公开行情观察、指标和站内提醒。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
