import { describe, expect, it } from 'vitest';
import {
  analyzeDeadPositions,
  buildCapacityIndex,
  capacityOf,
  createDefaultCapacityTable,
  createSampleDeadPositionInput,
  deadUnitsOf,
  evaluateAllocation,
  LANE_DEPTHS,
  requiredLanes,
  validateCapacityTable,
} from '../src/index.js';
import type {
  DeadPositionInput,
  Lane,
  LaneAssignment,
  LaneCapacityEntry,
  ProductSize,
} from '../src/index.js';

/* ------------------------------------------------------------------ 補助 */

function lane(id: string, depth: number): Lane {
  return { id, label: id, depth };
}

/** 深さ1あたり perDepth 本入るマスタ。 */
function capacityTable(sizeIds: readonly string[], perDepth: number): LaneCapacityEntry[] {
  const entries: LaneCapacityEntry[] = [];
  for (const productSizeId of sizeIds) {
    for (const depth of LANE_DEPTHS) {
      entries.push({ depth, productSizeId, unitsPerLane: perDepth * depth });
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ 公式 */

describe('死にポジションの計算式', () => {
  it('必要列数 = ceil(在庫本数 / 収容本数)', () => {
    expect(requiredLanes(100, 10)).toBe(10);
    expect(requiredLanes(101, 10)).toBe(11);
    expect(requiredLanes(1, 10)).toBe(1);
  });

  it('在庫0・収容0は必要列数0', () => {
    expect(requiredLanes(0, 10)).toBe(0);
    expect(requiredLanes(100, 0)).toBe(0);
  });

  it('死にポジション = 必要列数 × 収容本数 − 在庫本数', () => {
    expect(deadUnitsOf(100, 10)).toBe(0); // 10レーンちょうど
    expect(deadUnitsOf(101, 10)).toBe(9); // 11レーン × 10 − 101
    expect(deadUnitsOf(1, 16)).toBe(15); // 深いレーンに1本だけ入れると15本死ぬ
    expect(deadUnitsOf(0, 10)).toBe(0);
  });
});

/* -------------------------------------------------------------- マスタ */

describe('収容本数マスタ', () => {
  it('9種類の深さを扱う', () => {
    expect([...LANE_DEPTHS]).toEqual([1, 2, 3, 4, 5, 6, 7, 11, 16]);
  });

  it('深さ×サイズで収容本数を引ける', () => {
    const index = buildCapacityIndex(capacityTable(['s1'], 8));
    expect(capacityOf(index, 1, 's1')).toBe(8);
    expect(capacityOf(index, 16, 's1')).toBe(128);
    expect(capacityOf(index, 16, 's2')).toBeUndefined();
    expect(capacityOf(index, 8, 's1')).toBeUndefined();
  });

  it('既定マスタは 1ラックあたり本数 × 深さ', () => {
    const size = { id: 'psz_1', unitsPerRack: 12 } as ProductSize;
    const index = buildCapacityIndex(createDefaultCapacityTable([size]));
    expect(capacityOf(index, 1, 'psz_1')).toBe(12);
    expect(capacityOf(index, 7, 'psz_1')).toBe(84);
  });

  it('重複と不正値を検出する', () => {
    const errors = validateCapacityTable([
      { depth: 0, productSizeId: 's1', unitsPerLane: 10 },
      { depth: 3, productSizeId: 's1', unitsPerLane: 0 },
      { depth: 3, productSizeId: 's1', unitsPerLane: 24 },
      { depth: 3, productSizeId: 's1', unitsPerLane: 24 },
    ]);
    expect(errors.some((e) => e.includes('深さは1以上'))).toBe(true);
    expect(errors.some((e) => e.includes('収容本数は1以上'))).toBe(true);
    expect(errors.some((e) => e.includes('重複'))).toBe(true);
  });
});

/* ---------------------------------------------------------------- 評価 */

describe('割り当ての評価', () => {
  const index = buildCapacityIndex(capacityTable(['s1'], 10));

  it('満載のレーンは死にポジション0', () => {
    const view = evaluateAllocation(
      [lane('L1', 3)],
      [{ laneId: 'L1', productSizeId: 's1', units: 30 }],
      index,
    );
    expect(view.metrics.deadUnits).toBe(0);
    expect(view.metrics.deadRate).toBe(0);
    expect(view.metrics.capacityUnits).toBe(30);
  });

  it('深いレーンに少量だけ入れると死にポジションが増える', () => {
    const view = evaluateAllocation(
      [lane('L1', 16)],
      [{ laneId: 'L1', productSizeId: 's1', units: 20 }],
      index,
    );
    expect(view.metrics.capacityUnits).toBe(160);
    expect(view.metrics.deadUnits).toBe(140);
    expect(view.metrics.deadRate).toBeCloseTo(140 / 160, 10);
  });

  it('完全空きレーンは能力にも死にポジションにも数えない', () => {
    const view = evaluateAllocation(
      [lane('L1', 3), lane('L2', 16)],
      [{ laneId: 'L1', productSizeId: 's1', units: 30 }],
      index,
    );
    expect(view.metrics.emptyLanes).toBe(1);
    expect(view.metrics.usedLanes).toBe(1);
    expect(view.metrics.capacityUnits).toBe(30);
    expect(view.metrics.deadUnits).toBe(0);
  });

  it('収容本数を超えた分は溢れとして数える', () => {
    const view = evaluateAllocation(
      [lane('L1', 2)],
      [{ laneId: 'L1', productSizeId: 's1', units: 25 }],
      index,
    );
    expect(view.metrics.overflowUnits).toBe(5);
    expect(view.metrics.deadUnits).toBe(0);
  });

  it('深さ別・サイズ別に集計する', () => {
    const view = evaluateAllocation(
      [lane('L1', 3), lane('L2', 3), lane('L3', 7)],
      [
        { laneId: 'L1', productSizeId: 's1', units: 30 },
        { laneId: 'L3', productSizeId: 's1', units: 40 },
      ],
      index,
    );
    const d3 = view.byDepth.find((d) => d.depth === 3)!;
    expect(d3.lanes).toBe(2);
    expect(d3.usedLanes).toBe(1);
    expect(d3.emptyLanes).toBe(1);
    expect(view.bySize[0]!.lanes).toBe(2);
    expect(view.bySize[0]!.deadUnits).toBe(30); // 深さ7に40本 → 70−40
  });
});

/* ------------------------------------------------------------ 貪欲法 */

describe('貪欲法による再配置', () => {
  it('9種類の深さを総当たりして死にポジションが最小の深さを選ぶ', () => {
    // 在庫70本。深さ7 (70本) なら死に0、深さ16 (160本) なら死に90
    const input: DeadPositionInput = {
      lanes: [lane('D16', 16), lane('D7', 7), lane('D3', 3)],
      current: [{ laneId: 'D16', productSizeId: 's1', units: 70 }],
      stock: [{ productSizeId: 's1', peakUnits: 70 }],
      capacity: capacityTable(['s1'], 10),
    };
    const result = analyzeDeadPositions(input);
    expect(result.current.metrics.deadUnits).toBe(90);
    expect(result.proposal.metrics.deadUnits).toBe(0);
    const used = result.proposal.lanes.filter((l) => !l.empty);
    expect(used).toHaveLength(1);
    expect(used[0]!.laneId).toBe('D7');
  });

  it('1レーンには1サイズしか入れない', () => {
    const input: DeadPositionInput = {
      lanes: [lane('L1', 5), lane('L2', 5), lane('L3', 5)],
      current: [],
      stock: [
        { productSizeId: 's1', peakUnits: 50 },
        { productSizeId: 's2', peakUnits: 50 },
      ],
      capacity: capacityTable(['s1', 's2'], 10),
    };
    const result = analyzeDeadPositions(input);
    const perLane = new Map<string, Set<string>>();
    for (const l of result.proposal.lanes) {
      if (l.empty) continue;
      const set = perLane.get(l.laneId) ?? new Set<string>();
      set.add(l.productSizeId!);
      perLane.set(l.laneId, set);
    }
    for (const set of perLane.values()) expect(set.size).toBe(1);
  });

  it('どのレーンも収容本数を超えない', () => {
    const input = createSampleDeadPositionInput();
    const result = analyzeDeadPositions(input);
    for (const l of result.proposal.lanes) {
      expect(l.units).toBeLessThanOrEqual(l.capacityUnits);
      expect(l.overflowUnits).toBe(0);
    }
  });

  it('1レーンに複数の製造年週を混ぜない（古い在庫を奥に埋めない）', () => {
    const input: DeadPositionInput = {
      lanes: [lane('L1', 16), lane('L2', 16), lane('L3', 16)],
      current: [],
      stock: [
        {
          productSizeId: 's1',
          peakUnits: 30,
          cohorts: [
            { yearWeek: '2024-W05', units: 10 },
            { yearWeek: '2025-W30', units: 20 },
          ],
        },
      ],
      capacity: capacityTable(['s1'], 10),
    };
    const result = analyzeDeadPositions(input);
    const used = result.proposal.lanes.filter((l) => !l.empty);
    // 年週が2つ → 同じレーンにまとめず2レーンに分かれる
    expect(used).toHaveLength(2);
    const weeks = new Set(used.map((l) => l.yearWeek));
    expect(weeks).toEqual(new Set(['2024-W05', '2025-W30']));
  });

  it('複数の並び順を試し、最良の結果を採用する', () => {
    const result = analyzeDeadPositions(createSampleDeadPositionInput());
    expect(result.attempts.length).toBeGreaterThanOrEqual(4);
    expect(result.attempts.filter((a) => a.selected)).toHaveLength(1);
    const selected = result.attempts.find((a) => a.selected)!;
    for (const attempt of result.attempts) {
      if (attempt.overflowUnits === selected.overflowUnits) {
        expect(selected.deadUnits).toBeLessThanOrEqual(attempt.deadUnits);
      }
    }
    expect(selected.order).toBe(result.strategy);
  });

  it('空きレーンが足りない分は置き切れずとして報告する', () => {
    const input: DeadPositionInput = {
      lanes: [lane('L1', 3)],
      current: [],
      stock: [{ productSizeId: 's1', peakUnits: 100 }],
      capacity: capacityTable(['s1'], 10),
    };
    const result = analyzeDeadPositions(input);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0]!.units).toBe(70); // 深さ3 = 30本しか置けない
  });

  it('マスタに無い深さのレーンは使わず警告する', () => {
    const input: DeadPositionInput = {
      lanes: [lane('L1', 8), lane('L2', 5)],
      current: [],
      stock: [{ productSizeId: 's1', peakUnits: 50 }],
      capacity: capacityTable(['s1'], 10),
    };
    const result = analyzeDeadPositions(input);
    expect(result.warnings.some((w) => w.includes('深さ8'))).toBe(true);
    const used = result.proposal.lanes.filter((l) => !l.empty);
    expect(used.every((l) => l.depth === 5)).toBe(true);
  });
});

/* ------------------------------------------------------------ 全体挙動 */

describe('サンプルデータでの分析', () => {
  it('改善案は現状より死にポジションが減り、レーンが空く', () => {
    const result = analyzeDeadPositions(createSampleDeadPositionInput());

    expect(result.current.metrics.deadUnits).toBeGreaterThan(0);
    expect(result.proposal.metrics.deadUnits).toBeLessThan(result.current.metrics.deadUnits);
    expect(result.proposal.metrics.deadRate).toBeLessThan(result.current.metrics.deadRate);
    expect(result.delta.deadUnits).toBeLessThan(0);
    expect(result.proposal.metrics.emptyLanes).toBeGreaterThan(
      result.current.metrics.emptyLanes,
    );
    expect(result.newlyEmptyLaneIds.length).toBeGreaterThan(0);
  });

  it('在庫本数は現状と改善案で保存される', () => {
    const input = createSampleDeadPositionInput();
    const result = analyzeDeadPositions(input);
    const stockTotal = input.stock.reduce((sum, s) => sum + s.peakUnits, 0);
    const unplaced = result.unplaced.reduce((sum, u) => sum + u.units, 0);
    expect(result.proposal.metrics.totalUnits + unplaced).toBe(stockTotal);
  });

  it('同じ入力なら何度実行しても同じ結果になる', () => {
    const a = analyzeDeadPositions(createSampleDeadPositionInput());
    const b = analyzeDeadPositions(createSampleDeadPositionInput());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('新たに空いたレーンは現状で使われていたレーンに限る', () => {
    const input = createSampleDeadPositionInput();
    const result = analyzeDeadPositions(input);
    const usedBefore = new Set(
      (input.current as LaneAssignment[]).filter((a) => a.units > 0).map((a) => a.laneId),
    );
    for (const id of result.newlyEmptyLaneIds) {
      expect(usedBefore.has(id)).toBe(true);
      expect(result.proposal.lanes.find((l) => l.laneId === id)!.empty).toBe(true);
    }
  });
});
