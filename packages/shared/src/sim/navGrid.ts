import { PEDESTRIAN_COST_MULTIPLIER, getObjectSpec } from '../domain/objectSpecs.js';
import { rotatePoint } from '../geometry/index.js';
import { pointInPolygon } from '../geometry/polygon.js';
import {
  areaWorldPolygon,
  areasBounds,
  connectionPolygon,
  isConnectionPassable,
} from '../domain/areas.js';
import { isForkliftObject, isRackObject } from '../domain/types.js';
import type { Area, AreaConnection, Shutter } from '../domain/areas.js';
import type { LayoutObject, Vec2, Warehouse } from '../domain/types.js';

export const BLOCKED = Number.POSITIVE_INFINITY;

/** エリア外 / どの接続口にも属さないことを表す番号。 */
const NONE = -1;

export interface NavGridOptions {
  /** セルの一辺 (m) */
  cellM: number;
  /** 障害物を膨張させる距離 (m) — 車体半幅 + 安全マージン */
  clearanceM: number;
  /**
   * 倉庫を構成するエリア。
   * 未指定（または空）の場合は倉庫矩形全体を走行可能とする（旧データ互換）。
   */
  areas?: readonly Area[];
  /** エリア間の接続口 */
  connections?: readonly AreaConnection[];
  /** シャッター（閉じている接続口は通行不可になる） */
  shutters?: readonly Shutter[];
}

/**
 * 走行可能エリアのラスタ表現。
 *
 * - 壁 / 柱 / ラック / 立入禁止エリア -> 進入不可 (clearance 分だけ膨張)
 * - 歩行者エリア -> 進入可能だが通行コストを高くする
 * - エリア外 -> 進入不可
 * - エリアの外壁沿い -> 車体クリアランス分だけ進入不可
 * - エリア間の移動 -> 接続口（シャッターが開いている）を通る場合のみ可能
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellM: number;
  readonly clearanceM: number;
  /** セルごとの通行コスト倍率。BLOCKED は進入不可。 */
  readonly cost: Float64Array;
  /** セルが属するエリアの添字 (-1 = エリア外) */
  readonly areaOf: Int16Array;
  /** セルが属する接続口の添字 (-1 = 接続口外) */
  readonly connOf: Int16Array;
  /** 接続口ごとの [fromAreaIndex, toAreaIndex] */
  private readonly connectionAreas: [number, number][] = [];
  /** エリア制約が有効か（旧データではオフ） */
  readonly areaConstrained: boolean;

  constructor(
    cols: number,
    rows: number,
    cellM: number,
    clearanceM: number,
    areaConstrained = false,
  ) {
    this.cols = cols;
    this.rows = rows;
    this.cellM = cellM;
    this.clearanceM = clearanceM;
    this.areaConstrained = areaConstrained;
    const size = cols * rows;
    this.cost = new Float64Array(size).fill(1);
    this.areaOf = new Int16Array(size).fill(NONE);
    this.connOf = new Int16Array(size).fill(NONE);
  }

  static fromLayout(
    warehouse: Pick<Warehouse, 'widthM' | 'depthM'>,
    objects: readonly LayoutObject[],
    options: NavGridOptions,
  ): NavGrid {
    const cellM = Math.max(0.05, options.cellM);
    const areas = options.areas ?? [];
    const connections = options.connections ?? [];
    const shutters = options.shutters ?? [];

    // エリアが倉庫矩形からはみ出す場合もグリッドで覆う
    let extentX = warehouse.widthM;
    let extentY = warehouse.depthM;
    if (areas.length > 0) {
      const bounds = areasBounds(areas);
      extentX = Math.max(extentX, bounds.x + bounds.widthM);
      extentY = Math.max(extentY, bounds.y + bounds.depthM);
    }

    const cols = Math.max(1, Math.ceil(extentX / cellM));
    const rows = Math.max(1, Math.ceil(extentY / cellM));
    const grid = new NavGrid(cols, rows, cellM, options.clearanceM, areas.length > 0);

    if (areas.length > 0) {
      grid.stampAreas(areas, connections, shutters);
    }

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

  /**
   * エリア・接続口をグリッドへ焼き込む。
   * エリア外は進入不可、外壁沿いはクリアランス分だけ進入不可にする。
   * 接続口の内側は外壁沿いでも通行可能として残す。
   */
  private stampAreas(
    areas: readonly Area[],
    connections: readonly AreaConnection[],
    shutters: readonly Shutter[],
  ): void {
    const polygons = areas.map(areaWorldPolygon);
    const areaIndexById = new Map(areas.map((a, i) => [a.id, i]));
    const passableConnections = connections.filter((c) => isConnectionPassable(c, shutters));
    const connPolygons = passableConnections.map(connectionPolygon);
    for (const conn of passableConnections) {
      this.connectionAreas.push([
        areaIndexById.get(conn.fromAreaId) ?? NONE,
        areaIndexById.get(conn.toAreaId) ?? NONE,
      ]);
    }

    // 壁からのクリアランス判定に使うサンプル方向
    const clearance = this.clearanceM;
    const offsets: Vec2[] = [];
    if (clearance > 0) {
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        offsets.push({ x: Math.cos(angle) * clearance, y: Math.sin(angle) * clearance });
      }
    }

    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const center = this.cellToWorld(cx, cy);
        const index = this.index(cx, cy);

        let areaIdx = NONE;
        for (let i = polygons.length - 1; i >= 0; i--) {
          if (pointInPolygon(center, polygons[i]!)) {
            areaIdx = i;
            break;
          }
        }
        let connIdx = NONE;
        for (let i = 0; i < connPolygons.length; i++) {
          if (pointInPolygon(center, connPolygons[i]!)) {
            connIdx = i;
            break;
          }
        }

        this.areaOf[index] = areaIdx;
        this.connOf[index] = connIdx;

        if (areaIdx === NONE && connIdx === NONE) {
          this.cost[index] = BLOCKED;
          continue;
        }
        // 接続口の内側は開口部なので壁クリアランスを適用しない
        if (connIdx !== NONE) continue;

        // 外壁沿い（クリアランス範囲内に自エリア外の点がある）は進入不可
        const polygon = polygons[areaIdx]!;
        for (const off of offsets) {
          const probe = { x: center.x + off.x, y: center.y + off.y };
          if (!pointInPolygon(probe, polygon)) {
            this.cost[index] = BLOCKED;
            break;
          }
        }
      }
    }
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

  /**
   * セル間を移動できるか。
   * 別エリアへの移動は、両セルが同じ接続口に属しているか、
   * 一方が接続口に属していてもう一方がその接続口のつなぐエリアである場合のみ許可する。
   */
  canTraverse(fromIndex: number, toIndex: number): boolean {
    if (!this.areaConstrained) return true;
    const areaA = this.areaOf[fromIndex]!;
    const areaB = this.areaOf[toIndex]!;
    if (areaA === areaB && areaA !== NONE) return true;

    const connA = this.connOf[fromIndex]!;
    const connB = this.connOf[toIndex]!;
    if (connA !== NONE && connA === connB) return true;
    if (connA !== NONE && this.connectionTouches(connA, areaB)) return true;
    if (connB !== NONE && this.connectionTouches(connB, areaA)) return true;
    return false;
  }

  private connectionTouches(connIndex: number, areaIndex: number): boolean {
    if (areaIndex === NONE) return true; // 開口部の隙間（どのエリアにも属さない部分）
    const pair = this.connectionAreas[connIndex];
    if (!pair) return false;
    return pair[0] === areaIndex || pair[1] === areaIndex;
  }

  worldToCell(p: Vec2): { cx: number; cy: number } {
    return { cx: Math.floor(p.x / this.cellM), cy: Math.floor(p.y / this.cellM) };
  }

  cellToWorld(cx: number, cy: number): Vec2 {
    return { x: (cx + 0.5) * this.cellM, y: (cy + 0.5) * this.cellM };
  }

  /** 座標が属するエリアの添字を返す (-1 = エリア外)。 */
  areaIndexAt(p: Vec2): number {
    const { cx, cy } = this.worldToCell(p);
    if (!this.inBounds(cx, cy)) return NONE;
    return this.areaOf[this.index(cx, cy)]!;
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

  /** 2点間に障害物がないか (経路平滑化で使用)。エリア境界の壁も考慮する。 */
  hasLineOfSight(a: Vec2, b: Vec2): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / (this.cellM * 0.5)));
    let previous = -1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const { cx, cy } = this.worldToCell({ x, y });
      if (!this.inBounds(cx, cy) || this.isBlocked(cx, cy)) return false;
      const index = this.index(cx, cy);
      if (previous !== -1 && previous !== index && !this.canTraverse(previous, index)) return false;
      previous = index;
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
