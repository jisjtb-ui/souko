import { pathLength } from '../geometry/index.js';
import { NavGrid } from './navGrid.js';
import type { Path, Vec2 } from '../domain/types.js';

/** 最小ヒープ (f値順)。A* のオープンリスト用。 */
class MinHeap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.keys[l]! < this.keys[smallest]!) smallest = l;
        if (r < this.items.length && this.keys[r]! < this.keys[smallest]!) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}

const SQRT2 = Math.SQRT2;

/** 8方向移動のオフセット [dx, dy, 距離係数] */
const NEIGHBORS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

export interface FindPathOptions {
  /** 経路を直線化する (通路内での不自然なジグザグを除去) */
  smooth?: boolean;
  /** 開始/終了地点が障害物内だった場合に近傍の通行可能セルへ寄せる距離 (m) */
  snapRadiusM?: number;
}

export interface PathResult extends Path {
  found: boolean;
  /** 目的地に到達できず、最も近い到達点で打ち切った場合 true */
  partial?: boolean;
}

/**
 * A* による経路探索。
 *
 * オクタイル距離をヒューリスティックに使い、斜め移動時の角抜け
 * (壁の角をすり抜ける動き) を禁止する。セルコストにより歩行者エリアを避ける。
 */
export function findPath(
  grid: NavGrid,
  from: Vec2,
  to: Vec2,
  options: FindPathOptions = {},
): PathResult {
  const snapRadius = options.snapRadiusM ?? 6;
  const startCell = grid.nearestFreeCell(from, snapRadius);
  const goalCell = grid.nearestFreeCell(to, snapRadius);

  if (!startCell || !goalCell) {
    return { found: false, points: [], lengthM: 0 };
  }

  const total = grid.cols * grid.rows;
  const gScore = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const startIdx = grid.index(startCell.cx, startCell.cy);
  const goalIdx = grid.index(goalCell.cx, goalCell.cy);
  const heuristic = (idx: number): number => {
    const cx = idx % grid.cols;
    const cy = (idx - cx) / grid.cols;
    const dx = Math.abs(cx - goalCell.cx);
    const dy = Math.abs(cy - goalCell.cy);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  };

  gScore[startIdx] = 0;
  const open = new MinHeap();
  open.push(startIdx, heuristic(startIdx));

  let expanded = 0;
  let bestIdx = startIdx;
  let bestH = heuristic(startIdx);
  let reached = false;

  while (open.size > 0) {
    const current = open.pop()!;
    if (closed[current]) continue;
    closed[current] = 1;
    expanded++;

    if (current === goalIdx) {
      reached = true;
      break;
    }

    const h = heuristic(current);
    if (h < bestH) {
      bestH = h;
      bestIdx = current;
    }

    const cx = current % grid.cols;
    const cy = (current - cx) / grid.cols;

    for (const [dx, dy, step] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const nCost = grid.costAt(nx, ny);
      if (!Number.isFinite(nCost)) continue;

      // 斜め移動時の角抜け防止: 両隣が塞がっていたら通れない
      if (dx !== 0 && dy !== 0) {
        if (grid.isBlocked(cx + dx, cy) || grid.isBlocked(cx, cy + dy)) continue;
      }

      const nIdx = grid.index(nx, ny);
      if (closed[nIdx]) continue;
      const tentative = gScore[current]! + step * nCost;
      if (tentative < gScore[nIdx]!) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = current;
        open.push(nIdx, tentative + heuristic(nIdx));
      }
    }
  }

  const endIdx = reached ? goalIdx : bestIdx;
  if (!reached && endIdx === startIdx) {
    return { found: false, points: [], lengthM: 0, expandedNodes: expanded };
  }

  // 経路復元
  const cells: number[] = [];
  for (let idx = endIdx; idx !== -1; idx = cameFrom[idx]!) {
    cells.push(idx);
    if (idx === startIdx) break;
  }
  cells.reverse();

  let points: Vec2[] = cells.map((idx) => {
    const cx = idx % grid.cols;
    const cy = (idx - cx) / grid.cols;
    return grid.cellToWorld(cx, cy);
  });

  // 実際の始点/終点をつなぐ (セル中心ではなく指定座標を使う)
  if (grid.hasLineOfSight(from, points[0]!)) points[0] = { ...from };
  else points.unshift({ ...from });
  if (reached) {
    const last = points[points.length - 1]!;
    if (grid.hasLineOfSight(last, to)) points[points.length - 1] = { ...to };
    else points.push({ ...to });
  }

  if (options.smooth !== false) {
    points = smoothPath(grid, points);
  }

  return {
    found: reached,
    partial: !reached,
    points,
    lengthM: pathLength(points),
    expandedNodes: expanded,
  };
}

/**
 * 見通し線 (line of sight) による経路の直線化。
 * グリッド由来の階段状の動きを、通路に沿った自然な直線移動に変換する。
 */
export function smoothPath(grid: NavGrid, points: readonly Vec2[]): Vec2[] {
  if (points.length <= 2) return [...points];
  const out: Vec2[] = [points[0]!];
  let anchor = 0;

  for (let i = 2; i < points.length; i++) {
    if (!grid.hasLineOfSight(points[anchor]!, points[i]!)) {
      out.push(points[i - 1]!);
      anchor = i - 1;
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}
