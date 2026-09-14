import { distance as euclidean } from '../geometry/index.js';
import { isRackObject } from '../domain/types.js';
import type { ID } from '../domain/ids.js';
import type {
  ProductSize,
  RackType,
  RackUnit,
  SlottingStrategyKey,
} from '../domain/logistics.js';
import type { LayoutObject, Location, RackObject, Vec2 } from '../domain/types.js';

/* ============================================================================
 * フリーロケーション (要件6)
 * ----------------------------------------------------------------------------
 * 固定ロケーションではなく、ルールに従って空きロケーションを探して格納する。
 *
 *   1. 商品サイズに適合するラックを検索
 *   2. 空き容量を確認
 *   3. 優先エリアを確認
 *   4. 出荷頻度を確認
 *   5. フォークリフトの移動距離を計算
 *   6. 最適なロケーションを選択
 *
 * 選択ルールは差し替え可能（SLOTTING_STRATEGIES に登録する）。
 * ========================================================================== */

export interface SlottingContext {
  /** 候補となる全ロケーション */
  locations: readonly Location[];
  /**
   * 候補を絞り込むためのID集合（任意）。
   * 呼び出し側が「空きロケーション」の索引を持っている場合に渡すと、
   * 全ロケーションを走査せずに済む（判定条件は同じなので結果は変わらない）。
   */
  candidateIds?: Iterable<ID>;
  /** candidateIds を使う場合に必要なID->ロケーションの索引 */
  locationById?: ReadonlyMap<ID, Location>;
  /** ロケーションID -> 格納中の可搬ラック（在庫の有無だけを見るため値は任意） */
  occupancy: ReadonlyMap<ID, unknown>;
  /** 作業割当済みで予約されているロケーション */
  reserved: ReadonlySet<ID>;
  /** ラックID -> 保管ラック構造 */
  racksById: ReadonlyMap<ID, RackObject>;
  /** 格納する商品サイズ */
  size: ProductSize;
  /** 使用する可搬ラックの種別 */
  rackType: RackType;
  /** 搬入元（倉入れ口）の座標 */
  fromPoint: Vec2;
  /** 出荷ゲートの座標（出荷頻度による最適化に使う） */
  outboundPoints: readonly Vec2[];
  /** 距離計算。既定は直線距離。A*距離を注入することもできる。 */
  distanceFn?: (a: Vec2, b: Vec2) => number;
  /** エリアごとの在庫数（偏りの平準化に使う） */
  inventoryByArea?: ReadonlyMap<ID, number>;
}

export interface SlottingCandidate {
  location: Location;
  /** 小さいほど良い */
  score: number;
  /** 選定理由（ログ表示用） */
  reasons: string[];
  distanceFromGateM: number;
  distanceToShipM: number;
}

export type SlottingStrategy = (ctx: SlottingContext) => SlottingCandidate | undefined;

/** ロケーションがそのラックを受け入れられるか（サイズ適合・空き容量）。 */
export function isLocationEligible(ctx: SlottingContext, location: Location): boolean {
  if (location.blocked) return false;
  if (ctx.occupancy.has(location.id)) return false; // 空き容量なし
  if (ctx.reserved.has(location.id)) return false; // 作業割当済み

  const rack = ctx.racksById.get(location.rackId);
  if (!rack) return false;

  // サイズ適合: 保管ラック構造が受け入れるラック種別
  const spec = rack.rack;
  if (spec.rackTypeId && spec.rackTypeId !== ctx.rackType.id) return false;
  if (!spec.rackTypeId && spec.rackCategory && spec.rackCategory !== ctx.rackType.category) return false;

  // ロケーションの収納可能数が足りているか
  if (location.capacity > 0 && location.capacity < ctx.rackType.maxUnits) return false;

  return true;
}

/** 優先保管エリアに一致するか。 */
export function matchesPreferredArea(ctx: SlottingContext, location: Location): boolean {
  const tag = ctx.size.preferredAreaTag;
  if (!tag) return false;
  const rack = ctx.racksById.get(location.rackId);
  if (!rack) return false;
  return rack.rack.areaTag === tag || rack.rack.category === tag || location.category === tag;
}

/**
 * 評価対象のロケーションを列挙する。
 * candidateIds が渡されていればそれを使い、無ければ全ロケーションを走査する。
 * どちらでも isLocationEligible による判定は同じなので、選ばれる結果は変わらない。
 */
function* candidatesOf(ctx: SlottingContext): Generator<Location> {
  if (ctx.candidateIds && ctx.locationById) {
    for (const id of ctx.candidateIds) {
      const location = ctx.locationById.get(id);
      if (location && isLocationEligible(ctx, location)) yield location;
    }
    return;
  }
  for (const location of ctx.locations) {
    if (isLocationEligible(ctx, location)) yield location;
  }
}

function measure(
  ctx: SlottingContext,
  location: Location,
): { fromGate: number; toShip: number } {
  const dist = ctx.distanceFn ?? euclidean;
  const point = { x: location.approachX, y: location.approachY };
  const fromGate = dist(ctx.fromPoint, point);
  const toShip =
    ctx.outboundPoints.length === 0
      ? 0
      : Math.min(...ctx.outboundPoints.map((p) => dist(point, p)));
  return { fromGate, toShip };
}

/** 出荷頻度の重み（高回転ほど出荷口に近づけたい）。 */
function turnoverWeight(size: ProductSize): number {
  switch (size.turnover) {
    case 'high':
      return 1;
    case 'medium':
      return 0.5;
    default:
      return 0.15;
  }
}

/** 搬入距離が最短のロケーションを選ぶ。 */
export const nearestStrategy: SlottingStrategy = (ctx) => {
  let best: SlottingCandidate | undefined;
  for (const location of candidatesOf(ctx)) {
    const { fromGate, toShip } = measure(ctx, location);
    if (!best || fromGate < best.score) {
      best = {
        location,
        score: fromGate,
        reasons: [`搬入距離 ${fromGate.toFixed(1)}m`],
        distanceFromGateM: fromGate,
        distanceToShipM: toShip,
      };
    }
  }
  return best;
};

/** 出荷頻度を優先する（高回転商品を出荷口の近くへ）。 */
export const turnoverStrategy: SlottingStrategy = (ctx) => {
  const weight = turnoverWeight(ctx.size);
  let best: SlottingCandidate | undefined;
  for (const location of candidatesOf(ctx)) {
    const { fromGate, toShip } = measure(ctx, location);
    // 高回転ほど「出荷口までの距離」を重く見る
    const score = toShip * weight + fromGate * (1 - weight) * 0.5;
    if (!best || score < best.score) {
      best = {
        location,
        score,
        reasons: [
          `出荷頻度 ${ctx.size.turnover === 'high' ? '高回転' : ctx.size.turnover === 'medium' ? '中回転' : '低回転'}`,
          `出荷口まで ${toShip.toFixed(1)}m`,
        ],
        distanceFromGateM: fromGate,
        distanceToShipM: toShip,
      };
    }
  }
  return best;
};

/** 優先保管エリアを最優先し、その中で搬入距離が短い場所を選ぶ。 */
export const preferredZoneStrategy: SlottingStrategy = (ctx) => {
  let best: SlottingCandidate | undefined;
  for (const location of candidatesOf(ctx)) {
    const { fromGate, toShip } = measure(ctx, location);
    const preferred = matchesPreferredArea(ctx, location);
    const score = fromGate + (preferred ? 0 : 10_000);
    if (!best || score < best.score) {
      best = {
        location,
        score,
        reasons: preferred
          ? [`優先エリア「${ctx.size.preferredAreaTag}」`, `搬入距離 ${fromGate.toFixed(1)}m`]
          : [`優先エリアに空きなし`, `搬入距離 ${fromGate.toFixed(1)}m`],
        distanceFromGateM: fromGate,
        distanceToShipM: toShip,
      };
    }
  }
  return best;
};

/**
 * 既定の総合評価。
 * 優先エリア > 出荷頻度 > 搬送距離 > エリアの在庫偏り の順に重みを置く。
 */
export const balancedStrategy: SlottingStrategy = (ctx) => {
  const weight = turnoverWeight(ctx.size);
  let best: SlottingCandidate | undefined;

  for (const location of candidatesOf(ctx)) {
    const { fromGate, toShip } = measure(ctx, location);
    const preferred = matchesPreferredArea(ctx, location);
    const areaLoad = location.areaId ? (ctx.inventoryByArea?.get(location.areaId) ?? 0) : 0;

    const score =
      fromGate * 0.5 + // 搬入時の移動距離
      toShip * weight + // 出荷頻度（高回転ほど出荷口の近くへ）
      (preferred ? 0 : ctx.size.preferredAreaTag ? 40 : 0) + // 優先エリア
      areaLoad * 0.01; // エリアの在庫偏りを緩やかに平準化

    if (!best || score < best.score) {
      const reasons = [`搬入 ${fromGate.toFixed(1)}m`, `出荷口 ${toShip.toFixed(1)}m`];
      if (preferred) reasons.unshift(`優先エリア「${ctx.size.preferredAreaTag}」`);
      best = {
        location,
        score,
        reasons,
        distanceFromGateM: fromGate,
        distanceToShipM: toShip,
      };
    }
  }
  return best;
};

/** 選択ルールのレジストリ。将来ルールを追加・差し替えできる。 */
export const SLOTTING_STRATEGIES: Record<SlottingStrategyKey, SlottingStrategy> = {
  nearest: nearestStrategy,
  turnover: turnoverStrategy,
  'preferred-zone': preferredZoneStrategy,
  balanced: balancedStrategy,
};

export const SLOTTING_STRATEGY_LABEL: Record<SlottingStrategyKey, string> = {
  nearest: '最短距離',
  turnover: '出荷頻度優先',
  'preferred-zone': '優先エリア優先',
  balanced: '総合（既定）',
};

/** 空きロケーションを検索する。 */
export function findFreeLocation(
  ctx: SlottingContext,
  strategy: SlottingStrategyKey = 'balanced',
): SlottingCandidate | undefined {
  const fn = SLOTTING_STRATEGIES[strategy] ?? balancedStrategy;
  return fn(ctx);
}

/** レイアウトから保管ラック構造の索引を作る。 */
export function buildRackIndex(objects: readonly LayoutObject[]): Map<ID, RackObject> {
  return new Map(objects.filter(isRackObject).map((rack) => [rack.id, rack]));
}

/** 保管中のラックから、出庫対象を探す（先入れ先出し）。 */
export function findStoredRackForSize(
  occupancy: ReadonlyMap<ID, RackUnit>,
  productSizeId: ID,
  options: { minUnits?: number; excludeLocationIds?: ReadonlySet<ID> } = {},
): { locationId: ID; rack: RackUnit } | undefined {
  const minUnits = options.minUnits ?? 1;
  let best: { locationId: ID; rack: RackUnit } | undefined;
  for (const [locationId, rack] of occupancy) {
    if (rack.productSizeId !== productSizeId) continue;
    if (rack.currentUnits < minUnits) continue;
    if (options.excludeLocationIds?.has(locationId)) continue;
    // 先に入庫したものから出す (FIFO)
    if (!best || (rack.storedAtSec ?? 0) < (best.rack.storedAtSec ?? 0)) {
      best = { locationId, rack };
    }
  }
  return best;
}
