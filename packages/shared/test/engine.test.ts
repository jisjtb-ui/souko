import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIM_CONFIG,
  LogisticsSimulation,
  createSampleWarehouse,
  isOutboundGateObject,
} from '../src/index.js';
import type { LogisticsSimConfig, SimulationSnapshot } from '../src/index.js';

function buildSim(overrides: Partial<LogisticsSimConfig> = {}, mutate?: (s: ReturnType<typeof createSampleWarehouse>) => void) {
  const sample = createSampleWarehouse();
  mutate?.(sample);
  return new LogisticsSimulation({
    warehouse: sample.warehouse,
    objects: sample.objects,
    locations: sample.locations,
    areas: sample.areas,
    connections: sample.connections,
    shutters: sample.shutters,
    rackTypes: sample.rackTypes,
    productSizes: sample.productSizes,
    config: { ...DEFAULT_SIM_CONFIG, tickSeconds: 2, ...overrides },
  });
}

describe('シミュレーションエンジン: 初期化', () => {
  it('フォークリフト・ゲート・空ラック置き場・初期在庫が用意される', () => {
    const sim = buildSim();
    const snap = sim.snapshot();
    expect(snap.vehicles).toHaveLength(3);
    expect(snap.gates.filter((g) => g.type === 'inbound')).toHaveLength(1);
    expect(snap.gates.filter((g) => g.type === 'outbound')).toHaveLength(3);
    expect(snap.stacks.length).toBe(12); // 6列 x 2行
    // 初期充填率50% -> 216ロケーションのおよそ半分
    expect(snap.occupancy.size).toBeGreaterThan(90);
    expect(snap.occupancy.size).toBeLessThan(120);
    expect(snap.clock).toBe('08:00:00');
  });

  it('ゲートの設定値がそのまま計画本数になる (要件21)', () => {
    const sim = buildSim();
    const kpi = sim.kpi();
    expect(kpi.plannedInboundUnits).toBe(3000);
    expect(kpi.plannedOutboundUnits).toBe(3800);
  });
});

describe('シミュレーション実行: 入庫→保管→出庫→空ラック→積み重ね (要件14)', () => {
  let snap: SimulationSnapshot;

  it('最後まで実行できる', () => {
    const sim = buildSim();
    snap = sim.runToEnd();
    expect(snap.finished).toBe(true);
    expect(snap.timeSec).toBeGreaterThan(0);
  }, 60_000);

  it('入庫・出荷が実際に処理される', () => {
    expect(snap.metrics.inboundUnits).toBeGreaterThan(0);
    expect(snap.metrics.outboundUnits).toBeGreaterThan(0);
    // 計画のかなりの部分が処理されている
    expect(snap.metrics.inboundUnits / snap.metrics.plannedInboundUnits).toBeGreaterThan(0.5);
  });

  it('フォークリフトが実際に走行している', () => {
    expect(snap.metrics.totalTravelM).toBeGreaterThan(100);
    expect(snap.metrics.completedTasks).toBeGreaterThan(10);
    expect(snap.vehicles.every((v) => v.travelledM > 0)).toBe(true);
    expect(snap.metrics.forkliftUtilization).toBeGreaterThan(0);
    expect(snap.metrics.forkliftUtilization).toBeLessThanOrEqual(1);
  });

  it('出荷でラックが空になり、空ラック置き場へ積み重ねられる (要件9・10・11)', () => {
    expect(snap.metrics.stackedRacks).toBeGreaterThan(0);
    const usedStacks = snap.stacks.filter((s) => s.rackUnitIds.length > 0);
    expect(usedStacks.length).toBeGreaterThan(0);

    // 積み重ね段数が種別の上限を超えていない
    for (const stack of usedStacks) {
      expect(stack.rackUnitIds.length).toBeLessThanOrEqual(stack.maxLevels);
    }
    // 積み重ねられたラックは stacked 状態で段位置を持つ
    const stackedRacks = snap.rackUnits.filter((r) => r.status === 'stacked');
    expect(stackedRacks.length).toBe(snap.metrics.stackedRacks);
    expect(stackedRacks.every((r) => (r.stackLevel ?? 0) >= 1)).toBe(true);
  });

  it('在庫の整合性が保たれる（ロケーションとラックが1対1）', () => {
    const storedRackIds = [...snap.occupancy.values()];
    expect(new Set(storedRackIds).size).toBe(storedRackIds.length);
    for (const rackId of storedRackIds) {
      const rack = snap.rackUnits.find((r) => r.id === rackId)!;
      expect(rack).toBeDefined();
      expect(rack.currentUnits).toBeGreaterThan(0);
      expect(rack.currentUnits).toBeLessThanOrEqual(rack.capacityUnits);
    }
    // 積み重ね済みのラックはロケーションを占有していない
    for (const rack of snap.rackUnits.filter((r) => r.status === 'stacked')) {
      expect(rack.locationId).toBeUndefined();
      expect(storedRackIds).not.toContain(rack.id);
    }
  });

  it('イベントログに一連の流れが記録される (要件24)', () => {
    const types = new Set(snap.events.map((e) => e.type));
    expect(types.has('sim-start')).toBe(true);
    expect(types.has('task-assigned')).toBe(true);
    expect(types.has('pick')).toBe(true);
    expect(types.has('drop')).toBe(true);
    expect(types.has('outbound-done')).toBe(true);
    expect(types.has('sim-end')).toBe(true);
    // 時刻が "HH:MM:SS" で入っている
    expect(snap.events[0]!.atClock).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('ゲート別の処理実績が集計される (要件16)', () => {
    const gates = snap.metrics.gates;
    expect(gates.length).toBe(4);
    const outbound = gates.filter((g) => g.type === 'outbound');
    expect(outbound.reduce((sum, g) => sum + g.processedUnits, 0)).toBe(snap.metrics.outboundUnits);
    const inbound = gates.find((g) => g.type === 'inbound')!;
    expect(inbound.processedUnits).toBe(snap.metrics.inboundUnits);
  });
});

describe('設定変更がシミュレーション結果に反映される (要件21)', () => {
  it('出荷本数を倍にすると出荷処理量が増える', () => {
    const base = buildSim().runToEnd();
    const doubled = buildSim({}, (sample) => {
      for (const obj of sample.objects) {
        if (isOutboundGateObject(obj)) obj.outboundGate.dailyVolume *= 2;
      }
    }).runToEnd();
    expect(doubled.metrics.plannedOutboundUnits).toBe(base.metrics.plannedOutboundUnits * 2);
    expect(doubled.metrics.outboundUnits).toBeGreaterThan(base.metrics.outboundUnits);
  }, 60_000);

  it('フォークリフトを減らすと処理が滞る', () => {
    const many = buildSim().runToEnd();
    const few = buildSim({}, (sample) => {
      const forklifts = sample.objects.filter((o) => o.kind === 'forklift');
      sample.objects = sample.objects.filter((o) => o.kind !== 'forklift' || o.id === forklifts[0]!.id);
    }).runToEnd();
    expect(few.metrics.completedTasks).toBeLessThan(many.metrics.completedTasks);
    expect(few.metrics.forkliftUtilization).toBeGreaterThan(many.metrics.forkliftUtilization);
  }, 60_000);

  it('ゲートの処理能力を下げると待機時間が増える (要件15)', () => {
    const fast = buildSim().runToEnd();
    const slow = buildSim({}, (sample) => {
      for (const obj of sample.objects) {
        if (isOutboundGateObject(obj)) {
          obj.outboundGate.capacityPerHour = 30;
          obj.outboundGate.concurrentSlots = 1;
        }
      }
    }).runToEnd();
    const slowWait = slow.metrics.gates.reduce((sum, g) => sum + g.totalWaitSeconds, 0);
    const fastWait = fast.metrics.gates.reduce((sum, g) => sum + g.totalWaitSeconds, 0);
    expect(slowWait).toBeGreaterThan(fastWait);
  }, 60_000);

  it('同じシードなら同じ結果になる（レイアウト比較の前提）', () => {
    const a = buildSim({ seed: 777 }).runToEnd();
    const b = buildSim({ seed: 777 }).runToEnd();
    expect(b.metrics.inboundUnits).toBe(a.metrics.inboundUnits);
    expect(b.metrics.outboundUnits).toBe(a.metrics.outboundUnits);
    expect(b.metrics.totalTravelM).toBeCloseTo(a.metrics.totalTravelM, 0);
  }, 60_000);

  it('シャッターを閉じると増築棟へ到達できず、その分の作業が失敗する', () => {
    const open = buildSim().runToEnd();
    const closed = buildSim({}, (sample) => {
      sample.shutters = sample.shutters.map((s) => ({ ...s, state: 'closed' as const }));
    }).runToEnd();
    const errors = closed.events.filter((e) => e.type === 'error' && e.message.includes('到達'));
    expect(errors.length).toBeGreaterThan(0);
    expect(closed.metrics.totalTravelM).not.toBe(open.metrics.totalTravelM);
  }, 60_000);
});
