import { describe, expect, it } from 'vitest';
import {
  buildRackIndex,
  createDefaultProductSizes,
  createDefaultRackTypes,
  createLayoutObject,
  createRackUnit,
  findFreeLocation,
  findStoredRackForSize,
  generateLocationsForRack,
  isLocationEligible,
  matchesPreferredArea,
  SLOTTING_STRATEGY_LABEL,
} from '../src/index.js';
import type { Location, RackObject, RackUnit, SlottingContext } from '../src/index.js';

const [smallType, largeType] = createDefaultRackTypes('wh_1');
const sizes = createDefaultProductSizes('wh_1');
const smallHighTurnover = sizes.find((s) => s.rackCategory === 'small' && s.turnover === 'high')!;
const largeSize = sizes.find((s) => s.rackCategory === 'large')!;

/** 北側(大型/北側タグ)と南側(小型/南側タグ)のラックを持つテスト用レイアウト。 */
function buildLayout() {
  const northRack = createLayoutObject({
    layoutId: 'lay_1',
    kind: 'rack',
    name: '北ラック',
    x: 10,
    y: 5,
    widthM: 12,
    depthM: 1.2,
    rack: {
      columns: 4,
      levels: 1,
      capacityPerLocation: largeType!.maxUnits,
      naming: { area: 'N' },
      rackTypeId: largeType!.id,
      rackCategory: 'large',
      areaTag: '北側',
    },
  }) as RackObject;

  const southRack = createLayoutObject({
    layoutId: 'lay_1',
    kind: 'rack',
    name: '南ラック',
    x: 10,
    y: 35,
    widthM: 12,
    depthM: 1.2,
    rack: {
      columns: 4,
      levels: 1,
      capacityPerLocation: smallType!.maxUnits,
      naming: { area: 'S' },
      rackTypeId: smallType!.id,
      rackCategory: 'small',
      areaTag: '南側',
    },
  }) as RackObject;

  // 小型ラックを受け入れる中央のラック（優先エリアタグなし）
  const midRack = createLayoutObject({
    layoutId: 'lay_1',
    kind: 'rack',
    name: '中央ラック',
    x: 10,
    y: 20,
    widthM: 12,
    depthM: 1.2,
    rack: {
      columns: 4,
      levels: 1,
      capacityPerLocation: smallType!.maxUnits,
      naming: { area: 'M' },
      rackTypeId: smallType!.id,
      rackCategory: 'small',
    },
  }) as RackObject;

  const objects = [northRack, southRack, midRack];
  const locations = objects.flatMap((rack) => generateLocationsForRack(rack));
  return { objects, locations, northRack, southRack, midRack };
}

function context(overrides: Partial<SlottingContext> = {}): SlottingContext {
  const { objects, locations } = buildLayout();
  return {
    locations,
    occupancy: new Map(),
    reserved: new Set(),
    racksById: buildRackIndex(objects),
    size: smallHighTurnover,
    rackType: smallType!,
    fromPoint: { x: 2, y: 2 }, // 倉入れ口（北西）
    outboundPoints: [{ x: 2, y: 40 }], // 出荷ゲート（南西）
    ...overrides,
  };
}

describe('フリーロケーション: 適合判定 (要件6-1,2)', () => {
  it('サイズが合わないラックは候補から外れる', () => {
    const ctx = context({ rackType: largeType! });
    const northLocations = ctx.locations.filter((l) => l.code.startsWith('N'));
    const southLocations = ctx.locations.filter((l) => l.code.startsWith('S'));
    expect(northLocations.every((l) => isLocationEligible(ctx, l))).toBe(true);
    expect(southLocations.some((l) => isLocationEligible(ctx, l))).toBe(false);
  });

  it('使用中・予約済みのロケーションは候補から外れる', () => {
    const base = context();
    const target = base.locations.find((l) => l.code.startsWith('S'))!;
    const occupied: SlottingContext = {
      ...base,
      occupancy: new Map([[target.id, createRackUnit({ rackType: smallType! })]]),
    };
    expect(isLocationEligible(occupied, target)).toBe(false);

    const reserved: SlottingContext = { ...base, reserved: new Set([target.id]) };
    expect(isLocationEligible(reserved, target)).toBe(false);
  });

  it('使用不可のロケーションは候補から外れる', () => {
    const ctx = context();
    const blocked: Location = { ...ctx.locations[0]!, blocked: true };
    expect(isLocationEligible(ctx, blocked)).toBe(false);
  });
});

describe('フリーロケーション: 選択ルール (要件6-3,4,5)', () => {
  it('最短距離ルールは搬入口に最も近い場所を選ぶ', () => {
    const result = findFreeLocation(context(), 'nearest')!;
    expect(result).toBeDefined();
    // 倉入れ口(2,2)に最も近いのは中央ではなく北側…だが小型ラックは中央/南のみ
    expect(result.location.code.startsWith('M')).toBe(true);
    const others = context().locations.filter((l) => l.id !== result.location.id);
    expect(others.every((l) => l.approachY >= 0)).toBe(true);
  });

  it('出荷頻度ルールは高回転商品を出荷口の近くへ置く', () => {
    const high = findFreeLocation(context({ size: smallHighTurnover }), 'turnover')!;
    const lowTurnoverSize = { ...smallHighTurnover, turnover: 'low' as const };
    const low = findFreeLocation(context({ size: lowTurnoverSize }), 'turnover')!;

    // 出荷ゲートは南(2,40)。高回転は南側ラックへ、低回転はより手前(中央)へ
    expect(high.distanceToShipM).toBeLessThan(low.distanceToShipM);
    expect(high.location.code.startsWith('S')).toBe(true);
  });

  it('優先エリアルールは指定エリアを優先する', () => {
    const ctx = context({ size: { ...smallHighTurnover, preferredAreaTag: '南側' } });
    const result = findFreeLocation(ctx, 'preferred-zone')!;
    expect(result.location.code.startsWith('S')).toBe(true);
    expect(result.reasons.some((r) => r.includes('優先エリア'))).toBe(true);
    expect(matchesPreferredArea(ctx, result.location)).toBe(true);
  });

  it('優先エリアが埋まっていれば他のエリアへ回る', () => {
    const base = context({ size: { ...smallHighTurnover, preferredAreaTag: '南側' } });
    const southIds = base.locations.filter((l) => l.code.startsWith('S')).map((l) => l.id);
    const occupancy = new Map(southIds.map((id) => [id, createRackUnit({ rackType: smallType! })]));
    const result = findFreeLocation({ ...base, occupancy }, 'preferred-zone')!;
    expect(result.location.code.startsWith('M')).toBe(true);
    expect(result.reasons.some((r) => r.includes('空きなし'))).toBe(true);
  });

  it('大型商品は大型ラックのロケーションにしか入らない', () => {
    const result = findFreeLocation(
      context({ size: largeSize, rackType: largeType! }),
      'balanced',
    )!;
    expect(result.location.code.startsWith('N')).toBe(true);
  });

  it('総合ルールは優先エリアと距離の両方を考慮する', () => {
    const ctx = context({ size: { ...smallHighTurnover, preferredAreaTag: '南側' } });
    const result = findFreeLocation(ctx, 'balanced')!;
    expect(result.location.code.startsWith('S')).toBe(true);
    expect(result.reasons[0]).toContain('優先エリア');
  });

  it('空きが無ければ undefined を返す', () => {
    const base = context();
    const occupancy = new Map(base.locations.map((l) => [l.id, createRackUnit({ rackType: smallType! })]));
    expect(findFreeLocation({ ...base, occupancy }, 'balanced')).toBeUndefined();
  });

  it('距離計算を差し替えられる（A*距離の注入）', () => {
    // 南側へ行くには大回りが必要、という距離関数を注入する
    const ctx = context({
      distanceFn: (a, b) => (b.y > 30 || a.y > 30 ? 999 : Math.hypot(b.x - a.x, b.y - a.y)),
    });
    const result = findFreeLocation(ctx, 'nearest')!;
    expect(result.location.code.startsWith('S')).toBe(false);
  });

  it('ルールは差し替え可能なレジストリで管理されている', () => {
    expect(Object.keys(SLOTTING_STRATEGY_LABEL)).toEqual([
      'nearest',
      'turnover',
      'preferred-zone',
      'balanced',
    ]);
  });
});

describe('出庫対象の検索', () => {
  it('同じサイズの在庫を先入れ先出しで選ぶ', () => {
    const older: RackUnit = {
      ...createRackUnit({ rackType: smallType!, productSizeId: smallHighTurnover.id, units: 10 }),
      storedAtSec: 100,
    };
    const newer: RackUnit = {
      ...createRackUnit({ rackType: smallType!, productSizeId: smallHighTurnover.id, units: 10 }),
      storedAtSec: 500,
    };
    const occupancy = new Map([
      ['loc_new', newer],
      ['loc_old', older],
    ]);
    const found = findStoredRackForSize(occupancy, smallHighTurnover.id)!;
    expect(found.locationId).toBe('loc_old');

    // 除外指定で次の候補へ
    const next = findStoredRackForSize(occupancy, smallHighTurnover.id, {
      excludeLocationIds: new Set(['loc_old']),
    })!;
    expect(next.locationId).toBe('loc_new');
  });

  it('該当サイズの在庫が無ければ undefined', () => {
    expect(findStoredRackForSize(new Map(), smallHighTurnover.id)).toBeUndefined();
  });
});
