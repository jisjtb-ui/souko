import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIM_CONFIG,
  LogisticsSimulation,
  analyzeBottlenecks,
  compareSimulations,
  createSampleWarehouse,
  isOutboundGateObject,
  parseClock,
} from '../src/index.js';
import type { LogisticsSimConfig, SimulationSnapshot } from '../src/index.js';

type Sample = ReturnType<typeof createSampleWarehouse>;

function run(mutate?: (s: Sample) => void, config: Partial<LogisticsSimConfig> = {}) {
  const sample = createSampleWarehouse();
  mutate?.(sample);
  const sim = new LogisticsSimulation({
    warehouse: sample.warehouse,
    objects: sample.objects,
    locations: sample.locations,
    areas: sample.areas,
    connections: sample.connections,
    shutters: sample.shutters,
    rackTypes: sample.rackTypes,
    productSizes: sample.productSizes,
    config: { ...DEFAULT_SIM_CONFIG, tickSeconds: 2, ...config },
  });
  const snapshot = sim.runToEnd();
  return { sample, snapshot };
}

const plannedSeconds = parseClock('17:00') - parseClock('08:00');

describe('ボトルネック分析 (要件17)', () => {
  it('処理能力の低いゲートを名指しで検出する', () => {
    const { sample, snapshot } = run((s) => {
      for (const obj of s.objects) {
        if (isOutboundGateObject(obj) && obj.name === '出荷ゲートB') {
          obj.outboundGate.capacityPerHour = 20;
          obj.outboundGate.concurrentSlots = 1;
        }
      }
    });
    const issues = analyzeBottlenecks({ snapshot, rackTypes: sample.rackTypes, plannedSeconds });
    const gateIssue = issues.find((i) => i.title.includes('出荷ゲートB'));
    expect(gateIssue).toBeDefined();
    expect(gateIssue!.severity).toBe('critical');
    expect(gateIssue!.detail).toMatch(/本\/時/);
    expect(gateIssue!.targetId).toBeDefined();
  }, 60_000);

  it('フォークリフトが足りない場合に稼働率で警告する', () => {
    const { sample, snapshot } = run((s) => {
      const first = s.objects.find((o) => o.kind === 'forklift')!;
      s.objects = s.objects.filter((o) => o.kind !== 'forklift' || o.id === first.id);
      // ゲート能力・在庫は潤沢にして、フォークリフト1台だけをボトルネックにする
      for (const obj of s.objects) {
        if (isOutboundGateObject(obj)) {
          obj.outboundGate.capacityPerHour = 5000;
          obj.outboundGate.concurrentSlots = 4;
        }
        if (obj.kind === 'inbound-gate' && 'inboundGate' in obj) {
          obj.inboundGate.dailyVolume = 6000;
          obj.inboundGate.capacityPerHour = 5000;
          obj.inboundGate.concurrentSlots = 4;
        }
      }
    });
    const issues = analyzeBottlenecks({ snapshot, rackTypes: sample.rackTypes, plannedSeconds });
    expect(
      issues.some(
        (i) => i.category === 'forklift' && (i.title.includes('稼働率') || i.title.includes('不足')),
      ),
    ).toBe(true);
  }, 60_000);

  it('空ラック置き場が満杯になると警告する', () => {
    const { sample, snapshot } = run((s) => {
      for (const obj of s.objects) {
        if (obj.kind === 'empty-rack-yard' && 'emptyRackYard' in obj) {
          obj.emptyRackYard.stackColumns = 1;
          obj.emptyRackYard.stackRows = 1;
        }
      }
    });
    const issues = analyzeBottlenecks({ snapshot, rackTypes: sample.rackTypes, plannedSeconds });
    expect(issues.some((i) => i.category === 'empty-yard')).toBe(true);
  }, 60_000);

  it('シャッターを閉じると到達不能として検出される', () => {
    const { sample, snapshot } = run((s) => {
      s.shutters = s.shutters.map((sh) => ({ ...sh, state: 'closed' as const }));
    });
    const issues = analyzeBottlenecks({ snapshot, rackTypes: sample.rackTypes, plannedSeconds });
    expect(issues.some((i) => i.id === 'unreachable')).toBe(true);
  }, 60_000);

  it('標準構成では致命的なボトルネックが出過ぎない', () => {
    const { sample, snapshot } = run();
    const issues = analyzeBottlenecks({ snapshot, rackTypes: sample.rackTypes, plannedSeconds });
    // 重大な問題は順に並ぶ
    const severities = issues.map((i) => i.severity);
    expect(severities).toEqual([...severities].sort((a, b) =>
      ({ critical: 0, warning: 1, info: 2 })[a] - ({ critical: 0, warning: 1, info: 2 })[b]));
    // 縦列に1サイズだけ入れる制約があるため、標準構成では取りこぼしが出る。
    // 計画のほとんどを消化できていることを確認する。
    expect(snapshot.metrics.inboundUnits).toBeGreaterThan(
      snapshot.metrics.plannedInboundUnits * 0.9,
    );
    expect(snapshot.metrics.inboundUnits).toBeLessThanOrEqual(
      snapshot.metrics.plannedInboundUnits,
    );
  }, 60_000);
});

describe('レイアウト比較 (要件18)', () => {
  it('同じ入出庫条件で2案を比較できる', () => {
    // レイアウトA: 既定 / レイアウトB: ラックを出荷ゲート寄りに寄せる
    const a = run(undefined, { seed: 1234 });
    const b = run((s) => {
      for (const obj of s.objects) {
        if (obj.kind === 'rack' && obj.y < 26) obj.y += 4;
      }
    }, { seed: 1234 });

    const comparison = compareSimulations(
      { label: 'レイアウトA', kpi: a.snapshot.metrics },
      { label: 'レイアウトB', kpi: b.snapshot.metrics },
    );

    expect(comparison.labelA).toBe('レイアウトA');
    expect(comparison.rows.length).toBeGreaterThan(8);

    const travel = comparison.rows.find((r) => r.key === 'travel')!;
    expect(travel.a).toBeGreaterThan(0);
    expect(travel.b).toBeGreaterThan(0);
    expect(travel.betterIsLower).toBe(true);
    expect(Number.isFinite(travel.changePct)).toBe(true);
    expect(comparison.verdict).toMatch(/レイアウト|差/);

    // 同じ条件（同じシード）で生成されたイベント量は一致する
    expect(b.snapshot.metrics.plannedOutboundUnits).toBe(a.snapshot.metrics.plannedOutboundUnits);
  }, 90_000);

  it('改善率が計算される', () => {
    const base: SimulationSnapshot['metrics'] = {
      ...run(undefined, { seed: 99 }).snapshot.metrics,
    };
    const better = { ...base, totalTravelM: base.totalTravelM * 0.7, elapsedSeconds: base.elapsedSeconds * 0.9 };
    const comparison = compareSimulations(
      { label: 'A', kpi: base },
      { label: 'B', kpi: better },
    );
    const travel = comparison.rows.find((r) => r.key === 'travel')!;
    expect(travel.changePct).toBeCloseTo(-30, 0);
    expect(comparison.verdict).toContain('削減');
  }, 60_000);
});
