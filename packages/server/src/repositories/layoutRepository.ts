import { createId } from '@ws/shared';
import type { Layout, LayoutObject, LayoutSnapshot, Location, Warehouse } from '@ws/shared';
import { transaction, type Db } from '../db/database.js';
import {
  layoutObjectToRow,
  locationToRow,
  rowToLayout,
  rowToLayoutObject,
  rowToLocation,
  rowToWarehouse,
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

/** レイアウト1件分をまとめて取得する。 */
export function getSnapshot(db: Db, layoutId: string): LayoutSnapshot | undefined {
  const layout = getLayout(db, layoutId);
  if (!layout) return undefined;
  const warehouse = getWarehouse(db, layout.warehouseId);
  if (!warehouse) return undefined;
  return {
    warehouse,
    layout,
    objects: listObjects(db, layoutId),
    locations: listLocations(db, layoutId),
  };
}

const OBJECT_COLUMNS = [
  'id',
  'layout_id',
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

type SqlValue = string | number | null;

function toSqlValues(row: Row, columns: readonly string[]): SqlValue[] {
  return columns.map((c) => {
    const v = row[c];
    if (v === undefined || v === null) return null;
    if (typeof v === 'number' || typeof v === 'string') return v;
    return String(v);
  });
}

/**
 * レイアウトの配置内容を丸ごと置き換える (保存操作)。
 * エディタ側の状態をそのまま真実として扱うので、差分計算は行わない。
 */
export function replaceLayoutContents(
  db: Db,
  layoutId: string,
  objects: readonly LayoutObject[],
  locations: readonly Location[],
): void {
  transaction(db, () => {
    db.prepare('DELETE FROM layout_objects WHERE layout_id = ?').run(layoutId);
    db.prepare('DELETE FROM locations WHERE layout_id = ?').run(layoutId);

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

/** レイアウトを複製する (レイアウト比較用)。オブジェクトIDは振り直す。 */
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

  const idMap = new Map<string, string>();
  const objects = source.objects.map((obj) => {
    const newId = createId(obj.kind === 'forklift' ? 'fl' : obj.kind === 'rack' ? 'rack' : 'obj');
    idMap.set(obj.id, newId);
    return { ...obj, id: newId, layoutId: newLayout.id };
  });
  const locations = source.locations.map((loc) => ({
    ...loc,
    id: createId('loc'),
    layoutId: newLayout.id,
    rackId: idMap.get(loc.rackId) ?? loc.rackId,
  }));

  insertLayout(db, newLayout);
  replaceLayoutContents(db, newLayout.id, objects, locations);
  return { warehouse: source.warehouse, layout: newLayout, objects, locations };
}
