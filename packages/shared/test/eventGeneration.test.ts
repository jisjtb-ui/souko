import { describe, expect, it } from 'vitest';
import {
  allowedRackCategories,
  createDefaultProductSizes,
  createLayoutObject,
  createSampleWarehouse,
  distributeByRatio,
  generateEventPlan,
  generateInboundJobs,
  generateOutboundJobs,
  isInboundGateObject,
  isOutboundGateObject,
  parseClock,
  Random,
} from '../src/index.js';
import type { InboundGateObject, OutboundGateObject, ProductSize } from '../src/index.js';

const sizes = createDefaultProductSizes('wh_1');
const OPTIONS = { seed: 42, startTime: '08:00', endTime: '17:00' };

function inboundGate(overrides: Record<string, unknown> = {}): InboundGateObject {
  return createLayoutObject({
    layoutId: 'lay_1',
    kind: 'inbound-gate',
    name: '倉入れ口A',
    x: 0,
    y: 0,
    inboundGate: {
      dailyVolume: 20000,
      sizeMix: [
        { productSizeId: sizes[0]!.id, ratioPct: 30 },
        { productSizeId: sizes[1]!.id, ratioPct: 40 },
        { productSizeId: sizes[2]!.id, ratioPct: 20 },
        { productSizeId: sizes[3]!.id, ratioPct: 10 },
      ],
      ...overrides,
    },
  }) as InboundGateObject;
}

function outboundGate(overrides: Record<string, unknown> = {}): OutboundGateObject {
  return createLayoutObject({
    layoutId: 'lay_1',
    kind: 'outbound-gate',
    name: '出荷ゲートA',
    x: 0,
    y: 30,
    outboundGate: { dailyVolume: 30000, ...overrides },
  }) as OutboundGateObject;
}

describe('割合の分配', () => {
  it('合計が必ず一致する（端数は最大剰余法）', () => {
    expect(distributeByRatio(20000, [30, 40, 20, 10])).toEqual([6000, 8000, 4000, 2000]);
    const odd = distributeByRatio(7, [33.3, 33.3, 33.4]);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(7);
  });

  it('割合が0なら0になる', () => {
    expect(distributeByRatio(100, [0, 100])).toEqual([0, 100]);
  });
});

describe('Random', () => {
  it('同じシードなら同じ列を返す', () => {
    const a = new Random(7);
    const b = new Random(7);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
});

describe('倉入れイベント生成 (要件4・5・13)', () => {
  it('1日の本数がサイズ別割合どおりに分配される', () => {
    const { jobs, plannedUnits } = generateInboundJobs([inboundGate()], sizes, OPTIONS);
    expect(plannedUnits).toBe(20000);
    const total = jobs.reduce((sum, j) => sum + j.units, 0);
    expect(total).toBe(20000);

    const bySize = new Map<string, number>();
    for (const job of jobs) bySize.set(job.productSizeId, (bySize.get(job.productSizeId) ?? 0) + job.units);
    expect(bySize.get(sizes[0]!.id)).toBe(6000);   // 30%
    expect(bySize.get(sizes[1]!.id)).toBe(8000);   // 40%
    expect(bySize.get(sizes[2]!.id)).toBe(4000);   // 20%
    expect(bySize.get(sizes[3]!.id)).toBe(2000);   // 10%
  });

  it('1ラックあたりの本数でラック単位の作業に切り出される', () => {
    const { jobs } = generateInboundJobs([inboundGate()], sizes, OPTIONS);
    for (const job of jobs) {
      const size = sizes.find((s) => s.id === job.productSizeId)!;
      expect(job.units).toBeLessThanOrEqual(size.unitsPerRack);
      expect(job.units).toBeGreaterThan(0);
    }
    // 6000本 / 24本 = 250ラック分。時間帯の区切りで端数ラックが出るため 250〜254 台
    const first = jobs.filter((j) => j.productSizeId === sizes[0]!.id);
    expect(first.reduce((sum, j) => sum + j.units, 0)).toBe(6000);
    expect(first.length).toBeGreaterThanOrEqual(250);
    expect(first.length).toBeLessThanOrEqual(254);
    // 満載ラックが大半を占める
    expect(first.filter((j) => j.units === sizes[0]!.unitsPerRack).length).toBeGreaterThan(240);
  });

  it('時間帯別割合どおりに発生時刻が分布する', () => {
    const { jobs } = generateInboundJobs([inboundGate()], sizes, OPTIONS);
    const startSec = parseClock('08:00');
    const inBand = (fromClock: string, toClock: string): number =>
      jobs
        .filter((j) => {
          const abs = j.atSec + startSec;
          return abs >= parseClock(fromClock) && abs < parseClock(toClock);
        })
        .reduce((sum, j) => sum + j.units, 0);

    // 既定: 08-10:15% / 10-12:25% / 12-15:20% / 15-17:40%
    expect(inBand('08:00', '10:00') / 20000).toBeCloseTo(0.15, 1);
    expect(inBand('10:00', '12:00') / 20000).toBeCloseTo(0.25, 1);
    expect(inBand('15:00', '17:00') / 20000).toBeCloseTo(0.4, 1);
  });

  it('使用ラックサイズ割合が反映される（サイズの制約が優先）', () => {
    // 大型商品は大型ラックしか使えない
    expect(allowedRackCategories({ rackCategory: 'large' })).toEqual(['large']);
    expect(allowedRackCategories({ rackCategory: 'small' })).toEqual(['small', 'large']);

    const { jobs } = generateInboundJobs(
      [inboundGate({ rackMix: { smallPct: 60, largePct: 40 } })],
      sizes,
      OPTIONS,
    );
    // 大型サイズのジョブは必ず大型ラック
    const largeSizeJobs = jobs.filter((j) => {
      const size = sizes.find((s) => s.id === j.productSizeId)!;
      return size.rackCategory === 'large';
    });
    expect(largeSizeJobs.every((j) => j.rackCategory === 'large')).toBe(true);
    expect(largeSizeJobs.length).toBeGreaterThan(0);

    // 小型サイズは割合に従って両方使われる
    const smallSizeJobs = jobs.filter((j) => {
      const size = sizes.find((s) => s.id === j.productSizeId)!;
      return size.rackCategory === 'small';
    });
    const usedSmall = smallSizeJobs.filter((j) => j.rackCategory === 'small').length;
    expect(usedSmall).toBeGreaterThan(0);
    expect(smallSizeJobs.some((j) => j.rackCategory === 'large')).toBe(true);
  });

  it('小型ラック100%指定なら大型商品以外は小型になる', () => {
    const { jobs } = generateInboundJobs(
      [inboundGate({ rackMix: { smallPct: 100, largePct: 0 } })],
      sizes,
      OPTIONS,
    );
    const smallSizeJobs = jobs.filter(
      (j) => sizes.find((s) => s.id === j.productSizeId)!.rackCategory === 'small',
    );
    expect(smallSizeJobs.every((j) => j.rackCategory === 'small')).toBe(true);
  });

  it('同じシードなら同じイベント列になる（レイアウト比較用）', () => {
    const a = generateInboundJobs([inboundGate()], sizes, OPTIONS);
    const b = generateInboundJobs([inboundGate()], sizes, OPTIONS);
    expect(a.jobs.map((j) => [j.atSec.toFixed(3), j.units, j.rackCategory])).toEqual(
      b.jobs.map((j) => [j.atSec.toFixed(3), j.units, j.rackCategory]),
    );
  });
});

describe('出荷イベント生成 (要件2・13)', () => {
  it('ボリューム区分の割合どおりに出荷本数が分配される', () => {
    const { jobs, plannedUnits } = generateOutboundJobs([outboundGate()], sizes, OPTIONS);
    expect(plannedUnits).toBe(30000);
    const total = jobs.reduce((sum, j) => sum + j.totalUnits, 0);
    expect(total).toBe(30000);

    const byClass = new Map<string, number>();
    for (const job of jobs) byClass.set(job.volumeClass, (byClass.get(job.volumeClass) ?? 0) + job.totalUnits);
    // 既定: 小口10% 中口30% 大口40% 特大口20%
    expect(byClass.get('small')).toBe(3000);
    expect(byClass.get('medium')).toBe(9000);
    expect(byClass.get('large')).toBe(12000);
    expect(byClass.get('xlarge')).toBe(6000);
  });

  it('要件の例（20,000本 / 10:30:40:20）どおりに生成される', () => {
    const gate = outboundGate({
      dailyVolume: 20000,
      volumeMix: [
        { key: 'small', label: '小口', ratioPct: 10, unitsPerOrder: 20 },
        { key: 'medium', label: '中口', ratioPct: 30, unitsPerOrder: 60 },
        { key: 'large', label: '大口', ratioPct: 40, unitsPerOrder: 120 },
        { key: 'xlarge', label: '特大口', ratioPct: 20, unitsPerOrder: 240 },
      ],
    });
    const { jobs } = generateOutboundJobs([gate], sizes, OPTIONS);
    const byClass = new Map<string, number>();
    for (const job of jobs) byClass.set(job.volumeClass, (byClass.get(job.volumeClass) ?? 0) + job.totalUnits);
    expect(byClass.get('small')).toBe(2000);
    expect(byClass.get('medium')).toBe(6000);
    expect(byClass.get('large')).toBe(8000);
    expect(byClass.get('xlarge')).toBe(4000);
  });

  it('1オーダーの本数が区分の設定を超えない', () => {
    const { jobs } = generateOutboundJobs([outboundGate()], sizes, OPTIONS);
    const smallOrders = jobs.filter((j) => j.volumeClass === 'small');
    expect(smallOrders.every((j) => j.totalUnits <= 20)).toBe(true);
    const xlargeOrders = jobs.filter((j) => j.volumeClass === 'xlarge');
    expect(xlargeOrders.every((j) => j.totalUnits <= 240)).toBe(true);
    expect(jobs.every((j) => j.lines.length > 0)).toBe(true);
  });

  it('出荷対象サイズを限定できる', () => {
    const { jobs } = generateOutboundJobs(
      [outboundGate({ productSizeIds: [sizes[0]!.id] })],
      sizes,
      OPTIONS,
    );
    expect(jobs.every((j) => j.lines.every((l) => l.productSizeId === sizes[0]!.id))).toBe(true);
  });
});

describe('サンプル倉庫のイベント計画', () => {
  it('3ゲート分の入出庫イベントが生成される', () => {
    const sample = createSampleWarehouse();
    const inGates = sample.objects.filter(isInboundGateObject);
    const outGates = sample.objects.filter(isOutboundGateObject);
    const plan = generateEventPlan(inGates, outGates, sample.productSizes, OPTIONS);

    expect(plan.plannedInboundUnits).toBe(3000);
    expect(plan.plannedOutboundUnits).toBe(2000 + 1000 + 800);
    expect(plan.inbound.reduce((s, j) => s + j.units, 0)).toBe(3000);
    expect(plan.outbound.reduce((s, j) => s + j.totalUnits, 0)).toBe(3800);
    // 時刻順に並んでいる
    expect(plan.inbound.every((j, i, arr) => i === 0 || arr[i - 1]!.atSec <= j.atSec)).toBe(true);
    // ゲートごとに割り当てられている
    expect(new Set(plan.outbound.map((j) => j.gateObjectId)).size).toBe(3);
  });
});
