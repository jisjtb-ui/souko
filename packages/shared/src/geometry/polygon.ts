import type { Rect, Vec2 } from '../domain/types.js';
import { rotatePoint } from './index.js';

/**
 * 多角形ユーティリティ。
 * エリア（自由形状の倉庫区画）の面積計算・内外判定・当たり判定に使う。
 */

/** 符号付き面積 (シューレース公式)。反時計回りで正。 */
export function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** 多角形の面積 (㎡)。 */
export function polygonArea(points: readonly Vec2[]): number {
  if (points.length < 3) return 0;
  return Math.abs(signedArea(points));
}

/** 多角形の重心。 */
export function polygonCentroid(points: readonly Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length < 3) {
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
  }
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) {
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** 点が多角形の内側にあるか (交差数判定)。境界上は内側として扱う。 */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y || 1e-12) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** 多角形の軸平行境界ボックス。 */
export function polygonBounds(points: readonly Vec2[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, widthM: 0, depthM: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, widthM: Math.max(...xs) - minX, depthM: Math.max(...ys) - minY };
}

/** 線分と点の最短距離。 */
export function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 点から多角形の輪郭までの最短距離（内外を問わない）。 */
export function distanceToPolygonEdge(p: Vec2, polygon: readonly Vec2[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    min = Math.min(min, distancePointToSegment(p, a, b));
  }
  return min;
}

/** 多角形の輪郭上で、指定点に最も近い点を返す。 */
export function closestPointOnPolygon(p: Vec2, polygon: readonly Vec2[]): Vec2 {
  let best: Vec2 = polygon[0] ?? { x: 0, y: 0 };
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq < 1e-12 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const candidate = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(p.x - candidate.x, p.y - candidate.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/** 2つの多角形の輪郭同士で最も近い点の組を返す。エリア間の接続口の位置決めに使う。 */
export function closestPointsBetweenPolygons(
  a: readonly Vec2[],
  b: readonly Vec2[],
): { pointA: Vec2; pointB: Vec2; distance: number } {
  let best = {
    pointA: a[0] ?? { x: 0, y: 0 },
    pointB: b[0] ?? { x: 0, y: 0 },
    distance: Number.POSITIVE_INFINITY,
  };
  const consider = (pa: Vec2, pb: Vec2): void => {
    const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    if (d < best.distance) best = { pointA: pa, pointB: pb, distance: d };
  };
  for (const p of a) consider(p, closestPointOnPolygon(p, b));
  for (const p of b) consider(closestPointOnPolygon(p, a), p);
  // 辺の中点も候補にする（角より辺同士が近いケース）
  for (let i = 0; i < a.length; i++) {
    const mid = {
      x: (a[i]!.x + a[(i + 1) % a.length]!.x) / 2,
      y: (a[i]!.y + a[(i + 1) % a.length]!.y) / 2,
    };
    consider(mid, closestPointOnPolygon(mid, b));
  }
  for (let i = 0; i < b.length; i++) {
    const mid = {
      x: (b[i]!.x + b[(i + 1) % b.length]!.x) / 2,
      y: (b[i]!.y + b[(i + 1) % b.length]!.y) / 2,
    };
    consider(closestPointOnPolygon(mid, a), mid);
  }
  return best;
}

/** 矩形を多角形（4頂点）に変換する。 */
export function rectToPolygon(widthM: number, depthM: number): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: widthM, y: 0 },
    { x: widthM, y: depthM },
    { x: 0, y: depthM },
  ];
}

/** ローカル多角形を配置位置・回転を適用してワールド座標へ変換する。 */
export function transformPolygon(
  polygon: readonly Vec2[],
  origin: Vec2,
  rotationDeg: number,
): Vec2[] {
  return polygon.map((p) => {
    const r = rotationDeg === 0 ? p : rotatePoint(p, rotationDeg);
    return { x: origin.x + r.x, y: origin.y + r.y };
  });
}

/**
 * 複数多角形の和集合の面積を格子サンプリングで概算する。
 * 重なり部分を二重計上しないための実装（厳密な多角形ブーリアンは持たない）。
 */
export function unionArea(polygons: readonly (readonly Vec2[])[], sampleM = 0.25): number {
  const valid = polygons.filter((p) => p.length >= 3);
  if (valid.length === 0) return 0;
  if (valid.length === 1) return polygonArea(valid[0]!);

  const bounds = valid.map(polygonBounds);
  const minX = Math.min(...bounds.map((b) => b.x));
  const minY = Math.min(...bounds.map((b) => b.y));
  const maxX = Math.max(...bounds.map((b) => b.x + b.widthM));
  const maxY = Math.max(...bounds.map((b) => b.y + b.depthM));

  // サンプル数が過大にならないようセルサイズを調整する
  const targetCells = 400_000;
  let cell = sampleM;
  while (((maxX - minX) / cell) * ((maxY - minY) / cell) > targetCells) cell *= 2;

  const cols = Math.ceil((maxX - minX) / cell);
  const rows = Math.ceil((maxY - minY) / cell);
  let hits = 0;
  for (let iy = 0; iy < rows; iy++) {
    const y = minY + (iy + 0.5) * cell;
    for (let ix = 0; ix < cols; ix++) {
      const x = minX + (ix + 0.5) * cell;
      const p = { x, y };
      if (valid.some((poly) => pointInPolygon(p, poly))) hits++;
    }
  }
  return hits * cell * cell;
}
