import type { Vec2 } from '../domain/types.js';

/* ============================================================================
 * ヒートマップ (要件14)
 * ----------------------------------------------------------------------------
 * フォークリフトの移動データから
 *   - よく通る場所 (traffic)
 *   - 渋滞・待機が起きる場所 (congestion)
 *   - 作業が集中する場所 (work)
 * を格子状に集計する。「どこが倉庫のボトルネックか」を面で示すための土台。
 * ========================================================================== */

export type HeatmapLayerKey = 'traffic' | 'congestion' | 'work' | 'distance';

export const HEATMAP_LAYERS: readonly HeatmapLayerKey[] = [
  'traffic',
  'congestion',
  'work',
  'distance',
];

export interface HeatmapLayerMeta {
  label: string;
  /** 凡例に出す単位 */
  unit: string;
  description: string;
}

export const HEATMAP_LAYER_META: Record<HeatmapLayerKey, HeatmapLayerMeta> = {
  traffic: {
    label: '通行量',
    unit: 'm',
    description: 'フォークリフトの走行距離の合計。太い動線＝主要通路。',
  },
  congestion: {
    label: '渋滞・待機',
    unit: '秒',
    description:
      'フォークリフトの停止時間（対向車待ち・バース待ち）とゲート前のラック滞留の合計。詰まっている場所。',
  },
  work: {
    label: '作業集中',
    unit: '秒',
    description: '荷役（格納・取得・積み重ね）に費やした時間。作業が集まる場所。',
  },
  distance: {
    label: '搬送距離',
    unit: 'm',
    description:
      'そのロケーション/ゲートを目的地とした作業の走行距離。遠い保管場所ほど濃くなる（配置見直しの手がかり）。',
  },
};

/**
 * 単一色相の連続スケール (light → dark)。
 *
 * マップ上のラック・構造物が青系のため、青は使わない。
 * 同時に表示するのは1レイヤーだけなので、各レイヤーが独立した1色相ランプを持つ。
 * いずれも OKLCH の明度が単調減少になるよう選んである。
 */
export const HEAT_RAMPS: Record<HeatmapLayerKey, readonly string[]> = {
  // オレンジ
  traffic: ['#fdf0e6', '#fbd9bf', '#f7b98c', '#f2955c', '#eb6834', '#c74e20', '#9c3a15', '#6d280d'],
  // レッド（詰まり＝危険の含意）
  congestion: ['#fdecec', '#fbd0cf', '#f5a8a6', '#ef7b79', '#e34948', '#bf3231', '#932322', '#661615'],
  // バイオレット
  work: ['#eeecf8', '#d6d1ef', '#b5ace1', '#8d80cf', '#6a5ab8', '#4a3aa7', '#372b7e', '#251c57'],
  // マゼンタ
  distance: ['#fbecf2', '#f6d2e0', '#f0aec7', '#e87ba4', '#d95285', '#b83a6b', '#8f2a51', '#611936'],
};

/** 比率 (0-1) を色に変換する。低い値は床に溶けるよう薄く始まる。 */
export function heatColor(layer: HeatmapLayerKey, ratio: number): string {
  const ramp = HEAT_RAMPS[layer];
  const clamped = Math.max(0, Math.min(1, ratio));
  const index = Math.min(ramp.length - 1, Math.floor(clamped * ramp.length));
  return ramp[index]!;
}

/** 比率 (0-1) を不透明度に変換する。ゼロ付近は描かない。 */
export function heatOpacity(ratio: number): number {
  if (ratio <= 0) return 0;
  // 低い値でも存在が分かるよう下限を設ける
  return 0.25 + Math.min(1, ratio) * 0.55;
}

export interface HeatCell {
  cx: number;
  cy: number;
  /** セル左上のワールド座標 (m) */
  x: number;
  y: number;
  sizeM: number;
  value: number;
  /** 最大値に対する比率 (0-1) */
  ratio: number;
}

export interface Hotspot {
  /** セル中心のワールド座標 (m) */
  x: number;
  y: number;
  value: number;
  ratio: number;
}

export class Heatmap {
  readonly cols: number;
  readonly rows: number;
  readonly cellM: number;
  private readonly data: Record<HeatmapLayerKey, Float64Array>;

  constructor(widthM: number, depthM: number, cellM = 1) {
    this.cellM = Math.max(0.25, cellM);
    this.cols = Math.max(1, Math.ceil(widthM / this.cellM));
    this.rows = Math.max(1, Math.ceil(depthM / this.cellM));
    const size = this.cols * this.rows;
    this.data = {
      traffic: new Float64Array(size),
      congestion: new Float64Array(size),
      work: new Float64Array(size),
      distance: new Float64Array(size),
    };
  }

  private index(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  private inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  cellOf(p: Vec2): { cx: number; cy: number } {
    return { cx: Math.floor(p.x / this.cellM), cy: Math.floor(p.y / this.cellM) };
  }

  /** 1点に値を加算する（待機時間・荷役時間など）。 */
  addPoint(layer: HeatmapLayerKey, p: Vec2, value: number): void {
    if (!(value > 0)) return;
    const { cx, cy } = this.cellOf(p);
    if (!this.inBounds(cx, cy)) return;
    const array = this.data[layer];
    const index = this.index(cx, cy);
    array[index] = (array[index] ?? 0) + value;
  }

  /**
   * 線分に沿って値を配分する（走行距離など）。
   * セルをまたぐ移動でも、通過したセルすべてに按分する。
   */
  addSegment(layer: HeatmapLayerKey, from: Vec2, to: Vec2, total: number): void {
    if (!(total > 0)) return;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (this.cellM * 0.5)));
    const share = total / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      this.addPoint(layer, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, share);
    }
  }

  /**
   * 矩形の範囲へ値を按分する（ゲート前の滞留など、面で起きる事象）。
   */
  addRect(
    layer: HeatmapLayerKey,
    rect: { x: number; y: number; widthM: number; depthM: number },
    total: number,
  ): void {
    if (!(total > 0)) return;
    const cols = Math.max(1, Math.round(rect.widthM / this.cellM));
    const rows = Math.max(1, Math.round(rect.depthM / this.cellM));
    const share = total / (cols * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        this.addPoint(
          layer,
          { x: rect.x + (col + 0.5) * this.cellM, y: rect.y + (row + 0.5) * this.cellM },
          share,
        );
      }
    }
  }

  valueAt(layer: HeatmapLayerKey, cx: number, cy: number): number {
    if (!this.inBounds(cx, cy)) return 0;
    return this.data[layer][this.index(cx, cy)]!;
  }

  maxOf(layer: HeatmapLayerKey): number {
    let max = 0;
    const array = this.data[layer];
    for (let i = 0; i < array.length; i++) if (array[i]! > max) max = array[i]!;
    return max;
  }

  totalOf(layer: HeatmapLayerKey): number {
    let total = 0;
    const array = this.data[layer];
    for (let i = 0; i < array.length; i++) total += array[i]!;
    return total;
  }

  /** 値のあるセルを列挙する（描画用）。 */
  cells(layer: HeatmapLayerKey, minRatio = 0.02): HeatCell[] {
    const max = this.maxOf(layer);
    if (max <= 0) return [];
    const out: HeatCell[] = [];
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const value = this.data[layer][this.index(cx, cy)]!;
        if (value <= 0) continue;
        const ratio = value / max;
        if (ratio < minRatio) continue;
        out.push({
          cx,
          cy,
          x: cx * this.cellM,
          y: cy * this.cellM,
          sizeM: this.cellM,
          value,
          ratio,
        });
      }
    }
    return out;
  }

  /**
   * 上位のホットスポットを返す。
   * 近接するセルは1つにまとめ、「どこが詰まっているか」を地点として示す。
   */
  hotspots(layer: HeatmapLayerKey, limit = 5, mergeRadiusM = 4): Hotspot[] {
    const max = this.maxOf(layer);
    if (max <= 0) return [];

    const sorted = this.cells(layer, 0)
      .map((cell) => ({
        x: cell.x + this.cellM / 2,
        y: cell.y + this.cellM / 2,
        value: cell.value,
        ratio: cell.ratio,
      }))
      .sort((a, b) => b.value - a.value);

    const picked: Hotspot[] = [];
    for (const candidate of sorted) {
      if (picked.length >= limit) break;
      const near = picked.some(
        (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) <= mergeRadiusM,
      );
      if (!near) picked.push(candidate);
    }
    return picked;
  }

  /** 全レイヤーを初期化する。 */
  reset(): void {
    for (const layer of HEATMAP_LAYERS) this.data[layer].fill(0);
  }

  /** 保存・比較用のプレーンな表現。 */
  toJSON(): {
    cols: number;
    rows: number;
    cellM: number;
    layers: Record<HeatmapLayerKey, number[]>;
  } {
    return {
      cols: this.cols,
      rows: this.rows,
      cellM: this.cellM,
      layers: {
        traffic: [...this.data.traffic],
        congestion: [...this.data.congestion],
        work: [...this.data.work],
        distance: [...this.data.distance],
      },
    };
  }
}
