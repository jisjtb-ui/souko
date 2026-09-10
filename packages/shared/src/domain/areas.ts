import { createId } from './ids.js';
import {
  closestPointsBetweenPolygons,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  rectToPolygon,
  transformPolygon,
  unionArea,
} from '../geometry/polygon.js';
import { objectCenter } from '../geometry/index.js';
import { isRackObject } from './types.js';
import type { ID } from './ids.js';
import type { LayoutObject, Location, Rect, Vec2, Warehouse } from './types.js';

/* ============================================================================
 * Area — 倉庫を構成する自由形状の区画
 * ----------------------------------------------------------------------------
 * 倉庫を1つの長方形として扱うのをやめ、複数の Area を組み合わせて
 * L字型・コの字型・別棟接続などの実際の倉庫形状を再現できるようにする。
 *
 * Area は「レイアウト」に属する。レイアウトA/Bで形状そのものを変えて
 * 比較シミュレーションできるようにするため（増築案の検証など）。
 * Warehouse から見ると「現在のレイアウトが持つ Area 群 = 倉庫の形」になる。
 * ========================================================================== */

export type AreaShapeType = 'rect' | 'polygon';

/** 区画の種類。将来 別棟 / 増築 / 屋外ヤード / 中2階 などへ拡張する。 */
export type AreaKind = 'building' | 'extension' | 'outdoor-yard' | 'mezzanine';

export interface Area {
  id: ID;
  warehouseId: ID;
  layoutId: ID;
  name: string;
  type: AreaShapeType;
  kind: AreaKind;
  /** ローカル座標の頂点列 (m)。矩形でも4頂点を保持する。 */
  polygon: Vec2[];
  /** 配置位置 = ローカル原点のワールド座標 (m) */
  x: number;
  y: number;
  /** (x, y) を中心とした時計回り回転 (度) */
  rotationDeg: number;
  z: number;
  color?: string;
  locked?: boolean;
  note?: string;
  /** 将来拡張用の任意情報 (階数・棟名など) */
  metadata?: Record<string, unknown>;
}

/** 接続口の種類。 */
export type ConnectionType = 'opening' | 'shutter' | 'door' | 'corridor';

/**
 * Area 同士の接続口。
 *
 * Area が隣接しているだけでは通行できない。接続口がある場所だけが
 * エリア間の通り道になる（それ以外の境界は壁として扱う）。
 */
export interface AreaConnection {
  id: ID;
  warehouseId: ID;
  layoutId: ID;
  name: string;
  fromAreaId: ID;
  toAreaId: ID;
  /** 接続口の中心 (ワールド座標 m) */
  x: number;
  y: number;
  /** 開口幅 (m) */
  widthM: number;
  /** 壁を跨ぐ方向の奥行 (m)。両エリアのセルを確実に含める厚み。 */
  spanM: number;
  /** 開口線の向き (度)。0 のとき開口は X 軸方向に伸びる。 */
  rotationDeg: number;
  type: ConnectionType;
  /** 通行可能か (シャッターが閉じている場合は別途 false 扱い) */
  passable: boolean;
}

export type ShutterState = 'open' | 'closed';

/**
 * シャッター。接続口に対して独立したエンティティとして持つ。
 * 将来: サイズ / シャッターボックス / 開閉時間 / 種類 / 通過可能車両 / 防火区画。
 */
export interface Shutter {
  id: ID;
  connectionId: ID;
  name: string;
  state: ShutterState;
}

/* --------------------------------------------------------------- ファクトリ */

export interface CreateAreaInput {
  warehouseId: ID;
  layoutId: ID;
  name?: string;
  kind?: AreaKind;
  x: number;
  y: number;
  /** 矩形の場合のサイズ */
  widthM?: number;
  depthM?: number;
  /** 多角形の場合のローカル頂点 */
  polygon?: Vec2[];
  rotationDeg?: number;
  z?: number;
  color?: string;
}

export function createArea(input: CreateAreaInput): Area {
  const polygon = input.polygon ?? rectToPolygon(input.widthM ?? 20, input.depthM ?? 20);
  return {
    id: createId('area'),
    warehouseId: input.warehouseId,
    layoutId: input.layoutId,
    name: input.name ?? 'エリア',
    type: input.polygon ? 'polygon' : 'rect',
    kind: input.kind ?? 'building',
    polygon,
    x: input.x,
    y: input.y,
    rotationDeg: input.rotationDeg ?? 0,
    z: input.z ?? 0,
    ...(input.color ? { color: input.color } : {}),
  };
}

export function createConnection(input: {
  warehouseId: ID;
  layoutId: ID;
  fromAreaId: ID;
  toAreaId: ID;
  x: number;
  y: number;
  widthM?: number;
  spanM?: number;
  rotationDeg?: number;
  name?: string;
  type?: ConnectionType;
}): AreaConnection {
  return {
    id: createId('conn'),
    warehouseId: input.warehouseId,
    layoutId: input.layoutId,
    name: input.name ?? '接続口',
    fromAreaId: input.fromAreaId,
    toAreaId: input.toAreaId,
    x: input.x,
    y: input.y,
    widthM: input.widthM ?? 4,
    spanM: input.spanM ?? 2.4,
    rotationDeg: input.rotationDeg ?? 0,
    type: input.type ?? 'opening',
    passable: true,
  };
}

export function createShutter(connectionId: ID, name = 'シャッター'): Shutter {
  return { id: createId('sht'), connectionId, name, state: 'open' };
}

/* ------------------------------------------------------------------- 幾何 */

/** エリアの頂点をワールド座標で返す。 */
export function areaWorldPolygon(area: Area): Vec2[] {
  return transformPolygon(area.polygon, { x: area.x, y: area.y }, area.rotationDeg);
}

export function areaBounds(area: Area): Rect {
  return polygonBounds(areaWorldPolygon(area));
}

/** エリアの面積 (㎡)。多角形は頂点座標から計算する。 */
export function areaSizeM2(area: Area): number {
  return polygonArea(area.polygon);
}

export function areaCentroid(area: Area): Vec2 {
  return polygonCentroid(areaWorldPolygon(area));
}

export function pointInArea(area: Area, p: Vec2): boolean {
  return pointInPolygon(p, areaWorldPolygon(area));
}

/** 指定座標を含むエリアを返す（重なっている場合は z が大きい方を優先）。 */
export function findAreaAt(areas: readonly Area[], p: Vec2): Area | undefined {
  let found: Area | undefined;
  for (const area of areas) {
    if (pointInArea(area, p) && (!found || area.z >= found.z)) found = area;
  }
  return found;
}

/** 接続口の開口範囲（回転矩形）をワールド座標の多角形で返す。 */
export function connectionPolygon(connection: AreaConnection): Vec2[] {
  const halfW = connection.widthM / 2;
  const halfS = connection.spanM / 2;
  const local: Vec2[] = [
    { x: -halfW, y: -halfS },
    { x: halfW, y: -halfS },
    { x: halfW, y: halfS },
    { x: -halfW, y: halfS },
  ];
  return transformPolygon(local, { x: connection.x, y: connection.y }, connection.rotationDeg);
}

export function pointInConnection(connection: AreaConnection, p: Vec2): boolean {
  return pointInPolygon(p, connectionPolygon(connection));
}

/**
 * 接続口が実際に通行可能か。
 * シャッターが設置されていて閉じている場合は通行不可。
 */
export function isConnectionPassable(
  connection: AreaConnection,
  shutters: readonly Shutter[],
): boolean {
  if (!connection.passable) return false;
  const shutter = shutters.find((s) => s.connectionId === connection.id);
  return !shutter || shutter.state === 'open';
}

export function findShutter(
  connectionId: ID,
  shutters: readonly Shutter[],
): Shutter | undefined {
  return shutters.find((s) => s.connectionId === connectionId);
}

/**
 * 2つのエリアの境界が最も近い位置に接続口を作る。
 * 「接続を追加」でエリアを2つ選んだときの既定配置に使う。
 */
export function suggestConnection(
  from: Area,
  to: Area,
  options: { widthM?: number; spanM?: number } = {},
): { x: number; y: number; rotationDeg: number; widthM: number; spanM: number; distance: number } {
  const polyA = areaWorldPolygon(from);
  const polyB = areaWorldPolygon(to);
  const { pointA, pointB, distance } = closestPointsBetweenPolygons(polyA, polyB);
  const cx = (pointA.x + pointB.x) / 2;
  const cy = (pointA.y + pointB.y) / 2;
  // 開口線は「2エリアを結ぶ方向」に直交させる
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  // 開口の「幅」は2エリアを結ぶ方向と直交させる（+90度）
  const angle = distance < 1e-6 ? 90 : (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return {
    x: cx,
    y: cy,
    rotationDeg: angle,
    widthM: options.widthM ?? 4,
    // 壁の隙間があっても両側のセルを含むよう、距離に応じて厚みを取る
    spanM: Math.max(options.spanM ?? 2.4, distance + 1.6),
    distance,
  };
}

/* ------------------------------------------------------- 既存データとの互換 */

/**
 * エリアが未設定のレイアウトに、倉庫全体を覆う既定エリアを1つ用意する。
 * これにより、従来の「1つの長方形の倉庫」はそのまま動作する。
 */
export function ensureDefaultArea(
  warehouse: Pick<Warehouse, 'id' | 'widthM' | 'depthM' | 'name'>,
  layoutId: ID,
  areas: readonly Area[],
): Area[] {
  if (areas.length > 0) return [...areas];
  return [
    createArea({
      warehouseId: warehouse.id,
      layoutId,
      name: 'エリア1',
      x: 0,
      y: 0,
      widthM: warehouse.widthM,
      depthM: warehouse.depthM,
    }),
  ];
}

/**
 * 配置オブジェクト・ロケーションに所属エリアを割り当てる。
 * 中心座標を含むエリアを所属先とする。
 */
export function assignAreaIds<T extends LayoutObject>(objects: readonly T[], areas: readonly Area[]): T[] {
  if (areas.length === 0) return [...objects];
  return objects.map((obj) => {
    const area = findAreaAt(areas, objectCenter(obj));
    const areaId = area?.id;
    if (obj.areaId === areaId) return obj;
    return { ...obj, ...(areaId ? { areaId } : { areaId: undefined }) };
  });
}

export function assignLocationAreaIds(
  locations: readonly Location[],
  areas: readonly Area[],
  objects: readonly LayoutObject[],
): Location[] {
  if (areas.length === 0) return [...locations];
  const rackAreaById = new Map(objects.filter(isRackObject).map((r) => [r.id, r.areaId]));
  return locations.map((loc) => {
    // ラックの所属エリアを優先し、無ければロケーション座標で判定する
    const areaId = rackAreaById.get(loc.rackId) ?? findAreaAt(areas, { x: loc.x, y: loc.y })?.id;
    if (loc.areaId === areaId) return loc;
    return { ...loc, ...(areaId ? { areaId } : { areaId: undefined }) };
  });
}

/* ------------------------------------------------------------------ 集計 */

export interface AreaStats {
  areaId: ID;
  name: string;
  /** 面積 (㎡) */
  sizeM2: number;
  /** 外接矩形の幅・奥行 (m) */
  widthM: number;
  depthM: number;
  rackCount: number;
  locationCount: number;
  /** 収納可能数の合計 */
  capacity: number;
  forkliftCount: number;
  gateCount: number;
  /** 現在の在庫数（シミュレーション未実行時は0） */
  inventoryUnits: number;
}

export function computeAreaStats(
  area: Area,
  objects: readonly LayoutObject[],
  locations: readonly Location[],
  inventoryByLocation?: ReadonlyMap<ID, number>,
): AreaStats {
  const bounds = areaBounds(area);
  const inArea = objects.filter((o) => o.areaId === area.id);
  const areaLocations = locations.filter((l) => l.areaId === area.id);
  return {
    areaId: area.id,
    name: area.name,
    sizeM2: areaSizeM2(area),
    widthM: bounds.widthM,
    depthM: bounds.depthM,
    rackCount: inArea.filter(isRackObject).length,
    locationCount: areaLocations.length,
    capacity: areaLocations.reduce((sum, l) => sum + l.capacity, 0),
    forkliftCount: inArea.filter((o) => o.kind === 'forklift').length,
    gateCount: inArea.filter((o) => o.kind === 'inbound-gate' || o.kind === 'outbound-gate').length,
    inventoryUnits: inventoryByLocation
      ? areaLocations.reduce((sum, l) => sum + (inventoryByLocation.get(l.id) ?? 0), 0)
      : 0,
  };
}

/** 倉庫総面積。重なり部分は二重計上しない。 */
export function totalWarehouseArea(areas: readonly Area[]): number {
  return unionArea(areas.map(areaWorldPolygon));
}

/** 全エリアを含む外接矩形。全体表示のフィットに使う。 */
export function areasBounds(areas: readonly Area[]): Rect {
  if (areas.length === 0) return { x: 0, y: 0, widthM: 0, depthM: 0 };
  return polygonBounds(areas.flatMap(areaWorldPolygon));
}
