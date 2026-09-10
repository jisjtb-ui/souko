import { createId } from '../domain/ids.js';
import type {
  ProductSize,
  RackCategory,
  RackMixSetting,
  RackType,
  RackUnit,
  RackUnitStatus,
} from '../domain/logistics.js';
import type { ID } from '../domain/ids.js';

/* ============================================================================
 * 可搬ラック (RackUnit) の生成と状態管理
 * ----------------------------------------------------------------------------
 * RackUnit は「商品を積んで運ばれる実体」。ロケーションに格納され、
 * 出庫時に出荷ゲートへ運ばれ、空になると空ラック置き場へ運んで積み重ねる。
 * ========================================================================== */

export interface CreateRackUnitInput {
  rackType: RackType;
  productSizeId?: ID;
  /** 積載本数（未指定なら空ラック） */
  units?: number;
  x?: number;
  y?: number;
  status?: RackUnitStatus;
}

export function createRackUnit(input: CreateRackUnitInput): RackUnit {
  const capacity = input.rackType.maxUnits;
  const units = Math.min(input.units ?? 0, capacity);
  return {
    id: createId('ru'),
    rackTypeId: input.rackType.id,
    category: input.rackType.category,
    ...(input.productSizeId ? { productSizeId: input.productSizeId } : {}),
    currentUnits: units,
    capacityUnits: capacity,
    status: input.status ?? (units === 0 ? 'empty' : units >= capacity ? 'full' : 'stored'),
    x: input.x ?? 0,
    y: input.y ?? 0,
  };
}

/** 積載率 (0-1)。 */
export function fillRatio(rack: RackUnit): number {
  return rack.capacityUnits === 0 ? 0 : rack.currentUnits / rack.capacityUnits;
}

/**
 * 積載本数から状態を導出する。
 * 搬送中・積み重ね済みなど、本数と無関係な状態はそのまま維持する。
 */
export function deriveRackStatus(rack: RackUnit): RackUnitStatus {
  if (rack.status === 'carrying' || rack.status === 'stacked' || rack.status === 'waiting') {
    return rack.status;
  }
  if (rack.currentUnits <= 0) return 'empty';
  if (rack.currentUnits >= rack.capacityUnits) return 'full';
  return 'stored';
}

/** ラックから商品を取り出す。取り出せた本数と更新後のラックを返す。 */
export function removeUnits(rack: RackUnit, requested: number): { rack: RackUnit; removed: number } {
  const removed = Math.max(0, Math.min(requested, rack.currentUnits));
  const next: RackUnit = { ...rack, currentUnits: rack.currentUnits - removed };
  return { rack: { ...next, status: deriveRackStatus(next) }, removed };
}

/** ラックへ商品を積む。積めた本数と更新後のラックを返す。 */
export function addUnits(
  rack: RackUnit,
  requested: number,
  productSizeId?: ID,
): { rack: RackUnit; added: number } {
  const space = Math.max(0, rack.capacityUnits - rack.currentUnits);
  const added = Math.max(0, Math.min(requested, space));
  const next: RackUnit = {
    ...rack,
    currentUnits: rack.currentUnits + added,
    ...(productSizeId ? { productSizeId } : {}),
  };
  return { rack: { ...next, status: deriveRackStatus(next) }, added };
}

/** 空ラックかどうか。 */
export function isEmptyRack(rack: RackUnit): boolean {
  return rack.currentUnits <= 0;
}

/** 商品サイズが使用できるラック種別を返す。 */
export function rackTypesForSize(
  size: Pick<ProductSize, 'rackCategory'>,
  rackTypes: readonly RackType[],
): RackType[] {
  return rackTypes.filter((type) => type.category === size.rackCategory);
}

/**
 * 使用ラックサイズ割合から、次に使うラック種別を決める。
 *
 * 累積割合と「これまでの使用実績」を比べ、計画割合から最も乖離している側を選ぶ。
 * 乱数ではなく実績ベースなので、少数の生成でも割合どおりに収束する。
 */
export function pickRackCategoryByMix(
  mix: RackMixSetting,
  used: { small: number; large: number },
): RackCategory {
  const total = used.small + used.large;
  if (total === 0) return mix.smallPct >= mix.largePct ? 'small' : 'large';
  const smallShare = (used.small / total) * 100;
  const smallDeficit = mix.smallPct - smallShare;
  const largeShare = (used.large / total) * 100;
  const largeDeficit = mix.largePct - largeShare;
  if (mix.smallPct <= 0) return 'large';
  if (mix.largePct <= 0) return 'small';
  return smallDeficit >= largeDeficit ? 'small' : 'large';
}

/** 指定カテゴリのラック種別を1つ選ぶ。 */
export function findRackType(
  rackTypes: readonly RackType[],
  category: RackCategory,
): RackType | undefined {
  return rackTypes.find((type) => type.category === category);
}

/** ラック状態の日本語ラベル（UI・ログ用）。 */
export const RACK_STATUS_LABEL: Record<RackUnitStatus, string> = {
  empty: '空',
  loading: '入庫中',
  stored: '使用中',
  full: '満載',
  unloading: '出庫中',
  carrying: '搬送中',
  waiting: '待機',
  stacked: '積み重ね済み',
};
