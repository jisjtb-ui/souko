import type { ID } from '../domain/ids.js';
import { buildCapacityIndex, capacityOf, LANE_DEPTHS } from './laneCapacity.js';
import type { LaneCapacityEntry, LaneCapacityIndex } from './laneCapacity.js';

/* ============================================================================
 * 死にポジション分析
 * ----------------------------------------------------------------------------
 * 「死にポジション」= レーンを1本使うと決めた時点で確保されるが、
 * 在庫が入らずに空いたままになる本数。
 *
 *   必要列数       = ceil(在庫本数 / 1レーンの収容本数)
 *   死にポジション = 必要列数 × 収容本数 − 在庫本数
 *
 * 計算はすべて純関数。既存の移動距離評価・ヒートマップ・出荷口機能には
 * 一切依存せず、依存もさせない。
 * ========================================================================== */

/** 必要列数 = ceil(在庫本数 / 収容本数)。 */
export function requiredLanes(units: number, unitsPerLane: number): number {
  if (unitsPerLane <= 0 || units <= 0) return 0;
  return Math.ceil(units / unitsPerLane);
}

/** 死にポジション本数 = 必要列数 × 収容本数 − 在庫本数。 */
export function deadUnitsOf(units: number, unitsPerLane: number): number {
  const lanes = requiredLanes(units, unitsPerLane);
  if (lanes === 0) return 0;
  return lanes * unitsPerLane - units;
}

/* ------------------------------------------------------------------- 入力 */

/** 物理レーン (保管ラックの1列を奥行き方向に見たもの)。 */
export interface Lane {
  id: ID;
  /** 表示名 (例: "A-01") */
  label: string;
  /** 奥行きレーン数 */
  depth: number;
  /** グルーピング用の見出し (例: ラック名)。表示にのみ使う */
  groupLabel?: string;
}

/** 製造年週ごとの在庫内訳。 */
export interface StockCohort {
  /** 製造年週 ("2024-W12")。未設定なら年週不明として1つの塊に扱う */
  yearWeek?: string;
  units: number;
}

/** サイズ別のピーク在庫。 */
export interface DeadPositionStock {
  productSizeId: ID;
  /** ピーク在庫本数。cohorts がある場合はその合計と一致させる */
  peakUnits: number;
  /** 製造年週別の内訳。省略時は peakUnits を単一の塊として扱う */
  cohorts?: StockCohort[];
}

/** レーンへの割り当て (1レーン1サイズ)。 */
export interface LaneAssignment {
  laneId: ID;
  productSizeId: ID;
  units: number;
  yearWeek?: string;
}

export interface DeadPositionInput {
  lanes: Lane[];
  /** 現状の割り当て。ここに無いレーンは空レーン */
  current: LaneAssignment[];
  /** ピーク在庫 */
  stock: DeadPositionStock[];
  /** 深さ×サイズ 収容本数マスタ */
  capacity: LaneCapacityEntry[];
}

/* ------------------------------------------------------------------- 出力 */

export interface EvaluatedLane {
  laneId: ID;
  label: string;
  depth: number;
  groupLabel?: string;
  productSizeId?: ID;
  yearWeek?: string;
  /** 実在庫本数 */
  units: number;
  /** そのレーンの収容本数 (空レーンは深さ基準で引けないため 0) */
  capacityUnits: number;
  /** 死にポジション本数 (収容本数 − 在庫本数、0未満にはしない) */
  deadUnits: number;
  /** 収容本数を超えた分 */
  overflowUnits: number;
  empty: boolean;
}

/** 画面に出す7つの数値。 */
export interface DeadPositionMetrics {
  /** 1. 総在庫本数 */
  totalUnits: number;
  /** 2. 使用レーン数 */
  usedLanes: number;
  /** 3. 使用レーンの総収容能力 */
  capacityUnits: number;
  /** 4. 死にポジション本数 */
  deadUnits: number;
  /** 5. 死にポジション率 (0..1) = 死にポジション本数 / 総収容能力 */
  deadRate: number;
  /** 6. 完全空きレーン数 */
  emptyLanes: number;
  /** 7. 収容しきれなかった本数 */
  overflowUnits: number;
}

export interface DepthSummary {
  depth: number;
  lanes: number;
  usedLanes: number;
  emptyLanes: number;
  units: number;
  capacityUnits: number;
  deadUnits: number;
}

export interface SizeSummary {
  productSizeId: ID;
  units: number;
  lanes: number;
  capacityUnits: number;
  deadUnits: number;
  overflowUnits: number;
}

export interface AllocationView {
  lanes: EvaluatedLane[];
  metrics: DeadPositionMetrics;
  byDepth: DepthSummary[];
  bySize: SizeSummary[];
}

/** 貪欲法の試行順。説明できる範囲の単純な並べ替えのみ。 */
export type AllocationOrder = 'units-desc' | 'units-asc' | 'lanes-desc' | 'size-id';

export const ALLOCATION_ORDERS: readonly AllocationOrder[] = [
  'units-desc',
  'units-asc',
  'lanes-desc',
  'size-id',
];

export const ALLOCATION_ORDER_LABELS: Record<AllocationOrder, string> = {
  'units-desc': '在庫の多い順',
  'units-asc': '在庫の少ない順',
  'lanes-desc': '必要レーン数の多い順',
  'size-id': 'サイズ順',
};

export interface AllocationAttempt {
  order: AllocationOrder;
  deadUnits: number;
  overflowUnits: number;
  usedLanes: number;
  emptyLanes: number;
  /** 採用されたか */
  selected: boolean;
}

export interface UnplacedStock {
  productSizeId: ID;
  yearWeek?: string;
  units: number;
  reason: string;
}

export interface DeadPositionResult {
  current: AllocationView;
  proposal: AllocationView;
  /** 改善案 − 現状。マイナスなら改善 */
  delta: {
    deadUnits: number;
    deadRate: number;
    usedLanes: number;
    emptyLanes: number;
    overflowUnits: number;
  };
  /** 採用した並び順 */
  strategy: AllocationOrder;
  /** 全試行の結果 (説明用) */
  attempts: AllocationAttempt[];
  /** 改善案で新たに空になったレーン */
  newlyEmptyLaneIds: ID[];
  /** 置き切れなかった在庫 */
  unplaced: UnplacedStock[];
  warnings: string[];
}

/* --------------------------------------------------------------- 評価 */

function emptyMetrics(): DeadPositionMetrics {
  return {
    totalUnits: 0,
    usedLanes: 0,
    capacityUnits: 0,
    deadUnits: 0,
    deadRate: 0,
    emptyLanes: 0,
    overflowUnits: 0,
  };
}

/**
 * レーンへの割り当てを評価する。
 * 空レーンは収容本数を 0 として扱い、能力にも死にポジションにも数えない
 * (使っていないレーンは「死にポジション」ではなく「完全空きレーン」)。
 */
export function evaluateAllocation(
  lanes: readonly Lane[],
  assignments: readonly LaneAssignment[],
  capacityIndex: LaneCapacityIndex,
): AllocationView {
  const byLane = new Map<ID, LaneAssignment>();
  for (const a of assignments) {
    if (a.units <= 0) continue;
    byLane.set(a.laneId, a);
  }

  const evaluated: EvaluatedLane[] = [];
  const metrics = emptyMetrics();
  const depthMap = new Map<number, DepthSummary>();
  const sizeMap = new Map<ID, SizeSummary>();

  for (const lane of lanes) {
    const assignment = byLane.get(lane.id);
    const depthSummary = depthMap.get(lane.depth) ?? {
      depth: lane.depth,
      lanes: 0,
      usedLanes: 0,
      emptyLanes: 0,
      units: 0,
      capacityUnits: 0,
      deadUnits: 0,
    };
    depthSummary.lanes += 1;

    if (!assignment) {
      evaluated.push({
        laneId: lane.id,
        label: lane.label,
        depth: lane.depth,
        ...(lane.groupLabel !== undefined ? { groupLabel: lane.groupLabel } : {}),
        units: 0,
        capacityUnits: 0,
        deadUnits: 0,
        overflowUnits: 0,
        empty: true,
      });
      metrics.emptyLanes += 1;
      depthSummary.emptyLanes += 1;
      depthMap.set(lane.depth, depthSummary);
      continue;
    }

    const cap = capacityOf(capacityIndex, lane.depth, assignment.productSizeId) ?? 0;
    const units = assignment.units;
    const dead = Math.max(0, cap - units);
    const overflow = Math.max(0, units - cap);

    evaluated.push({
      laneId: lane.id,
      label: lane.label,
      depth: lane.depth,
      ...(lane.groupLabel !== undefined ? { groupLabel: lane.groupLabel } : {}),
      productSizeId: assignment.productSizeId,
      ...(assignment.yearWeek !== undefined ? { yearWeek: assignment.yearWeek } : {}),
      units,
      capacityUnits: cap,
      deadUnits: dead,
      overflowUnits: overflow,
      empty: false,
    });

    metrics.totalUnits += units;
    metrics.usedLanes += 1;
    metrics.capacityUnits += cap;
    metrics.deadUnits += dead;
    metrics.overflowUnits += overflow;

    depthSummary.usedLanes += 1;
    depthSummary.units += units;
    depthSummary.capacityUnits += cap;
    depthSummary.deadUnits += dead;
    depthMap.set(lane.depth, depthSummary);

    const sizeSummary = sizeMap.get(assignment.productSizeId) ?? {
      productSizeId: assignment.productSizeId,
      units: 0,
      lanes: 0,
      capacityUnits: 0,
      deadUnits: 0,
      overflowUnits: 0,
    };
    sizeSummary.units += units;
    sizeSummary.lanes += 1;
    sizeSummary.capacityUnits += cap;
    sizeSummary.deadUnits += dead;
    sizeSummary.overflowUnits += overflow;
    sizeMap.set(assignment.productSizeId, sizeSummary);
  }

  metrics.deadRate = metrics.capacityUnits > 0 ? metrics.deadUnits / metrics.capacityUnits : 0;

  const byDepth = [...depthMap.values()].sort((a, b) => a.depth - b.depth);
  const bySize = [...sizeMap.values()].sort((a, b) => b.units - a.units);
  return { lanes: evaluated, metrics, byDepth, bySize };
}

/* --------------------------------------------------------------- 貪欲法 */

interface WorkItem {
  productSizeId: ID;
  yearWeek?: string;
  units: number;
}

/**
 * 在庫を「サイズ × 製造年週」の塊に分解する。
 *
 * 1レーンに複数の年週を混ぜると古い製造分が奥に埋まるため、
 * 年週ごとに別のレーンへ割り当てる。
 */
function toWorkItems(stock: readonly DeadPositionStock[]): WorkItem[] {
  const items: WorkItem[] = [];
  for (const entry of stock) {
    const cohorts =
      entry.cohorts && entry.cohorts.length > 0
        ? entry.cohorts
        : [{ units: entry.peakUnits } as StockCohort];
    for (const cohort of cohorts) {
      if (cohort.units <= 0) continue;
      items.push({
        productSizeId: entry.productSizeId,
        ...(cohort.yearWeek !== undefined ? { yearWeek: cohort.yearWeek } : {}),
        units: Math.ceil(cohort.units),
      });
    }
  }
  return items;
}

function sortWorkItems(
  items: readonly WorkItem[],
  order: AllocationOrder,
  capacityIndex: LaneCapacityIndex,
  depths: readonly number[],
): WorkItem[] {
  const list = [...items];
  // 年週は常に古い順に処理する (古い在庫から手前の扱いやすいレーンに入れる)
  const byYearWeek = (a: WorkItem, b: WorkItem): number =>
    (a.yearWeek ?? '').localeCompare(b.yearWeek ?? '');

  const maxCapacity = (item: WorkItem): number => {
    let best = 0;
    for (const depth of depths) {
      const cap = capacityOf(capacityIndex, depth, item.productSizeId);
      if (cap !== undefined && cap > best) best = cap;
    }
    return best;
  };

  switch (order) {
    case 'units-desc':
      list.sort((a, b) => b.units - a.units || byYearWeek(a, b));
      break;
    case 'units-asc':
      list.sort((a, b) => a.units - b.units || byYearWeek(a, b));
      break;
    case 'lanes-desc':
      list.sort((a, b) => {
        const la = requiredLanes(a.units, maxCapacity(a) || 1);
        const lb = requiredLanes(b.units, maxCapacity(b) || 1);
        return lb - la || b.units - a.units || byYearWeek(a, b);
      });
      break;
    case 'size-id':
      list.sort(
        (a, b) => a.productSizeId.localeCompare(b.productSizeId) || byYearWeek(a, b),
      );
      break;
  }
  return list;
}

interface DepthPlan {
  depth: number;
  unitsPerLane: number;
  lanes: number;
  deadUnits: number;
}

/**
 * 1つの塊について、使える9種類の深さを総当たりして最良の深さを選ぶ。
 * 最良 = 死にポジションが最小、同値ならレーン数が少ない、さらに同値なら浅い深さ。
 */
function bestDepthPlan(
  item: WorkItem,
  freeByDepth: ReadonlyMap<number, Lane[]>,
  capacityIndex: LaneCapacityIndex,
  depths: readonly number[],
): DepthPlan | undefined {
  let best: DepthPlan | undefined;
  for (const depth of depths) {
    const unitsPerLane = capacityOf(capacityIndex, depth, item.productSizeId);
    if (unitsPerLane === undefined || unitsPerLane <= 0) continue;
    const need = requiredLanes(item.units, unitsPerLane);
    const available = freeByDepth.get(depth)?.length ?? 0;
    if (need === 0 || available < need) continue;
    const dead = need * unitsPerLane - item.units;
    const plan: DepthPlan = { depth, unitsPerLane, lanes: need, deadUnits: dead };
    if (
      !best ||
      plan.deadUnits < best.deadUnits ||
      (plan.deadUnits === best.deadUnits && plan.lanes < best.lanes) ||
      (plan.deadUnits === best.deadUnits && plan.lanes === best.lanes && plan.depth < best.depth)
    ) {
      best = plan;
    }
  }
  return best;
}

interface AllocationRun {
  order: AllocationOrder;
  assignments: LaneAssignment[];
  unplaced: UnplacedStock[];
}

/**
 * 貪欲法で割り当てる。
 *
 * 1. 在庫を「サイズ×製造年週」の塊に分け、指定の順序で並べる
 * 2. 塊ごとに9種類の深さを総当たりし、死にポジションが最小の深さを選ぶ
 * 3. 単一の深さで足りない場合のみ、収容本数の大きい順にレーンを継ぎ足す
 *
 * 焼きなましや遺伝的アルゴリズムは使わない (説明できることを優先)。
 */
function allocateOnce(
  lanes: readonly Lane[],
  items: readonly WorkItem[],
  capacityIndex: LaneCapacityIndex,
  order: AllocationOrder,
  depths: readonly number[],
): AllocationRun {
  // 深さごとの空きレーン。ラベル順に安定させて結果を再現可能にする
  const freeByDepth = new Map<number, Lane[]>();
  for (const lane of lanes) {
    const list = freeByDepth.get(lane.depth) ?? [];
    list.push(lane);
    freeByDepth.set(lane.depth, list);
  }
  for (const list of freeByDepth.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label, 'ja') || a.id.localeCompare(b.id));
  }

  const assignments: LaneAssignment[] = [];
  const unplaced: UnplacedStock[] = [];

  const take = (depth: number, count: number): Lane[] => {
    const list = freeByDepth.get(depth);
    if (!list) return [];
    return list.splice(0, count);
  };

  const place = (item: WorkItem, lane: Lane, units: number): void => {
    assignments.push({
      laneId: lane.id,
      productSizeId: item.productSizeId,
      units,
      ...(item.yearWeek !== undefined ? { yearWeek: item.yearWeek } : {}),
    });
  };

  for (const item of sortWorkItems(items, order, capacityIndex, depths)) {
    const plan = bestDepthPlan(item, freeByDepth, capacityIndex, depths);

    if (plan) {
      const taken = take(plan.depth, plan.lanes);
      let remaining = item.units;
      for (const lane of taken) {
        const units = Math.min(plan.unitsPerLane, remaining);
        place(item, lane, units);
        remaining -= units;
      }
      continue;
    }

    // 単一の深さでは足りない。収容本数の大きい深さから継ぎ足す
    let remaining = item.units;
    const ranked = [...depths]
      .map((depth) => ({
        depth,
        unitsPerLane: capacityOf(capacityIndex, depth, item.productSizeId) ?? 0,
      }))
      .filter((d) => d.unitsPerLane > 0)
      .sort((a, b) => b.unitsPerLane - a.unitsPerLane || a.depth - b.depth);

    for (const { depth, unitsPerLane } of ranked) {
      while (remaining > 0) {
        const taken = take(depth, 1);
        if (taken.length === 0) break;
        const lane = taken[0]!;
        const units = Math.min(unitsPerLane, remaining);
        place(item, lane, units);
        remaining -= units;
      }
      if (remaining <= 0) break;
    }

    if (remaining > 0) {
      unplaced.push({
        productSizeId: item.productSizeId,
        ...(item.yearWeek !== undefined ? { yearWeek: item.yearWeek } : {}),
        units: remaining,
        reason: ranked.length === 0 ? '収容本数マスタに該当する深さがありません' : '空きレーンが足りません',
      });
    }
  }

  return { order, assignments, unplaced };
}

/**
 * 深さを考慮せずレーン順に手前から詰める割り当て。
 *
 * 「空いているところに入れる」という現行の運用ルールを再現したもので、
 * 改善案と比較するためのベースラインとして使う。
 */
export function allocateDepthUnaware(
  lanes: readonly Lane[],
  stock: readonly DeadPositionStock[],
  capacity: readonly LaneCapacityEntry[],
): LaneAssignment[] {
  const capacityIndex = buildCapacityIndex(capacity);
  const pool = [...lanes].sort((a, b) => a.label.localeCompare(b.label, 'ja') || a.id.localeCompare(b.id));
  const items = toWorkItems(stock).sort((a, b) =>
    (a.yearWeek ?? '').localeCompare(b.yearWeek ?? '') ||
    a.productSizeId.localeCompare(b.productSizeId),
  );

  const assignments: LaneAssignment[] = [];
  let cursor = 0;

  for (const item of items) {
    let remaining = item.units;
    while (remaining > 0 && cursor < pool.length) {
      const lane = pool[cursor]!;
      cursor += 1;
      const cap = capacityOf(capacityIndex, lane.depth, item.productSizeId);
      if (cap === undefined || cap <= 0) continue;
      const units = Math.min(cap, remaining);
      assignments.push({
        laneId: lane.id,
        productSizeId: item.productSizeId,
        units,
        ...(item.yearWeek !== undefined ? { yearWeek: item.yearWeek } : {}),
      });
      remaining -= units;
    }
  }

  return assignments;
}

/* --------------------------------------------------------------- 本体 */

export interface AnalyzeOptions {
  /** 試す並び順。既定は4通り */
  orders?: readonly AllocationOrder[];
  /** 総当たりする深さ。既定は LANE_DEPTHS */
  depths?: readonly number[];
}

/**
 * 死にポジション分析。
 *
 * 現状の割り当てと、貪欲法で組み直した改善案の両方を評価して返す。
 */
export function analyzeDeadPositions(
  input: DeadPositionInput,
  options: AnalyzeOptions = {},
): DeadPositionResult {
  const capacityIndex = buildCapacityIndex(input.capacity);
  const orders = options.orders ?? ALLOCATION_ORDERS;
  const warnings: string[] = [];

  // マスタに存在する深さだけを総当たり対象にする
  const laneDepths = new Set(input.lanes.map((lane) => lane.depth));
  const depths = (options.depths ?? LANE_DEPTHS).filter((depth) => laneDepths.has(depth));
  for (const depth of laneDepths) {
    if (!depths.includes(depth)) {
      warnings.push(`深さ${depth}のレーンは収容本数マスタの対象外のため、改善案では使いません`);
    }
  }

  const current = evaluateAllocation(input.lanes, input.current, capacityIndex);

  for (const entry of input.stock) {
    const cohortTotal = (entry.cohorts ?? []).reduce((sum, c) => sum + c.units, 0);
    if (entry.cohorts && entry.cohorts.length > 0 && cohortTotal !== entry.peakUnits) {
      warnings.push(
        `サイズ ${entry.productSizeId} のピーク在庫 ${entry.peakUnits} 本と製造年週別の合計 ${cohortTotal} 本が一致しません（年週別を採用します）`,
      );
    }
  }

  const items = toWorkItems(input.stock);

  interface Candidate {
    run: AllocationRun;
    view: AllocationView;
    /** 比較キー: 溢れ → 死にポジション → 空きレーン数(多い方が良い) の順で優先 */
    score: [number, number, number];
  }

  let best: Candidate | undefined;
  const attempts: AllocationAttempt[] = [];

  const isBetter = (a: Candidate['score'], b: Candidate['score']): boolean => {
    for (let i = 0; i < a.length; i++) {
      if (a[i]! !== b[i]!) return a[i]! < b[i]!;
    }
    return false;
  };

  for (const order of orders) {
    const run = allocateOnce(input.lanes, items, capacityIndex, order, depths);
    const view = evaluateAllocation(input.lanes, run.assignments, capacityIndex);
    const unplacedUnits = run.unplaced.reduce((sum, u) => sum + u.units, 0);
    const overflow = view.metrics.overflowUnits + unplacedUnits;

    attempts.push({
      order,
      deadUnits: view.metrics.deadUnits,
      overflowUnits: overflow,
      usedLanes: view.metrics.usedLanes,
      emptyLanes: view.metrics.emptyLanes,
      selected: false,
    });

    // 空きレーンは多いほど良いので符号を反転して「小さいほど良い」に揃える
    const score: Candidate['score'] = [overflow, view.metrics.deadUnits, -view.metrics.emptyLanes];
    if (!best || isBetter(score, best.score)) best = { run, view, score };
  }

  const bestRun = best?.run;
  const bestView = best?.view;

  const run = bestRun ?? { order: orders[0]!, assignments: [], unplaced: [] };
  const proposal = bestView ?? evaluateAllocation(input.lanes, [], capacityIndex);
  const selected = attempts.find((a) => a.order === run.order);
  if (selected) selected.selected = true;

  // 現状は使っていたが改善案では空になったレーン
  const usedBefore = new Set(current.lanes.filter((l) => !l.empty).map((l) => l.laneId));
  const newlyEmptyLaneIds = proposal.lanes
    .filter((l) => l.empty && usedBefore.has(l.laneId))
    .map((l) => l.laneId);

  const proposalOverflow =
    proposal.metrics.overflowUnits + run.unplaced.reduce((sum, u) => sum + u.units, 0);

  return {
    current,
    proposal,
    delta: {
      deadUnits: proposal.metrics.deadUnits - current.metrics.deadUnits,
      deadRate: proposal.metrics.deadRate - current.metrics.deadRate,
      usedLanes: proposal.metrics.usedLanes - current.metrics.usedLanes,
      emptyLanes: proposal.metrics.emptyLanes - current.metrics.emptyLanes,
      overflowUnits: proposalOverflow - current.metrics.overflowUnits,
    },
    strategy: run.order,
    attempts,
    newlyEmptyLaneIds,
    unplaced: run.unplaced,
    warnings,
  };
}
