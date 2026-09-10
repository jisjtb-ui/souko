import type { LayoutObject, Rect, Vec2 } from '../domain/types.js';

export const DEG = Math.PI / 180;

export function rotatePoint(p: Vec2, originDeg: number, origin: Vec2 = { x: 0, y: 0 }): Vec2 {
  const rad = originDeg * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/**
 * オブジェクトのローカル座標 (左上原点, 回転前) をワールド座標へ変換する。
 * Konva と同じく (x, y) を回転中心とする。
 */
export function localToWorld(obj: Pick<LayoutObject, 'x' | 'y' | 'rotationDeg'>, local: Vec2): Vec2 {
  const rotated = rotatePoint(local, obj.rotationDeg);
  return { x: obj.x + rotated.x, y: obj.y + rotated.y };
}

/** 回転後の四隅 (左上→右上→右下→左下) をワールド座標で返す。 */
export function objectCorners(obj: Pick<LayoutObject, 'x' | 'y' | 'widthM' | 'depthM' | 'rotationDeg'>): Vec2[] {
  const locals: Vec2[] = [
    { x: 0, y: 0 },
    { x: obj.widthM, y: 0 },
    { x: obj.widthM, y: obj.depthM },
    { x: 0, y: obj.depthM },
  ];
  return locals.map((l) => localToWorld(obj, l));
}

/** 回転を含めた軸平行境界ボックス。 */
export function objectAABB(obj: Pick<LayoutObject, 'x' | 'y' | 'widthM' | 'depthM' | 'rotationDeg'>): Rect {
  const corners = objectCorners(obj);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    widthM: Math.max(...xs) - minX,
    depthM: Math.max(...ys) - minY,
  };
}

export function objectCenter(obj: Pick<LayoutObject, 'x' | 'y' | 'widthM' | 'depthM' | 'rotationDeg'>): Vec2 {
  return localToWorld(obj, { x: obj.widthM / 2, y: obj.depthM / 2 });
}

/** 点が回転矩形の内側にあるか。 */
export function pointInObject(
  obj: Pick<LayoutObject, 'x' | 'y' | 'widthM' | 'depthM' | 'rotationDeg'>,
  p: Vec2,
): boolean {
  const local = rotatePoint({ x: p.x - obj.x, y: p.y - obj.y }, -obj.rotationDeg);
  return local.x >= 0 && local.x <= obj.widthM && local.y >= 0 && local.y <= obj.depthM;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.widthM && a.x + a.widthM > b.x && a.y < b.y + b.depthM && a.y + a.depthM > b.y
  );
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pathLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1]!, points[i]!);
  }
  return total;
}

/** 値をグリッドにスナップする。 */
export function snap(value: number, gridM: number): number {
  if (gridM <= 0) return value;
  return Math.round(value / gridM) * gridM;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 浮動小数の誤差を丸める (0.30000000000000004 対策)。 */
export function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** km/h -> m/s */
export function kmhToMps(kmh: number): number {
  return (kmh * 1000) / 3600;
}

/** m/s -> km/h */
export function mpsToKmh(mps: number): number {
  return (mps * 3600) / 1000;
}

/** 秒 -> "HH:MM:SS" */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

/** "HH:MM" または "HH:MM:SS" -> 秒 */
export function parseClock(clock: string): number {
  const parts = clock.split(':').map((p) => Number.parseInt(p, 10) || 0);
  const [h = 0, m = 0, s = 0] = parts;
  return h * 3600 + m * 60 + s;
}

/** 秒 -> "3分42秒" のような日本語表記 */
export function formatDurationJa(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}
