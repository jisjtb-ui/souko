import { createId } from '../domain/ids.js';
import { localToWorld } from '../geometry/index.js';
import type { EmptyRackYardObject } from '../domain/types.js';
import type { RackCategory, RackStack, RackType, RackUnit } from '../domain/logistics.js';
import type { ID } from '../domain/ids.js';

/* ============================================================================
 * 空ラックの積み重ね管理
 * ----------------------------------------------------------------------------
 * 空ラック置き場には「スタック位置」が格子状に並ぶ。
 * 各スタックには同じ種別のラックを、その種別の
 * 「空の場合の最大積み重ね段数」まで積める。
 * 満杯になったら別のスタックへ回す。
 * ========================================================================== */

/** 空ラック置き場からスタック位置を生成する。 */
export function createStacksForYard(
  yard: EmptyRackYardObject,
  options: { defaultMaxLevels?: number } = {},
): RackStack[] {
  const { stackColumns, stackRows } = yard.emptyRackYard;
  const cols = Math.max(1, stackColumns);
  const rows = Math.max(1, stackRows);
  const cellW = yard.widthM / cols;
  const cellD = yard.depthM / rows;
  const stacks: RackStack[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const center = localToWorld(yard, {
        x: cellW * (col + 0.5),
        y: cellD * (row + 0.5),
      });
      stacks.push({
        id: createId('stk'),
        yardObjectId: yard.id,
        x: center.x,
        y: center.y,
        rackUnitIds: [],
        maxLevels: options.defaultMaxLevels ?? 1,
      });
    }
  }
  return stacks;
}

/** その置き場がラック種別を受け入れるか。 */
export function yardAccepts(yard: EmptyRackYardObject, category: RackCategory): boolean {
  const accepted = yard.emptyRackYard.acceptedCategory;
  return accepted === 'both' || accepted === category;
}

export interface StackSearchResult {
  stack: RackStack;
  /** 積んだ後の段位置 (1 始まり) */
  level: number;
}

/**
 * 空ラックを積めるスタックを探す。
 *
 * 1. 同じ種別が積まれていて、まだ上限に達していないスタック（積み上げ優先）
 * 2. まだ何も積まれていない空きスタック
 *
 * どちらも無ければ undefined（＝置き場が満杯）。
 */
export function findStackForRack(
  stacks: readonly RackStack[],
  rack: RackUnit,
  rackType: RackType,
): StackSearchResult | undefined {
  const maxLevels = Math.max(1, rackType.maxStackWhenEmpty);

  // 既に同種別が積まれているスタックのうち、最も高く積まれているものへ積む
  const partial = stacks
    .filter(
      (stack) =>
        stack.rackTypeId === rack.rackTypeId &&
        stack.rackUnitIds.length > 0 &&
        stack.rackUnitIds.length < Math.max(1, stack.maxLevels || maxLevels),
    )
    .sort((a, b) => b.rackUnitIds.length - a.rackUnitIds.length)[0];
  if (partial) return { stack: partial, level: partial.rackUnitIds.length + 1 };

  const empty = stacks.find((stack) => stack.rackUnitIds.length === 0);
  if (empty) return { stack: empty, level: 1 };

  return undefined;
}

/** 空ラックをスタックへ積む。更新後のスタックとラックを返す。 */
export function pushRackToStack(
  stack: RackStack,
  rack: RackUnit,
  rackType: RackType,
): { stack: RackStack; rack: RackUnit } {
  const maxLevels = Math.max(1, rackType.maxStackWhenEmpty);
  if (stack.rackUnitIds.length >= (stack.rackTypeId ? stack.maxLevels : maxLevels)) {
    return { stack, rack };
  }
  const level = stack.rackUnitIds.length + 1;
  return {
    stack: {
      ...stack,
      rackTypeId: rack.rackTypeId,
      maxLevels,
      rackUnitIds: [...stack.rackUnitIds, rack.id],
    },
    rack: {
      ...rack,
      status: 'stacked',
      stackId: stack.id,
      stackLevel: level,
      locationId: undefined,
      forkliftId: undefined,
      gateObjectId: undefined,
      x: stack.x,
      y: stack.y,
    },
  };
}

/** スタックの一番上から空ラックを取り出す（再利用時）。 */
export function popRackFromStack(stack: RackStack): { stack: RackStack; rackUnitId?: ID } {
  if (stack.rackUnitIds.length === 0) return { stack };
  const rackUnitIds = [...stack.rackUnitIds];
  const rackUnitId = rackUnitIds.pop()!;
  return {
    stack: {
      ...stack,
      rackUnitIds,
      ...(rackUnitIds.length === 0 ? { rackTypeId: undefined } : {}),
    },
    rackUnitId,
  };
}

export interface StackUtilization {
  /** 積まれている空ラックの総数 */
  stackedRacks: number;
  /** 積み上げ可能な総数 */
  capacity: number;
  /** 使用中のスタック位置 */
  usedStacks: number;
  totalStacks: number;
  /** 満杯かどうか */
  full: boolean;
}

/** 空ラック置き場の使用状況。 */
export function stackUtilization(
  stacks: readonly RackStack[],
  rackTypes: readonly RackType[],
): StackUtilization {
  const defaultMax = Math.max(1, ...rackTypes.map((t) => t.maxStackWhenEmpty));
  const stackedRacks = stacks.reduce((sum, s) => sum + s.rackUnitIds.length, 0);
  const capacity = stacks.reduce(
    (sum, s) => sum + (s.rackTypeId ? s.maxLevels : defaultMax),
    0,
  );
  const usedStacks = stacks.filter((s) => s.rackUnitIds.length > 0).length;
  const full = stacks.every(
    (s) => s.rackUnitIds.length >= (s.rackTypeId ? s.maxLevels : defaultMax),
  );
  return { stackedRacks, capacity, usedStacks, totalStacks: stacks.length, full };
}

/** 表示用: 「3/6段」のような文字列。 */
export function formatStackLevel(stack: RackStack, rackTypes: readonly RackType[]): string {
  const type = rackTypes.find((t) => t.id === stack.rackTypeId);
  const max = stack.rackTypeId ? stack.maxLevels : Math.max(1, ...rackTypes.map((t) => t.maxStackWhenEmpty));
  return `${stack.rackUnitIds.length}/${max}段${type ? `（${type.name}）` : ''}`;
}
