import { PEDESTRIAN_COST_MULTIPLIER, getObjectSpec } from '../domain/objectSpecs.js';
import { rotatePoint } from '../geometry/index.js';
import { isForkliftObject, isRackObject } from '../domain/types.js';
import type { LayoutObject, Vec2, Warehouse } from '../domain/types.js';

export const BLOCKED = Number.POSITIVE_INFINITY;

export interface NavGridOptions {
  /** セルの一辺 (m) */
  cellM: number;
  /** 障害物を膨張させる距離 (m) — 車体半幅 + 安全マージン */
  clearanceM: number;
}

/**
 * 走行可能エリアのラスタ表現。
 *
 * - 壁 / 柱 / ラック / 立入禁止エリア -> 進入不可 (clearance 分だけ膨張)
 * - 歩行者エリア -> 進入可能だが通行コストを高くする
 * - 倉庫外 -> 進入不可
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellM: number;
  readonly clearanceM: number;
  /** セルごとの通行コスト倍率。BLOCKED は進入不可。 */
  readonly cost: Float64Array;

  constructor(cols: number, rows: number, cellM: number, clearanceM: number) {
    this.cols = cols;
    this.rows = rows;
    this.cellM = cellM;
    this.clearanceM = clearanceM;
    this.cost = new Float64Array(cols * rows).fill(1);
  }

  static fromLayout(
    warehouse: Pick<Warehouse, 'widthM' | 'depthM'>,
    objects: readonly LayoutObject[],
    options: NavGridOptions,
  ): NavGrid {
    const cellM = Math.max(0.05, options.cellM);
    const cols = Math.max(1, Math.ceil(warehouse.widthM / cellM));
    const rows = Math.max(1, Math.ceil(warehouse.depthM / cellM));
    const grid = new NavGrid(cols, rows, cellM, options.clearanceM);

    for (const obj of objects) {
      if (isForkliftObject(obj)) continue; // 車両は動的障害物として別扱い
      const spec = getObjectSpec(obj.kind);
      const traversable = isRackObject(obj)
        ? false
        : ((obj as { traversable?: boolean }).traversable ?? spec.traversable);

      if (!traversable) {
        grid.stampRect(obj, options.clearanceM, BLOCKED);
      } else if (obj.kind === 'pedestrian-area') {
        grid.stampRect(obj, 0, PEDESTRIAN_COST_MULTIPLIER);
      }
    }
    return grid;
  }

  index(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  costAt(cx: number, cy: number): number {
    if (!this.inBounds(cx, cy)) return BLOCKED;
    return this.cost[this.index(cx, cy)]!;
  }

  isBlocked(cx: number, cy: number): boolean {
    return !Number.isFinite(this.costAt(cx, cy));
  }

  worldToCell(p: Vec2): { cx: number; cy: number } {
    return { cx: Math.floor(p.x / this.cellM), cy: Math.floor(p.y / this.cellM) };
  }

  cellToWorld(cx: number, cy: number): Vec2 {
    return { x: (cx + 0.5) * this.cellM, y: (cy + 0.5) * this.cellM };
  }

  /**
   * 回転矩形をグリッドへ焼き込む。inflate 分だけ外側に広げる。
   * value が BLOCKED なら進入不可、それ以外なら「より高いコスト」を採用する。
   */
  stampRect(
    obj: Pick<LayoutObject, 'x' | 'y' | 'widthM' | 'depthM' | 'rotationDeg'>,
    inflateM: number,
    value: number,
  ): void {
    const reach = Math.hypot(obj.widthM, obj.depthM) + inflateM + this.cellM;
    const minCx = Math.max(0, Math.floor((obj.x - reach) / this.cellM));
    const maxCx = Math.min(this.cols - 1, Math.ceil((obj.x + reach) / this.cellM));
    const minCy = Math.max(0, Math.floor((obj.y - reach) / this.cellM));
    const maxCy = Math.min(this.rows - 1, Math.ceil((obj.y + reach) / this.cellM));

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const center = this.cellToWorld(cx, cy);
        const local = rotatePoint(
          { x: center.x - obj.x, y: center.y - obj.y },
          -obj.rotationDeg,
        );
        const inside =
          local.x >= -inflateM &&
          local.x <= obj.widthM + inflateM &&
          local.y >= -inflateM &&
          local.y <= obj.depthM + inflateM;
        if (!inside) continue;
        const i = this.index(cx, cy);
        const current = this.cost[i]!;
        if (!Number.isFinite(value)) {
          this.cost[i] = BLOCKED;
        } else if (Number.isFinite(current) && value > current) {
          this.cost[i] = value;
        }
      }
    }
  }

  /**
   * 指定座標が進入不可の場合に、最も近い通行可能セルを探す (BFS)。
   * ラック前の作業位置がラック内に食い込んでいる場合などに使う。
   */
  nearestFreeCell(p: Vec2, maxRadiusM = 6): { cx: number; cy: number } | undefined {
    const start = this.worldToCell(p);
    if (this.inBounds(start.cx, start.cy) && !this.isBlocked(start.cx, start.cy)) return start;

    const maxR = Math.ceil(maxRadiusM / this.cellM);
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = start.cx + dx;
          const cy = start.cy + dy;
          if (this.inBounds(cx, cy) && !this.isBlocked(cx, cy)) return { cx, cy };
        }
      }
    }
    return undefined;
  }

  /** 2点間に障害物がないか (経路平滑化で使用)。 */
  hasLineOfSight(a: Vec2, b: Vec2): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / (this.cellM * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const { cx, cy } = this.worldToCell({ x, y });
      if (this.isBlocked(cx, cy)) return false;
    }
    return true;
  }

  /** デバッグ/可視化用: 進入不可セルの矩形リスト。 */
  blockedCells(): { x: number; y: number; sizeM: number }[] {
    const out: { x: number; y: number; sizeM: number }[] = [];
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        if (this.isBlocked(cx, cy)) {
          out.push({ x: cx * this.cellM, y: cy * this.cellM, sizeM: this.cellM });
        }
      }
    }
    return out;
  }
}
