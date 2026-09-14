import { create } from 'zustand';
import {
  DEFAULT_SIM_CONFIG,
  LogisticsSimulation,
  analyzeBottlenecks,
  compareSimulations,
  parseClock,
} from '@ws/shared';
import type {
  Bottleneck,
  LayoutComparison,
  LogisticsSimConfig,
  SimulationKpi,
  SimulationSnapshot,
} from '@ws/shared';
import { useEditorStore } from './editorStore';

/** 再生速度の選択肢（要件12）。実務で使えるよう高倍速も用意する。 */
export const SPEED_OPTIONS = [1, 2, 5, 10, 60, 300] as const;

export interface SavedRun {
  label: string;
  kpi: SimulationKpi;
  snapshot: SimulationSnapshot;
  bottlenecks: Bottleneck[];
}

interface SimulationState {
  config: LogisticsSimConfig;
  status: 'idle' | 'running' | 'paused' | 'computing' | 'finished';
  /** 一括実行の進捗 (0-1) */
  progress: number;
  speed: number;
  snapshot: SimulationSnapshot | null;
  bottlenecks: Bottleneck[];
  error: string | null;
  /** レイアウト比較用に保存した結果 */
  savedRuns: SavedRun[];
  comparison: LayoutComparison | null;

  setConfig: (patch: Partial<LogisticsSimConfig>) => void;
  setSpeed: (speed: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  /** 最後まで一気に実行して結果を集計する */
  runToEnd: () => void;
  /** 現在の結果をレイアウト比較用に保存する */
  saveRun: (label: string) => void;
  compareSaved: (indexA: number, indexB: number) => void;
  clearRuns: () => void;
}

let simulation: LogisticsSimulation | null = null;
let rafHandle: number | null = null;
let lastFrameMs = 0;

/** 現在の編集内容からシミュレーション入力を組み立てる。 */
function buildInput(config: LogisticsSimConfig) {
  const editor = useEditorStore.getState();
  if (!editor.warehouse) return null;
  return {
    warehouse: editor.warehouse,
    objects: editor.objects,
    locations: editor.locations,
    areas: editor.areas,
    connections: editor.connections,
    shutters: editor.shutters,
    rackTypes: editor.rackTypes,
    productSizes: editor.productSizes,
    config,
  };
}

function plannedSeconds(config: LogisticsSimConfig): number {
  return Math.max(60, parseClock(config.endTime) - parseClock(config.startTime));
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  config: { ...DEFAULT_SIM_CONFIG },
  status: 'idle',
  progress: 0,
  speed: 10,
  snapshot: null,
  bottlenecks: [],
  error: null,
  savedRuns: [],
  comparison: null,

  setConfig: (patch) => {
    set((s) => ({ config: { ...s.config, ...patch } }));
    // 設定を変えたら結果を破棄する（表示と実体を食い違わせない）
    get().stop();
  },

  setSpeed: (speed) => set({ speed }),

  play: () => {
    const state = get();
    if (state.status === 'running') return;

    if (!simulation || state.status === 'finished') {
      const input = buildInput(state.config);
      if (!input) {
        set({ error: '倉庫が読み込まれていません' });
        return;
      }
      try {
        simulation = new LogisticsSimulation(input);
      } catch (error) {
        set({ error: (error as Error).message });
        return;
      }
    }

    set({ status: 'running', error: null, snapshot: simulation.snapshot() });
    lastFrameMs = performance.now();

    const loop = (now: number): void => {
      const current = get();
      if (current.status !== 'running' || !simulation) {
        rafHandle = null;
        return;
      }
      const realDt = Math.min(0.25, (now - lastFrameMs) / 1000);
      lastFrameMs = now;

      const tick = current.config.tickSeconds;
      let remaining = realDt * current.speed;
      let guard = 0;
      while (remaining > 0 && guard < 4000) {
        simulation.step(tick);
        remaining -= tick;
        guard++;
        // スナップショットの生成は1フレームに1回で足りる（tickごとに作ると重い）
        if (simulation.isFinished) break;
      }

      const snapshot = simulation.snapshot();
      if (snapshot.finished) {
        set({
          snapshot,
          status: 'finished',
          bottlenecks: analyzeBottlenecks({
            snapshot,
            rackTypes: useEditorStore.getState().rackTypes,
            plannedSeconds: plannedSeconds(current.config),
            objects: useEditorStore.getState().objects,
            areas: useEditorStore.getState().areas,
          }),
        });
        rafHandle = null;
        return;
      }
      set({ snapshot });
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  },

  pause: () => {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    if (get().status === 'running') set({ status: 'paused' });
  },

  stop: () => {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    simulation = null;
    set({ status: 'idle', progress: 0, snapshot: null, bottlenecks: [], comparison: null });
  },

  runToEnd: () => {
    const state = get();
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rafHandle = null;

    const input = buildInput(state.config);
    if (!input) {
      set({ error: '倉庫が読み込まれていません' });
      return;
    }

    let instance: LogisticsSimulation;
    try {
      instance = new LogisticsSimulation(input);
    } catch (error) {
      set({ error: (error as Error).message });
      return;
    }
    simulation = instance;

    const tick = state.config.tickSeconds;
    set({ status: 'computing', progress: 0, error: null, snapshot: null, bottlenecks: [] });

    /*
     * 1日分の計算はデータ量によっては数秒〜十数秒かかる。
     * 一度に回すと画面が固まるため、1フレームあたりの実行時間を区切り、
     * 残りは次のフレームへ譲る（計算内容・結果は分割しても同じ）。
     */
    const SLICE_MS = 12;
    const runSlice = (): void => {
      if (get().status !== 'computing' || simulation !== instance) {
        rafHandle = null;
        return;
      }
      // エンジン側の終了条件（打ち切り時間・ガード）を共有するので、
      // 分割して実行しても一気に実行しても結果は同じになる
      const done = instance.runFor(SLICE_MS, { tickSeconds: tick });

      if (!done) {
        set({ progress: instance.progressRatio() });
        rafHandle = requestAnimationFrame(runSlice);
        return;
      }

      const snapshot = instance.snapshot();
      set({
        snapshot,
        status: 'finished',
        progress: 1,
        bottlenecks: analyzeBottlenecks({
          snapshot,
          rackTypes: useEditorStore.getState().rackTypes,
          plannedSeconds: plannedSeconds(state.config),
          objects: useEditorStore.getState().objects,
          areas: useEditorStore.getState().areas,
        }),
      });
      rafHandle = null;
    };
    rafHandle = requestAnimationFrame(runSlice);
  },

  saveRun: (label) => {
    const { snapshot, bottlenecks } = get();
    if (!snapshot) return;
    set((s) => ({
      savedRuns: [...s.savedRuns, { label, kpi: snapshot.metrics, snapshot, bottlenecks }].slice(-6),
    }));
  },

  compareSaved: (indexA, indexB) => {
    const runs = get().savedRuns;
    const a = runs[indexA];
    const b = runs[indexB];
    if (!a || !b) return;
    set({ comparison: compareSimulations({ label: a.label, kpi: a.kpi }, { label: b.label, kpi: b.kpi }) });
  },

  clearRuns: () => set({ savedRuns: [], comparison: null }),
}));
