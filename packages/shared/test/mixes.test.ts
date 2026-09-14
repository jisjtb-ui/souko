import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIM_CONFIG,
  LogisticsSimulation,
  applyLevelMix,
  createLayoutObject,
  createSampleWarehouse,
  drawFillUnits,
  drawLevels,
  generateLocationsForRack,
  validateFillMix,
  validateLevelMix,
  Random,
} from '../src/index.js';
import type { LogisticsSimConfig, RackObject } from '../src/index.js';

function makeRack(columns: number, levels: number): RackObject {
  return createLayoutObject({
    layoutId: 'lay_1',
    kind: 'rack',
    x: 5,
    y: 5,
    widthM: 8,
    depthM: 1.2,
    rack: { columns, levels, capacityPerLocation: 0 },
  }) as RackObject;
}

function run(config: Partial<LogisticsSimConfig>) {
  const s = createSampleWarehouse();
  const sim = new LogisticsSimulation({
    warehouse: s.warehouse,
    objects: s.objects,
    locations: s.locations,
    areas: s.areas,
    connections: s.connections,
    shutters: s.shutters,
    rackTypes: s.rackTypes,
    productSizes: s.productSizes,
    config: { ...DEFAULT_SIM_CONFIG, tickSeconds: 2, ...config },
  });
  const snapshot = sim.runToEnd();
  return { snapshot, kpi: sim.kpi() };
}

describe('段数の割合', () => {
  it('選択肢が1つならその段数になる', () => {
    const random = new Random(1);
    expect(drawLevels([{ levels: 4, ratioPct: 100 }], random)).toBe(4);
  });

  it('未設定なら undefined（ラック定義の段数を使う）', () => {
    expect(drawLevels([], new Random(1))).toBeUndefined();
  });

  it('割合どおりに段数がばらつく', () => {
    const random = new Random(42);
    const mix = [
      { levels: 3, ratioPct: 50 },
      { levels: 5, ratioPct: 50 },
    ];
    const counts = new Map<number, number>();
    for (let i = 0; i < 400; i++) {
      const levels = drawLevels(mix, random)!;
      counts.set(levels, (counts.get(levels) ?? 0) + 1);
    }
    expect(counts.get(3)).toBeGreaterThan(150);
    expect(counts.get(5)).toBeGreaterThan(150);
  });

  it('保管位置を段数ぶんに増やす', () => {
    const rack = makeRack(4, 1);
    const locations = generateLocationsForRack(rack);
    expect(locations).toHaveLength(4);

    const expanded = applyLevelMix(locations, [rack], [{ levels: 3, ratioPct: 100 }], new Random(1));
    expect(expanded).toHaveLength(12);
    // 列ごとに3段ぶんできている
    const byColumn = new Map<number, number>();
    for (const l of expanded) byColumn.set(l.column, (byColumn.get(l.column) ?? 0) + 1);
    expect([...byColumn.values()]).toEqual([3, 3, 3, 3]);
    // ロケーション番号は重複しない
    expect(new Set(expanded.map((l) => l.code)).size).toBe(12);
    expect(new Set(expanded.map((l) => l.id)).size).toBe(12);
  });

  it('保存されている段数より少ないときは下段から使う', () => {
    const rack = makeRack(2, 4);
    const locations = generateLocationsForRack(rack);
    const reduced = applyLevelMix(locations, [rack], [{ levels: 2, ratioPct: 100 }], new Random(1));
    expect(reduced).toHaveLength(4);
    const levels = [...new Set(reduced.map((l) => l.level))].sort();
    expect(levels).toEqual([1, 2]);
  });

  it('段数が保存値と同じなら入力をそのまま返す（並び順も維持）', () => {
    const rack = makeRack(3, 3);
    const locations = generateLocationsForRack(rack);
    const same = applyLevelMix(locations, [rack], [{ levels: 3, ratioPct: 100 }], new Random(1));
    expect(same.map((l) => l.id)).toEqual(locations.map((l) => l.id));
  });

  it('同じシードなら同じ結果になる', () => {
    const rack = makeRack(3, 1);
    const locations = generateLocationsForRack(rack);
    const mix = [
      { levels: 2, ratioPct: 50 },
      { levels: 5, ratioPct: 50 },
    ];
    const a = applyLevelMix(locations, [rack], mix, new Random(99));
    const b = applyLevelMix(locations, [rack], mix, new Random(99));
    expect(b.map((l) => l.id)).toEqual(a.map((l) => l.id));
  });
});

describe('入り本数の割合', () => {
  it('満載に対する割合で本数が決まる', () => {
    const random = new Random(1);
    expect(drawFillUnits([{ fillPct: 100, ratioPct: 100 }], 16, 16, random)).toBe(16);
    expect(drawFillUnits([{ fillPct: 50, ratioPct: 100 }], 16, 16, random)).toBe(8);
    expect(drawFillUnits([{ fillPct: 25, ratioPct: 100 }], 16, 16, random)).toBe(4);
  });

  it('満載を超えず、0本にもしない', () => {
    const random = new Random(1);
    expect(drawFillUnits([{ fillPct: 100, ratioPct: 100 }], 4, 999, random)).toBe(4);
    expect(drawFillUnits([{ fillPct: 1, ratioPct: 100 }], 4, 4, random)).toBe(1);
  });

  it('未設定なら商品サイズの本数を使う', () => {
    expect(drawFillUnits([], 20, 12, new Random(1))).toBe(12);
  });
});

describe('割合がシミュレーション結果に反映される', () => {
  it('段数を増やすと保管できる位置が増える', () => {
    const few = run({ levelMix: [{ levels: 1, ratioPct: 100 }] });
    const many = run({ levelMix: [{ levels: 5, ratioPct: 100 }] });
    expect(many.snapshot.occupancy.size).toBeGreaterThan(few.snapshot.occupancy.size);
  }, 120_000);

  it('入り本数を減らすと同じ本数を運ぶのに作業回数が増える', () => {
    const full = run({ fillMix: [{ fillPct: 100, ratioPct: 100 }] });
    const half = run({ fillMix: [{ fillPct: 50, ratioPct: 100 }] });
    expect(half.kpi.completedTasks).toBeGreaterThan(full.kpi.completedTasks);
  }, 120_000);

  it('既定値は従来どおり（3段・満載）', () => {
    expect(DEFAULT_SIM_CONFIG.levelMix).toEqual([{ levels: 3, ratioPct: 100 }]);
    expect(DEFAULT_SIM_CONFIG.fillMix).toEqual([{ fillPct: 100, ratioPct: 100 }]);
  });
});

describe('割合の検証', () => {
  it('合計100%でなければエラーにする', () => {
    expect(validateLevelMix([{ levels: 3, ratioPct: 60 }])).not.toHaveLength(0);
    expect(validateFillMix([{ fillPct: 100, ratioPct: 60 }])).not.toHaveLength(0);
  });

  it('未設定（空）は許容する', () => {
    expect(validateLevelMix([])).toHaveLength(0);
    expect(validateFillMix([])).toHaveLength(0);
  });

  it('重複と範囲外を検出する', () => {
    const e1 = validateLevelMix([
      { levels: 3, ratioPct: 50 },
      { levels: 3, ratioPct: 50 },
    ]);
    expect(e1.some((e) => e.includes('重複'))).toBe(true);
    const e2 = validateFillMix([{ fillPct: 150, ratioPct: 100 }]);
    expect(e2.some((e) => e.includes('1〜100'))).toBe(true);
  });
});
