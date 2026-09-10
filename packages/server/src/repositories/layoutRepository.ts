import { assignAreaIds, assignLocationAreaIds, createId, ensureDefaultArea } from '@ws/shared';
import type {
  Area,
  AreaConnection,
  Layout,
  LayoutObject,
  LayoutSnapshot,
  Location,
  ProductSize,
  RackType,
  Shutter,
  Warehouse,
} from '@ws/shared';
import { transaction, type Db } from '../db/database.js';
import {
  areaToRow,
  connectionToRow,
  layoutObjectToRow,
  locationToRow,
  productSizeToRow,
  rackTypeToRow,
  rowToArea,
  rowToConnection,
  rowToLayout,
  rowToLayoutObject,
  rowToLocation,
  rowToProductSize,
  rowToRackType,
  rowToShutter,
  rowToWarehouse,
  shutterToRow,
} from './mappers.js';

type Row = Record<string, unknown>;
const nowIso = (): string => new Date().toISOString();

/* ------------------------------------------------------------- Warehouses */

export interface WarehouseSummary extends Warehouse {
  layoutCount: number;
}

export function listWarehouses(db: Db): WarehouseSummary[] {
  const rows = db
    .prepare(
      `SELECT w.*, (SELECT COUNT(*) FROM layouts l WHERE l.warehouse_id = w.id) AS layout_count
       FROM warehouses w ORDER BY w.updated_at DESC`,
    )
    .all() as Row[];
  return rows.map((r) => ({ ...rowToWarehouse(r), layoutCount: Number(r['layout_count'] ?? 0) }));
}

export function getWarehouse(db: Db, id: string): Warehouse | undefined {
  const row = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id) as Row | undefined;
  return row ? rowToWarehouse(row) : undefined;
}

export function insertWarehouse(db: Db, wh: Warehouse): Warehouse {
  db.prepare(
    `INSERT INTO warehouses (id, name, width_m, depth_m, pixels_per_meter, grid_size_m, speed_limit_kmh, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    wh.id,
    wh.name,
    wh.widthM,
    wh.depthM,
    wh.pixelsPerMeter,
    wh.gridSizeM,
    wh.speedLimitKmh,
    wh.note ?? null,
    wh.createdAt,
    wh.updatedAt,
  );
  return wh;
}

export function updateWarehouse(db: Db, id: string, patch: Partial<Warehouse>): Warehouse | undefined {
  const existing = getWarehouse(db, id);
  if (!existing) return undefined;
  const next: Warehouse = { ...existing, ...patch, id, updatedAt: nowIso() };
  db.prepare(
    `UPDATE warehouses SET name = ?, width_m = ?, depth_m = ?, pixels_per_meter = ?, grid_size_m = ?,
      speed_limit_kmh = ?, note = ?, updated_at = ? WHERE id = ?`,
  ).run(
    next.name,
    next.widthM,
    next.depthM,
    next.pixelsPerMeter,
    next.gridSizeM,
    next.speedLimitKmh,
    next.note ?? null,
    next.updatedAt,
    id,
  );
  return next;
}

export function deleteWarehouse(db: Db, id: string): boolean {
  const info = db.prepare('DELETE FROM warehouses WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

/* ---------------------------------------------------------------- Layouts */

export function listLayouts(db: Db, warehouseId: string): Layout[] {
  const rows = db
    .prepare('SELECT * FROM layouts WHERE warehouse_id = ? ORDER BY created_at ASC')
    .all(warehouseId) as Row[];
  return rows.map(rowToLayout);
}

export function getLayout(db: Db, id: string): Layout | undefined {
  const row = db.prepare('SELECT * FROM layouts WHERE id = ?').get(id) as Row | undefined;
  return row ? rowToLayout(row) : undefined;
}

export function insertLayout(db: Db, layout: Layout): Layout {
  db.prepare(
    `INSERT INTO layouts (id, warehouse_id, name, description, cloned_from_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    layout.id,
    layout.warehouseId,
    layout.name,
    layout.description ?? null,
    layout.clonedFromId ?? null,
    layout.createdAt,
    layout.updatedAt,
  );
  return layout;
}

export function updateLayoutMeta(db: Db, id: string, patch: Partial<Layout>): Layout | undefined {
  const existing = getLayout(db, id);
  if (!existing) return undefined;
  const next: Layout = { ...existing, ...patch, id, updatedAt: nowIso() };
  db.prepare('UPDATE layouts SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
    next.name,
    next.description ?? null,
    next.updatedAt,
    id,
  );
  return next;
}

export function deleteLayout(db: Db, id: string): boolean {
  const info = db.prepare('DELETE FROM layouts WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

/* ------------------------------------------------------- Objects/Locations */

export function listObjects(db: Db, layoutId: string): LayoutObject[] {
  const rows = db
    .prepare('SELECT * FROM layout_objects WHERE layout_id = ? ORDER BY z ASC, rowid ASC')
    .all(layoutId) as Row[];
  return rows.map(rowToLayoutObject);
}

export function listLocations(db: Db, layoutId: string): Location[] {
  const rows = db
    .prepare('SELECT * FROM locations WHERE layout_id = ? ORDER BY code ASC')
    .all(layoutId) as Row[];
  return rows.map(rowToLocation);
}

export function listAreas(db: Db, layoutId: string): Area[] {
  const rows = db
    .prepare('SELECT * FROM areas WHERE layout_id = ? ORDER BY z ASC, rowid ASC')
    .all(layoutId) as Row[];
  return rows.map(rowToArea);
}

export function listConnections(db: Db, layoutId: string): AreaConnection[] {
  const rows = db
    .prepare('SELECT * FROM area_connections WHERE layout_id = ? ORDER BY rowid ASC')
    .all(layoutId) as Row[];
  return rows.map(rowToConnection);
}

export function listShutters(db: Db, layoutId: string): Shutter[] {
  const rows = db
    .prepare('SELECT * FROM shutters WHERE layout_id = ? ORDER BY rowid ASC')
    .all(layoutId) as Row[];
  return rows.map(rowToShutter);
}

/**
 * レイアウト1件分をまとめて取得する。
 *
 * エリア未設定の旧データは、倉庫矩形全体を覆う「エリア1」を補ってから返す。
 * これにより従来の長方形倉庫がそのまま動作する（次回保存時に永続化される）。
 */
export function getSnapshot(db: Db, layoutId: string): LayoutSnapshot | undefined {
  const layout = getLayout(db, layoutId);
  if (!layout) return undefined;
  const warehouse = getWarehouse(db, layout.warehouseId);
  if (!warehouse) return undefined;

  const objects = listObjects(db, layoutId);
  const locations = listLocations(db, layoutId);
  const storedAreas = listAreas(db, layoutId);
  const areas = ensureDefaultArea(warehouse, layoutId, storedAreas);
  const migrated = storedAreas.length === 0;

  return {
    warehouse,
    layout,
    areas,
    connections: listConnections(db, layoutId),
    shutters: listShutters(db, layoutId),
    objects: migrated ? assignAreaIds(objects, areas) : objects,
    locations: migrated ? assignLocationAreaIds(locations, areas, objects) : locations,
  };
}

const OBJECT_COLUMNS = [
  'id',
  'layout_id',
  'area_id',
  'kind',
  'name',
  'x',
  'y',
  'width_m',
  'depth_m',
  'rotation_deg',
  'z',
  'locked',
  'color',
  'note',
  'traversable',
  'is_dock_point',
  'props',
] as const;

const LOCATION_COLUMNS = [
  'id',
  'layout_id',
  'area_id',
  'rack_id',
  'code',
  'column_no',
  'level_no',
  'x',
  'y',
  'approach_x',
  'approach_y',
  'width_m',
  'depth_m',
  'capacity',
  'category',
  'blocked',
] as const;

const AREA_COLUMNS = [
  'id',
  'layout_id',
  'warehouse_id',
  'name',
  'type',
  'kind',
  'polygon',
  'x',
  'y',
  'rotation_deg',
  'z',
  'color',
  'locked',
  'note',
  'metadata',
] as const;

const CONNECTION_COLUMNS = [
  'id',
  'layout_id',
  'warehouse_id',
  'name',
  'from_area_id',
  'to_area_id',
  'x',
  'y',
  'width_m',
  'span_m',
  'rotation_deg',
  'type',
  'passable',
] as const;

const SHUTTER_COLUMNS = ['id', 'connection_id', 'layout_id', 'name', 'state'] as const;

type SqlValue = string | number | null;

function toSqlValues(row: Row, columns: readonly string[]): SqlValue[] {
  return columns.map((c) => {
    const v = row[c];
    if (v === undefined || v === null) return null;
    if (typeof v === 'number' || typeof v === 'string') return v;
    return String(v);
  });
}

export interface LayoutContents {
  objects: readonly LayoutObject[];
  locations: readonly Location[];
  areas?: readonly Area[];
  connections?: readonly AreaConnection[];
  shutters?: readonly Shutter[];
}

/**
 * レイアウトの配置内容を丸ごと置き換える (保存操作)。
 * エディタ側の状態をそのまま真実として扱うので、差分計算は行わない。
 *
 * エリア・接続口・シャッターも同じトランザクションで置き換える。
 */
export function replaceLayoutContents(db: Db, layoutId: string, contents: LayoutContents): void {
  const { objects, locations } = contents;
  const areas = contents.areas ?? [];
  const connections = contents.connections ?? [];
  const shutters = contents.shutters ?? [];

  transaction(db, () => {
    db.prepare('DELETE FROM layout_objects WHERE layout_id = ?').run(layoutId);
    db.prepare('DELETE FROM locations WHERE layout_id = ?').run(layoutId);
    db.prepare('DELETE FROM shutters WHERE layout_id = ?').run(layoutId);
    db.prepare('DELETE FROM area_connections WHERE layout_id = ?').run(layoutId);
    db.prepare('DELETE FROM areas WHERE layout_id = ?').run(layoutId);

    const insertArea = db.prepare(
      `INSERT INTO areas (${AREA_COLUMNS.join(', ')})
       VALUES (${AREA_COLUMNS.map(() => '?').join(', ')})`,
    );
    for (const area of areas) {
      insertArea.run(...toSqlValues(areaToRow({ ...area, layoutId }), AREA_COLUMNS));
    }

    const insertConnection = db.prepare(
      `INSERT INTO area_connections (${CONNECTION_COLUMNS.join(', ')})
       VALUES (${CONNECTION_COLUMNS.map(() => '?').join(', ')})`,
    );
    for (const connection of connections) {
      insertConnection.run(
        ...toSqlValues(connectionToRow({ ...connection, layoutId }), CONNECTION_COLUMNS),
      );
    }

    const connectionIds = new Set(connections.map((c) => c.id));
    const insertShutter = db.prepare(
      `INSERT INTO shutters (${SHUTTER_COLUMNS.join(', ')})
       VALUES (${SHUTTER_COLUMNS.map(() => '?').join(', ')})`,
    );
    for (const shutter of shutters) {
      // 接続口が消えたシャッターは一緒に破棄する
      if (!connectionIds.has(shutter.connectionId)) continue;
      insertShutter.run(...toSqlValues(shutterToRow(shutter, layoutId), SHUTTER_COLUMNS));
    }

    const insertObject = db.prepare(
      `INSERT INTO layout_objects (${OBJECT_COLUMNS.join(', ')})
       VALUES (${OBJECT_COLUMNS.map(() => '?').join(', ')})`,
    );
    for (const obj of objects) {
      insertObject.run(...toSqlValues(layoutObjectToRow({ ...obj, layoutId }), OBJECT_COLUMNS));
    }

    const insertLocation = db.prepare(
      `INSERT INTO locations (${LOCATION_COLUMNS.join(', ')})
       VALUES (${LOCATION_COLUMNS.map(() => '?').join(', ')})`,
    );
    for (const loc of locations) {
      insertLocation.run(...toSqlValues(locationToRow({ ...loc, layoutId }), LOCATION_COLUMNS));
    }

    db.prepare('UPDATE layouts SET updated_at = ? WHERE id = ?').run(nowIso(), layoutId);
    const layout = getLayout(db, layoutId);
    if (layout) {
      db.prepare('UPDATE warehouses SET updated_at = ? WHERE id = ?').run(nowIso(), layout.warehouseId);
    }
  });
}

/**
 * レイアウトを複製する (レイアウト比較用)。
 * オブジェクト・エリア・接続口・シャッターの ID を振り直し、参照も付け替える。
 */
export function cloneLayout(db: Db, sourceLayoutId: string, name: string): LayoutSnapshot | undefined {
  const source = getSnapshot(db, sourceLayoutId);
  if (!source) return undefined;

  const newLayout: Layout = {
    id: createId('lay'),
    warehouseId: source.layout.warehouseId,
    name,
    clonedFromId: source.layout.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const areaIdMap = new Map<string, string>();
  const areas = source.areas.map((area) => {
    const newId = createId('area');
    areaIdMap.set(area.id, newId);
    return { ...area, id: newId, layoutId: newLayout.id };
  });

  const connectionIdMap = new Map<string, string>();
  const connections = source.connections.map((connection) => {
    const newId = createId('conn');
    connectionIdMap.set(connection.id, newId);
    return {
      ...connection,
      id: newId,
      layoutId: newLayout.id,
      fromAreaId: areaIdMap.get(connection.fromAreaId) ?? connection.fromAreaId,
      toAreaId: areaIdMap.get(connection.toAreaId) ?? connection.toAreaId,
    };
  });

  const shutters = source.shutters.map((shutter) => ({
    ...shutter,
    id: createId('sht'),
    connectionId: connectionIdMap.get(shutter.connectionId) ?? shutter.connectionId,
  }));

  const idMap = new Map<string, string>();
  const objects = source.objects.map((obj) => {
    const newId = createId(obj.kind === 'forklift' ? 'fl' : obj.kind === 'rack' ? 'rack' : 'obj');
    idMap.set(obj.id, newId);
    return {
      ...obj,
      id: newId,
      layoutId: newLayout.id,
      ...(obj.areaId ? { areaId: areaIdMap.get(obj.areaId) ?? obj.areaId } : {}),
    };
  });
  const locations = source.locations.map((loc) => ({
    ...loc,
    id: createId('loc'),
    layoutId: newLayout.id,
    rackId: idMap.get(loc.rackId) ?? loc.rackId,
    ...(loc.areaId ? { areaId: areaIdMap.get(loc.areaId) ?? loc.areaId } : {}),
  }));

  insertLayout(db, newLayout);
  replaceLayoutContents(db, newLayout.id, { objects, locations, areas, connections, shutters });
  return { warehouse: source.warehouse, layout: newLayout, areas, connections, shutters, objects, locations };
}

/* ------------------------------------------------------------ マスタ管理 */

export function listRackTypes(db: Db, warehouseId: string): RackType[] {
  const rows = db
    .prepare('SELECT * FROM rack_types WHERE warehouse_id = ? ORDER BY category ASC, code ASC')
    .all(warehouseId) as Row[];
  return rows.map(rowToRackType);
}

const RACK_TYPE_COLUMNS = [
  'id', 'warehouse_id', 'code', 'name', 'category', 'width_m', 'depth_m', 'height_m',
  'levels', 'units_per_level', 'max_units', 'max_load_kg', 'max_stack_when_loaded',
  'max_stack_when_empty', 'color',
] as const;

const PRODUCT_SIZE_COLUMNS = [
  'id', 'warehouse_id', 'code', 'name', 'rack_category', 'units_per_rack', 'weight_per_unit_kg',
  'inbound_ratio_pct', 'outbound_ratio_pct', 'turnover', 'preferred_area_tag', 'inbound_gate_object_id',
] as const;

/** ラック種別マスタを全置換する。 */
export function replaceRackTypes(db: Db, warehouseId: string, types: readonly RackType[]): RackType[] {
  transaction(db, () => {
    db.prepare('DELETE FROM rack_types WHERE warehouse_id = ?').run(warehouseId);
    const insert = db.prepare(
      `INSERT INTO rack_types (${RACK_TYPE_COLUMNS.join(', ')})
       VALUES (${RACK_TYPE_COLUMNS.map(() => '?').join(', ')})`,
    );
    for (const type of types) {
      insert.run(...toSqlValues(rackTypeToRow({ ...type, warehouseId }), RACK_TYPE_COLUMNS));
    }
  });
  return listRackTypes(db, warehouseId);
}

export function listProductSizes(db: Db, warehouseId: string): ProductSize[] {
  const rows = db
    .prepare('SELECT * FROM product_sizes WHERE warehouse_id = ? ORDER BY code ASC')
    .all(warehouseId) as Row[];
  return rows.map(rowToProductSize);
}

/** 商品サイズマスタを全置換する。 */
export function replaceProductSizes(
  db: Db,
  warehouseId: string,
  sizes: readonly ProductSize[],
): ProductSize[] {
  transaction(db, () => {
    db.prepare('DELETE FROM product_sizes WHERE warehouse_id = ?').run(warehouseId);
    const insert = db.prepare(
      `INSERT INTO product_sizes (${PRODUCT_SIZE_COLUMNS.join(', ')})
       VALUES (${PRODUCT_SIZE_COLUMNS.map(() => '?').join(', ')})`,
    );
    for (const size of sizes) {
      insert.run(...toSqlValues(productSizeToRow({ ...size, warehouseId }), PRODUCT_SIZE_COLUMNS));
    }
  });
  return listProductSizes(db, warehouseId);
}
