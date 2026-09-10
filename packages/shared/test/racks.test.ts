import { describe, expect, it } from 'vitest';
import {
  RACK_STATUS_LABEL,
  addUnits,
  createDefaultRackTypes,
  createLayoutObject,
  createRackUnit,
  createStacksForYard,
  deriveRackStatus,
  fillRatio,
  findRackType,
  findStackForRack,
  formatStackLevel,
  isEmptyRack,
  pickRackCategoryByMix,
  popRackFromStack,
  pushRackToStack,
  rackTypesForSize,
  removeUnits,
  stackUtilization,
  yardAccepts,
} from '../src/index.js';
import type { EmptyRackYardObject, RackStack, RackUnit } from '../src/index.js';

const [smallType, largeType] = createDefaultRackTypes('wh_1');

function yard(overrides: Partial<EmptyRackYardObject['emptyRackYard']> = {}): EmptyRackYardObject {
  return createLayoutObject({
    layoutId: 'lay_1',
    kind: 'empty-rack-yard',
    x: 10,
    y: 20,
    widthM: 12,
    depthM: 4,
    emptyRackYard: { stackColumns: 3, stackRows: 2, ...overrides },
  }) as EmptyRackYardObject;
}

describe('可搬ラック (RackUnit)', () => {
  it('種別から最大収納本数が決まる', () => {
    const rack = createRackUnit({ rackType: smallType! });
    expect(rack.capacityUnits).toBe(smallType!.maxUnits);
    expect(rack.status).toBe('empty');
    expect(isEmptyRack(rack)).toBe(true);
  });

  it('商品を積むと状態が 使用中 → 満載 に変わる', () => {
    let rack = createRackUnit({ rackType: smallType! });
    const partial = addUnits(rack, 10, 'psz_1');
    rack = partial.rack;
    expect(partial.added).toBe(10);
    expect(rack.status).toBe('stored');
    expect(fillRatio(rack)).toBeCloseTo(10 / smallType!.maxUnits);

    const filled = addUnits(rack, 999);
    expect(filled.added).toBe(smallType!.maxUnits - 10);
    expect(filled.rack.currentUnits).toBe(smallType!.maxUnits);
    expect(filled.rack.status).toBe('full');
  });

  it('全て取り出すと空ラックになる', () => {
    const loaded = createRackUnit({ rackType: largeType!, units: largeType!.maxUnits });
    expect(loaded.status).toBe('full');
    const partial = removeUnits(loaded, 5);
    expect(partial.rack.status).toBe('stored');
    const emptied = removeUnits(partial.rack, 999);
    expect(emptied.removed).toBe(largeType!.maxUnits - 5);
    expect(emptied.rack.currentUnits).toBe(0);
    expect(emptied.rack.status).toBe('empty');
    expect(RACK_STATUS_LABEL[emptied.rack.status]).toBe('空');
  });

  it('搬送中・積み重ね済みの状態は本数で上書きしない', () => {
    const carrying: RackUnit = { ...createRackUnit({ rackType: smallType! }), status: 'carrying' };
    expect(deriveRackStatus(carrying)).toBe('carrying');
  });

  it('商品サイズから使用可能なラック種別が決まる', () => {
    const small = rackTypesForSize({ rackCategory: 'small' }, [smallType!, largeType!]);
    expect(small).toHaveLength(1);
    expect(small[0]!.category).toBe('small');
    expect(findRackType([smallType!, largeType!], 'large')?.code).toBe('LARGE');
  });
});

describe('使用ラックサイズ割合 (要件8)', () => {
  it('割合どおりにラック種別が選ばれる', () => {
    const used = { small: 0, large: 0 };
    const mix = { smallPct: 60, largePct: 40 };
    for (let i = 0; i < 100; i++) {
      const category = pickRackCategoryByMix(mix, used);
      used[category] += 1;
    }
    expect(used.small).toBeGreaterThanOrEqual(58);
    expect(used.small).toBeLessThanOrEqual(62);
    expect(used.small + used.large).toBe(100);
  });

  it('片側0%なら常にもう一方が選ばれる', () => {
    const used = { small: 0, large: 0 };
    for (let i = 0; i < 10; i++) {
      const category = pickRackCategoryByMix({ smallPct: 0, largePct: 100 }, used);
      used[category] += 1;
    }
    expect(used.large).toBe(10);
  });
});

describe('空ラックの積み重ね (要件10・11)', () => {
  it('置き場の設定からスタック位置が格子状に作られる', () => {
    const stacks = createStacksForYard(yard());
    expect(stacks).toHaveLength(6);
    // 12m 幅を3列 -> 2m 刻みの中心
    expect(stacks[0]!.x).toBeCloseTo(12);
    expect(stacks[0]!.y).toBeCloseTo(21);
    expect(stacks[5]!.x).toBeCloseTo(30 - 10 + 0); // 最終列
  });

  it('同じスタックへ上限段数まで積み上げる', () => {
    let stacks: RackStack[] = createStacksForYard(yard());
    const stacked: RackUnit[] = [];

    // 小型ラックは6段まで
    for (let i = 0; i < 6; i++) {
      const rack = createRackUnit({ rackType: smallType! });
      const found = findStackForRack(stacks, rack, smallType!)!;
      expect(found.level).toBe(i + 1);
      const result = pushRackToStack(found.stack, rack, smallType!);
      stacks = stacks.map((s) => (s.id === result.stack.id ? result.stack : s));
      stacked.push(result.rack);
    }
    expect(stacks[0]!.rackUnitIds).toHaveLength(6);
    expect(stacked[5]!.stackLevel).toBe(6);
    expect(stacked[5]!.status).toBe('stacked');
    expect(formatStackLevel(stacks[0]!, [smallType!, largeType!])).toBe('6/6段（小型ラック）');

    // 7台目は別のスタックへ
    const seventh = createRackUnit({ rackType: smallType! });
    const next = findStackForRack(stacks, seventh, smallType!)!;
    expect(next.stack.id).not.toBe(stacks[0]!.id);
    expect(next.level).toBe(1);
  });

  it('大型ラックは4段までしか積めない', () => {
    let stacks: RackStack[] = createStacksForYard(yard({ stackColumns: 1, stackRows: 1 }));
    for (let i = 0; i < 4; i++) {
      const rack = createRackUnit({ rackType: largeType! });
      const found = findStackForRack(stacks, rack, largeType!)!;
      const result = pushRackToStack(found.stack, rack, largeType!);
      stacks = [result.stack];
    }
    expect(stacks[0]!.rackUnitIds).toHaveLength(4);
    // 5台目は積めない（置き場が満杯）
    const fifth = createRackUnit({ rackType: largeType! });
    expect(findStackForRack(stacks, fifth, largeType!)).toBeUndefined();

    const util = stackUtilization(stacks, [smallType!, largeType!]);
    expect(util.stackedRacks).toBe(4);
    expect(util.capacity).toBe(4);
    expect(util.full).toBe(true);
  });

  it('種別が違うラックは同じスタックに混ぜない', () => {
    let stacks: RackStack[] = createStacksForYard(yard({ stackColumns: 2, stackRows: 1 }));
    const small = createRackUnit({ rackType: smallType! });
    const pushed = pushRackToStack(findStackForRack(stacks, small, smallType!)!.stack, small, smallType!);
    stacks = stacks.map((s) => (s.id === pushed.stack.id ? pushed.stack : s));

    const large = createRackUnit({ rackType: largeType! });
    const found = findStackForRack(stacks, large, largeType!)!;
    expect(found.stack.id).not.toBe(pushed.stack.id);
    expect(found.level).toBe(1);
  });

  it('スタックから取り出せる', () => {
    let stacks: RackStack[] = createStacksForYard(yard({ stackColumns: 1, stackRows: 1 }));
    const rack = createRackUnit({ rackType: smallType! });
    const pushed = pushRackToStack(stacks[0]!, rack, smallType!);
    stacks = [pushed.stack];
    const popped = popRackFromStack(stacks[0]!);
    expect(popped.rackUnitId).toBe(rack.id);
    expect(popped.stack.rackUnitIds).toHaveLength(0);
    expect(popped.stack.rackTypeId).toBeUndefined();
  });

  it('受入種別を制限できる', () => {
    expect(yardAccepts(yard({ acceptedCategory: 'small' }), 'small')).toBe(true);
    expect(yardAccepts(yard({ acceptedCategory: 'small' }), 'large')).toBe(false);
    expect(yardAccepts(yard({ acceptedCategory: 'both' }), 'large')).toBe(true);
  });
});
