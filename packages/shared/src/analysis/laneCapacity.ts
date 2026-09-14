import type { ID } from '../domain/ids.js';
import type { ProductSize } from '../domain/logistics.js';

/* ============================================================================
 * 深さ×サイズ 収容本数マスタ
 * ----------------------------------------------------------------------------
 * 「レーン」は保管ラックの1列 (Location.column) を奥行き方向に見たもの。
 * 深さ d のレーンに商品サイズ s が何本入るかは物理的に決まるため、
 * ここでマスタとして保持する。既存の ProductSize.unitsPerRack
 * (1ラックあたり本数) とは別概念なので、そちらは変更しない。
 * ========================================================================== */

/** 収容本数マスタが扱う奥行きレーン数。 */
export const LANE_DEPTHS = [1, 2, 3, 4, 5, 6, 7, 11, 16] as const;

export type LaneDepth = (typeof LANE_DEPTHS)[number];

export function isLaneDepth(value: number): value is LaneDepth {
  return (LANE_DEPTHS as readonly number[]).includes(value);
}

/** 深さ×サイズ 1レーンあたりの収容本数。 */
export interface LaneCapacityEntry {
  /** 奥行きレーン数 */
  depth: number;
  /** 商品サイズ (ProductSize.id) */
  productSizeId: ID;
  /** そのレーンに入る本数 */
  unitsPerLane: number;
}

const keyOf = (depth: number, productSizeId: ID): string => `${depth}|${productSizeId}`;

/** 参照用の索引。entries を毎回線形探索しないための薄いラッパ。 */
export type LaneCapacityIndex = ReadonlyMap<string, number>;

export function buildCapacityIndex(entries: readonly LaneCapacityEntry[]): LaneCapacityIndex {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (entry.unitsPerLane <= 0) continue;
    map.set(keyOf(entry.depth, entry.productSizeId), Math.floor(entry.unitsPerLane));
  }
  return map;
}

/** 収容本数を引く。マスタに無い組み合わせは undefined (= そのレーンには置けない)。 */
export function capacityOf(
  index: LaneCapacityIndex,
  depth: number,
  productSizeId: ID,
): number | undefined {
  return index.get(keyOf(depth, productSizeId));
}

/**
 * 既定マスタを作る。
 *
 * 1レーンあたりの収容本数を「商品サイズの1ラックあたり本数 × 深さ」とする
 * 線形モデル。実測値がある場合はこの表を上書きして使う。
 */
export function createDefaultCapacityTable(
  sizes: readonly ProductSize[],
  depths: readonly number[] = LANE_DEPTHS,
): LaneCapacityEntry[] {
  const entries: LaneCapacityEntry[] = [];
  for (const size of sizes) {
    const perRack = Math.max(1, Math.floor(size.unitsPerRack));
    for (const depth of depths) {
      entries.push({ depth, productSizeId: size.id, unitsPerLane: perRack * depth });
    }
  }
  return entries;
}

/** マスタの検証。UI のバリデーション用。 */
export function validateCapacityTable(entries: readonly LaneCapacityEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.depth) || entry.depth < 1) {
      errors.push(`深さは1以上の整数にしてください (${entry.depth})`);
    }
    if (!Number.isInteger(entry.unitsPerLane) || entry.unitsPerLane < 1) {
      errors.push(`収容本数は1以上の整数にしてください (深さ${entry.depth})`);
    }
    const key = keyOf(entry.depth, entry.productSizeId);
    if (seen.has(key)) errors.push(`深さ${entry.depth}のサイズが重複しています`);
    seen.add(key);
  }
  return errors;
}
