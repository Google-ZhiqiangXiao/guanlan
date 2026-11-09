"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import { formatShanghaiShort } from "@/lib/domain/time";

type Point = { time: number; value: number };
type Candle = { time: number; open: number; high: number; low: number; close: number };

export function ChartPanel({
  candles,
  ema20,
  ema60,
  bbUpper,
  bbMiddle,
  bbLower,
}: {
  candles: Candle[];
  ema20: Point[];
  ema60: Point[];
  bbUpper: Point[];
  bbMiddle: Point[];
  bbLower: Point[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || candles.length === 0) return;
    let chart: IChartApi | null = null;
    let dead = false;
    const render = async () => {
      const lc = await import("lightweight-charts");
      if (dead || !ref.current) return;
      chart = lc.createChart(ref.current, {
        height: 420,
        layout: { background: { type: lc.ColorType.Solid, color: "#fbf8f2" }, textColor: "#6b645b", fontFamily: "IBM Plex Mono, ui-monospace, monospace" },
        grid: { vertLines: { color: "#efe6d8" }, horzLines: { color: "#efe6d8" } },
        rightPriceScale: { borderColor: "#e3dacb" },
        timeScale: { borderColor: "#e3dacb", timeVisible: true, secondsVisible: false },
        localization: { timeFormatter: (time: number) => formatShanghaiShort(time * 1000) },
        crosshair: { mode: lc.CrosshairMode.Normal },
      });
      const candleSeries = chart.addCandlestickSeries({
        upColor: "#c44536",
        downColor: "#1f7a4d",
        borderVisible: false,
        wickUpColor: "#c44536",
        wickDownColor: "#1f7a4d",
      });
      candleSeries.setData(candles.map((item) => ({ ...item, time: item.time as UTCTimestamp })));
      const addLine = (data: Point[], color: string, style?: number) => {
        if (!chart || data.length === 0) return;
        const series = chart.addLineSeries({ color, lineWidth: 2, lineStyle: style, priceLineVisible: false, lastValueVisible: false });
        series.setData(data.map((item) => ({ time: item.time as UTCTimestamp, value: item.value })));
      };
      addLine(ema20, "#0f5f5a");
      addLine(ema60, "#9a6230");
      addLine(bbUpper, "#6d5a7a", 2);
      addLine(bbMiddle, "#3d4c6a", 2);
      addLine(bbLower, "#6d5a7a", 2);
      if (dead) {
        chart.remove();
        chart = null;
        return;
      }
      chart.timeScale().fitContent();
      const observer = new ResizeObserver(() => {
        if (ref.current && chart) chart.applyOptions({ width: ref.current.clientWidth });
      });
      observer.observe(ref.current);
      return () => observer.disconnect();
    };
    let disconnect: (() => void) | undefined;
    void render().then((done) => {
      disconnect = done;
    });
    return () => {
      dead = true;
      disconnect?.();
      chart?.remove();
    };
  }, [candles, ema20, ema60, bbUpper, bbMiddle, bbLower]);

  if (candles.length === 0) {
    return <div className="flex h-[280px] items-center justify-center rounded-3xl border border-dashed border-[var(--line)] text-sm text-[var(--muted)]">没有可画的已收盘 K 线</div>;
  }
  return <div ref={ref} className="h-[420px] w-full overflow-hidden rounded-3xl border border-[var(--line)]" />;
}
