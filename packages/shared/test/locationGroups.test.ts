import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIM_CONFIG,
  LogisticsSimulation,
  applyRackType,
  createDefaultRackTypes,
  createSampleWarehouse,
  isRackObject,
  createLocationGroup,
  deriveLocationGroups,
  formatBlockCode,
  formatSlotCode,
  generateLocationGroup,
  locationGroupStats,
  locationTotals,
  parseSlotCode,
  summarizeLocationAddresses,
  validateLocationGroup,
} from '../src/index.js';
import type { LocationGroupInput, RackObject } from '../src/index.js';

const [smallType, largeType] = createDefaultRackTypes('wh_1');

function group(overrides: Partial<LocationGroupInput> = {}) {
  return createLocationGroup({
    warehouseId: 'wh_1',
    layoutId: 'lay_1',
    startNumber: '001',
    rackTypeId: largeType!.id,
    verticalColumns: 3,
    horizontalBlocks: 23,
    levels: 4,
    unitsPerSlot: 10,
    rackWidthM: 2.5,
    rackDepthM: 1.2,
    ...overrides,
  });
}

/* --------------------------------------------------------------- 番号 */

describe('ロケーション番号', () => {
  it('住所は「開始番号-横方向番号」', () => {
    expect(formatBlockCode('001', 1)).toBe('001-1');
    expect(formatBlockCode('001', 23)).toBe('001-23');
    expect(formatBlockCode('101', 1)).toBe('101-1');
  });

  it('物理収納単位は「住所-C列-L段」', () => {
    expect(formatSlotCode('001-1', 1, 1)).toBe('001-1-C1-L1');
    expect(formatSlotCode('001-1', 3, 4)).toBe('001-1-C3-L4');
  });

  it('物理収納単位の番号を分解できる', () => {
    expect(parseSlotCode('001-1-C2-L3')).toEqual({ locationCode: '001-1', column: 2, level: 3 });
    expect(parseSlotCode('101-23-C1-L1')).toEqual({
      locationCode: '101-23',
      column: 1,
      level: 1,
    });
    expect(parseSlotCode('A-01-02')).toBeUndefined();
  });
});

/* --------------------------------------------------------------- 集計 */

describe('生成プレビューの数値', () => {
  it('縦3列 × 横23ブロック → 69列・23ロケーション', () => {
    const stats = locationGroupStats(group());
    expect(stats.totalPhysicalColumns).toBe(69);
    expect(stats.locationCount).toBe(23);
  });

  it('容量は 1列1段 × 段数 × 縦列数 × ブロック数', () => {
    const stats = locationGroupStats(group());
    expect(stats.unitsPerColumn).toBe(40); // 10本 × 4段
    expect(stats.unitsPerLocation).toBe(120); // 40 × 3列
    expect(stats.totalUnits).toBe(2760); // 120 × 23
    expect(stats.slotCount).toBe(276); // 3列 × 4段 × 23
  });

  it('横ブロック数を変えるとロケーション数が変わる', () => {
    expect(locationGroupStats(group({ horizontalBlocks: 10 })).locationCount).toBe(10);
    expect(locationGroupStats(group({ horizontalBlocks: 50 })).locationCount).toBe(50);
  });

  it('縦列数を変えてもロケーション数は変わらず、1ロケーションの容量が変わる', () => {
    const two = locationGroupStats(group({ verticalColumns: 2 }));
    const four = locationGroupStats(group({ verticalColumns: 4 }));
    expect(two.locationCount).toBe(23);
    expect(four.locationCount).toBe(23);
    expect(two.unitsPerLocation).toBe(80);
    expect(four.unitsPerLocation).toBe(160);
    // 物理的な奥行きも変わる
    expect(four.blockDepthM).toBeGreaterThan(two.blockDepthM);
  });
});

describe('生成条件の検証', () => {
  it('開始番号が空・列数0はエラー', () => {
    expect(validateLocationGroup(group({ startNumber: '' })).length).toBeGreaterThan(0);
    expect(validateLocationGroup({ ...group(), verticalColumns: 0 }).length).toBeGreaterThan(0);
  });

  it('正しい条件ならエラーなし', () => {
    expect(validateLocationGroup(group())).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- 生成 */

describe('ロケーションの自動生成', () => {
  const generated = generateLocationGroup(group());

  it('ブロック数だけロケーション住所ができる', () => {
    expect(generated.objects).toHaveLength(23);
    expect(generated.objects[0]!.name).toBe('001-1');
    expect(generated.objects[22]!.name).toBe('001-23');
  });

  it('住所は 001-1 〜 001-23 で重複しない', () => {
    const codes = generated.objects.map((o) => o.rack.block!.locationCode);
    expect(codes[0]).toBe('001-1');
    expect(codes.at(-1)).toBe('001-23');
    expect(new Set(codes).size).toBe(23);
  });

  it('物理収納単位は 列 × 段 × ブロック', () => {
    expect(generated.locations).toHaveLength(276);
    expect(new Set(generated.locations.map((l) => l.code)).size).toBe(276);
  });

  it('物理収納単位の番号は 001-1-C1-L1 形式', () => {
    const first = generated.locations.find((l) => l.code === '001-1-C1-L1');
    expect(first).toBeDefined();
    expect(generated.locations.some((l) => l.code === '001-1-C3-L4')).toBe(true);
    expect(generated.locations.some((l) => l.code === '001-23-C3-L4')).toBe(true);
  });

  it('1つの住所は縦列 × 段の内部構造を持つ', () => {
    const block = generated.objects[0]!;
    const slots = generated.locations.filter((l) => l.rackId === block.id);
    expect(slots).toHaveLength(12); // 3列 × 4段
    expect(new Set(slots.map((s) => s.column))).toEqual(new Set([1, 2, 3]));
    expect(new Set(slots.map((s) => s.level))).toEqual(new Set([1, 2, 3, 4]));
  });

  it('縦列は奥行方向に重なる（横方向はブロックで分かれる）', () => {
    const block = generated.objects[0]!;
    expect(block.rack.columnAxis).toBe('depth');
    // ブロックの奥行 = 3列 × 1.2m
    expect(block.depthM).toBeCloseTo(3.6, 5);
    expect(block.widthM).toBeCloseTo(2.5, 5);

    const slots = generated.locations
      .filter((l) => l.rackId === block.id && l.level === 1)
      .sort((a, b) => a.column - b.column);
    // 列が変わると Y が変わり、X は変わらない
    expect(slots[0]!.x).toBeCloseTo(slots[2]!.x, 5);
    expect(slots[0]!.y).toBeLessThan(slots[2]!.y);
  });

  it('ブロックは横方向に並ぶ', () => {
    const [a, b] = generated.objects;
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(b!.y).toBeCloseTo(a!.y, 5);
  });

  it('開始番号を変えると住所が変わる', () => {
    const other = generateLocationGroup(group({ startNumber: '101', horizontalBlocks: 3 }));
    expect(other.objects.map((o) => o.name)).toEqual(['101-1', '101-2', '101-3']);
  });

  it('ラック種別の実寸と収納本数を取り込める', () => {
    const applied = applyRackType(group(), smallType!);
    expect(applied.rackWidthM).toBe(smallType!.widthM);
    expect(applied.rackDepthM).toBe(smallType!.depthM);
    expect(applied.unitsPerSlot).toBe(smallType!.maxUnits);
  });
});

/* ------------------------------------------------- 住所ごとの状態と容量 */

describe('住所ごとの集計', () => {
  const generated = generateLocationGroup(group({ horizontalBlocks: 3 }));

  it('生成直後はすべて「空」', () => {
    const views = summarizeLocationAddresses(generated.objects, generated.locations);
    expect(views).toHaveLength(3);
    expect(views.every((v) => v.status === 'empty')).toBe(true);
    expect(views.every((v) => v.currentQuantity === 0)).toBe(true);
  });

  it('最大容量・在庫・空き・使用率を計算する', () => {
    const block = generated.objects[0]!;
    const slots = generated.locations.filter((l) => l.rackId === block.id);
    // 12箇所のうち最初の数箇所に在庫を入れる
    const occupancy = new Map<string, string>();
    const rackUnits = new Map<
      string,
      { currentUnits: number; capacityUnits: number; productSizeId?: string }
    >();
    slots.slice(0, 9).forEach((slot, i) => {
      const unitId = `ru_${i}`;
      occupancy.set(slot.id, unitId);
      rackUnits.set(unitId, { currentUnits: 10, capacityUnits: 10, productSizeId: 'psz_a' });
    });

    const views = summarizeLocationAddresses(generated.objects, generated.locations, {
      occupancy,
      rackUnits,
    });
    const view = views.find((v) => v.locationCode === '001-1')!;

    expect(view.capacity).toBe(120); // 10本 × 12箇所
    expect(view.currentQuantity).toBe(90);
    expect(view.freeCapacity).toBe(30);
    expect(view.usageRatio).toBeCloseTo(0.75, 5);
    expect(view.status).toBe('stored');
    expect(view.productSizeIds).toEqual(['psz_a']);
    expect(view.slots).toHaveLength(12);
  });

  it('満載・入庫中・出庫中を判別する', () => {
    const block = generated.objects[0]!;
    const slots = generated.locations.filter((l) => l.rackId === block.id);
    const fill = (status?: string) => {
      const occupancy = new Map<string, string>();
      const rackUnits = new Map<string, { currentUnits: number; capacityUnits: number; status?: string }>();
      slots.forEach((slot, i) => {
        occupancy.set(slot.id, `u${i}`);
        rackUnits.set(`u${i}`, { currentUnits: 10, capacityUnits: 10, ...(status ? { status } : {}) });
      });
      return summarizeLocationAddresses(generated.objects, generated.locations, {
        occupancy,
        rackUnits,
      }).find((v) => v.locationCode === '001-1')!;
    };

    expect(fill().status).toBe('full');
    expect(fill('loading').status).toBe('inbound');
    expect(fill('unloading').status).toBe('outbound');
  });

  it('全体の数値を集計できる', () => {
    const views = summarizeLocationAddresses(generated.objects, generated.locations);
    const totals = locationTotals(views);
    expect(totals.locationCount).toBe(3);
    expect(totals.slotCount).toBe(36);
    expect(totals.capacity).toBe(360);
    expect(totals.emptyLocations).toBe(3);
    expect(totals.usageRatio).toBe(0);
  });
});

/* ------------------------------------------------------- グループの復元 */

describe('保存済みブロックからの復元', () => {
  it('生成条件を復元できる', () => {
    const original = group({ horizontalBlocks: 5, verticalColumns: 3, levels: 4 });
    const generated = generateLocationGroup(original);
    const [restored] = deriveLocationGroups(
      generated.objects as RackObject[],
      'wh_1',
      'lay_1',
    );

    expect(restored).toBeDefined();
    expect(restored!.startNumber).toBe('001');
    expect(restored!.verticalColumns).toBe(3);
    expect(restored!.horizontalBlocks).toBe(5);
    expect(restored!.levels).toBe(4);
    expect(restored!.unitsPerSlot).toBe(10);
    expect(restored!.rackWidthM).toBeCloseTo(2.5, 3);
    expect(restored!.rackDepthM).toBeCloseTo(1.2, 3);
    expect(restored!.singleSizePerLocation).toBe(true);
  });

  it('自動生成でないラックは対象外', () => {
    expect(deriveLocationGroups([], 'wh_1', 'lay_1')).toHaveLength(0);
  });
});

/* ------------------------------------------- シミュレーションとの連携 (§23) */

describe('生成したロケーションでシミュレーションが動く', () => {
  function runWithGeneratedLocations() {
    const sample = createSampleWarehouse();
    const generated = generateLocationGroup(
      createLocationGroup({
        warehouseId: sample.warehouse.id,
        layoutId: sample.layout.id,
        startNumber: '001',
        rackTypeId: sample.rackTypes[0]!.id,
        verticalColumns: 3,
        horizontalBlocks: 12,
        levels: 4,
        // 1つの物理収納単位には可搬ラック1台が入るため、その最大本数に合わせる
        unitsPerSlot: sample.rackTypes[0]!.maxUnits,
        rackWidthM: 2.0,
        rackDepthM: 1.0,
        x: 6,
        y: 34,
      }),
    );

    // 既存のラックは置き換え、自動生成したロケーションだけにする
    const objects = [
      ...sample.objects.filter((o) => !isRackObject(o)),
      ...generated.objects,
    ];

    const sim = new LogisticsSimulation({
      warehouse: sample.warehouse,
      objects,
      locations: generated.locations,
      areas: sample.areas,
      connections: sample.connections,
      shutters: sample.shutters,
      rackTypes: sample.rackTypes,
      productSizes: sample.productSizes,
      config: { ...DEFAULT_SIM_CONFIG, tickSeconds: 2, levelMix: [], endTime: '12:00' },
    });
    const snapshot = sim.runToEnd();
    return { sample, objects: generated.objects, locations: generated.locations, snapshot, kpi: sim.kpi() };
  }

  const result = runWithGeneratedLocations();

  it('入庫が処理され、生成したロケーションに在庫が入る', () => {
    expect(result.kpi.inboundUnits).toBeGreaterThan(0);
    expect(result.snapshot.occupancy.size).toBeGreaterThan(0);
  }, 120_000);

  it('1つのロケーション住所には1つの商品サイズしか入らない', () => {
    const views = summarizeLocationAddresses(result.objects, result.locations, {
      occupancy: result.snapshot.occupancy,
      rackUnits: new Map(result.snapshot.rackUnits.map((u) => [u.id, u])),
    });
    const used = views.filter((v) => v.currentQuantity > 0);
    expect(used.length).toBeGreaterThan(0);
    for (const view of used) {
      expect(view.productSizeIds.length).toBe(1);
    }
  }, 120_000);

  it('住所の使用率と全体集計が計算できる', () => {
    const views = summarizeLocationAddresses(result.objects, result.locations, {
      occupancy: result.snapshot.occupancy,
      rackUnits: new Map(result.snapshot.rackUnits.map((u) => [u.id, u])),
    });
    const totals = locationTotals(views);
    expect(totals.locationCount).toBe(12);
    expect(totals.capacity).toBe(12 * 3 * 4 * result.sample.rackTypes[0]!.maxUnits);
    expect(totals.currentQuantity).toBeGreaterThan(0);
    expect(totals.usageRatio).toBeGreaterThan(0);
    expect(totals.sizeCount).toBeGreaterThan(0);
  }, 120_000);
});
