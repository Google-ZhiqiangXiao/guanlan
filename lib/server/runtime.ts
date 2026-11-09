import path from "node:path";
import { ALERT_INTERVAL_MS, SELF_WEIGHT_LIMIT, WEIGHT_WINDOW_MS } from "@/lib/domain/constants";
import { openDatabase, type Sql } from "./db";
import { createMarketService, type MarketService } from "./market";
import { WeightBudget } from "./budget";
import { runAlerts } from "./alerts-run";

export type AppRuntime = {
  db: Sql;
  market: MarketService;
  spotBudget: WeightBudget;
  futuresBudget: WeightBudget;
};

const globalStore = globalThis as typeof globalThis & {
  __guanlan?: AppRuntime;
  __guanlanScheduler?: { lastRunAt: number | null; lastError: string | null; lastFired: number; started: boolean };
};

function sharedScheduler() {
  if (!globalStore.__guanlanScheduler) {
    globalStore.__guanlanScheduler = { lastRunAt: null, lastError: null, lastFired: 0, started: false };
  }
  return globalStore.__guanlanScheduler;
}

export const schedulerState = sharedScheduler();

export function getApp(): AppRuntime {
  if (!globalStore.__guanlan) {
    const filename = process.env.GUANLAN_DB_PATH || path.join(process.cwd(), "data", "guanlan.sqlite");
    const now = () => Date.now();
    const spotBudget = new WeightBudget(SELF_WEIGHT_LIMIT, WEIGHT_WINDOW_MS, now);
    const futuresBudget = new WeightBudget(SELF_WEIGHT_LIMIT, WEIGHT_WINDOW_MS, now);
    const created = createMarketService({ now, spotBudget, futuresBudget });
    globalStore.__guanlan = { db: openDatabase(filename), market: created.market, spotBudget, futuresBudget };
    startScheduler();
  }
  return globalStore.__guanlan;
}

export function startScheduler() {
  const state = sharedScheduler();
  if (state.started) return;
  state.started = true;
  const tick = async () => {
    try {
      const result = await runAlerts(getApp(), Date.now());
      state.lastRunAt = Date.now();
      state.lastFired = result.fired;
      state.lastError = null;
    } catch (error) {
      state.lastRunAt = Date.now();
      state.lastError = error instanceof Error ? error.message : "提醒任务失败";
    }
  };
  setInterval(() => {
    void tick();
  }, ALERT_INTERVAL_MS);
  void tick();
}
