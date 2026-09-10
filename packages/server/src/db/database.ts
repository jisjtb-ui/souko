import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * SQLite (Node 標準の node:sqlite) を初期ストレージとして使用する。
 *
 * 将来 PostgreSQL へ移行できるよう、
 *  - SQL は標準的な構文に限定する (SQLite 固有の UPSERT 構文などは使わない)
 *  - アプリ側は必ず repositories 経由でアクセスする
 * という方針を守っている。
 */

export type Db = DatabaseSync;

let instance: Db | undefined;

/** インメモリ指定はパス解決せずそのまま渡す (テスト用)。 */
function isMemoryTarget(file: string): boolean {
  return file === ':memory:' || file.startsWith('file::memory:');
}

export function openDatabase(file: string): Db {
  const memory = isMemoryTarget(file);
  const path = memory ? file : resolve(file);
  if (!memory) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export function getDb(): Db {
  if (!instance) throw new Error('Database has not been initialised');
  return instance;
}

export function initDb(file: string): Db {
  instance = openDatabase(file);
  return instance;
}

/** 単純な逐次マイグレーション。user_version で適用済みを管理する。 */
const MIGRATIONS: string[] = [
  // 001 — 倉庫・レイアウト・配置オブジェクト・ロケーション
  `
  CREATE TABLE warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    width_m REAL NOT NULL,
    depth_m REAL NOT NULL,
    pixels_per_meter REAL NOT NULL DEFAULT 8,
    grid_size_m REAL NOT NULL DEFAULT 1,
    speed_limit_kmh REAL NOT NULL DEFAULT 8,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE layouts (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    cloned_from_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_layouts_warehouse ON layouts(warehouse_id);

  CREATE TABLE layout_objects (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width_m REAL NOT NULL,
    depth_m REAL NOT NULL,
    rotation_deg REAL NOT NULL DEFAULT 0,
    z INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    note TEXT,
    traversable INTEGER,
    is_dock_point INTEGER,
    props TEXT
  );
  CREATE INDEX idx_objects_layout ON layout_objects(layout_id);

  CREATE TABLE locations (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    rack_id TEXT NOT NULL,
    code TEXT NOT NULL,
    column_no INTEGER NOT NULL,
    level_no INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    approach_x REAL NOT NULL,
    approach_y REAL NOT NULL,
    width_m REAL NOT NULL,
    depth_m REAL NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    blocked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_locations_layout ON locations(layout_id);
  CREATE INDEX idx_locations_code ON locations(layout_id, code);
  CREATE INDEX idx_locations_rack ON locations(rack_id);
  `,
  // 002 — 商品マスタ・在庫 (Phase 2)
  `
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    jan_code TEXT,
    category TEXT,
    width_m REAL NOT NULL DEFAULT 0,
    depth_m REAL NOT NULL DEFAULT 0,
    height_m REAL NOT NULL DEFAULT 0,
    weight_kg REAL NOT NULL DEFAULT 0,
    turnover TEXT NOT NULL DEFAULT 'medium',
    units_per_pallet INTEGER NOT NULL DEFAULT 1,
    note TEXT
  );
  CREATE INDEX idx_products_warehouse ON products(warehouse_id);
  CREATE INDEX idx_products_code ON products(warehouse_id, code);

  CREATE TABLE inventory (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    location_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    stored_at TEXT,
    lot_no TEXT
  );
  CREATE INDEX idx_inventory_layout ON inventory(layout_id);
  CREATE INDEX idx_inventory_location ON inventory(location_id);
  `,
  // 003 — 入出庫オーダー・シミュレーション結果 (Phase 4 以降)
  `
  CREATE TABLE inbound_orders (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    gate_object_id TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    lines TEXT NOT NULL
  );
  CREATE INDEX idx_inbound_layout ON inbound_orders(layout_id);

  CREATE TABLE outbound_orders (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    gate_object_id TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    priority INTEGER NOT NULL DEFAULT 0,
    lines TEXT NOT NULL
  );
  CREATE INDEX idx_outbound_layout ON outbound_orders(layout_id);

  CREATE TABLE simulations (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    metrics TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_simulations_layout ON simulations(layout_id);

  CREATE TABLE simulation_events (
    id TEXT PRIMARY KEY,
    simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    at_sec REAL NOT NULL,
    at_clock TEXT NOT NULL,
    type TEXT NOT NULL,
    forklift_id TEXT,
    task_id TEXT,
    order_id TEXT,
    location_code TEXT,
    product_id TEXT,
    quantity INTEGER,
    message TEXT NOT NULL
  );
  CREATE INDEX idx_events_sim ON simulation_events(simulation_id, at_sec);
  `,
  // 004 — 複数エリア構成 (自由形状の倉庫) とラック種別・商品サイズマスタ
  `
  CREATE TABLE areas (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    warehouse_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'rect',
    kind TEXT NOT NULL DEFAULT 'building',
    polygon TEXT NOT NULL,
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    rotation_deg REAL NOT NULL DEFAULT 0,
    z INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    metadata TEXT
  );
  CREATE INDEX idx_areas_layout ON areas(layout_id);

  CREATE TABLE area_connections (
    id TEXT PRIMARY KEY,
    layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    warehouse_id TEXT NOT NULL,
    name TEXT NOT NULL,
    from_area_id TEXT NOT NULL,
    to_area_id TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width_m REAL NOT NULL,
    span_m REAL NOT NULL,
    rotation_deg REAL NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'opening',
    passable INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_connections_layout ON area_connections(layout_id);

  CREATE TABLE shutters (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open'
  );
  CREATE INDEX idx_shutters_layout ON shutters(layout_id);

  ALTER TABLE layout_objects ADD COLUMN area_id TEXT;
  ALTER TABLE locations ADD COLUMN area_id TEXT;

  CREATE TABLE rack_types (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    width_m REAL NOT NULL,
    depth_m REAL NOT NULL,
    height_m REAL NOT NULL,
    levels INTEGER NOT NULL,
    units_per_level INTEGER NOT NULL,
    max_units INTEGER NOT NULL,
    max_load_kg REAL NOT NULL,
    max_stack_when_loaded INTEGER NOT NULL DEFAULT 1,
    max_stack_when_empty INTEGER NOT NULL DEFAULT 4,
    color TEXT
  );
  CREATE INDEX idx_rack_types_warehouse ON rack_types(warehouse_id);

  CREATE TABLE product_sizes (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    rack_category TEXT NOT NULL,
    units_per_rack INTEGER NOT NULL,
    weight_per_unit_kg REAL NOT NULL,
    inbound_ratio_pct REAL NOT NULL DEFAULT 0,
    outbound_ratio_pct REAL NOT NULL DEFAULT 0,
    turnover TEXT NOT NULL DEFAULT 'medium',
    preferred_area_tag TEXT,
    inbound_gate_object_id TEXT
  );
  CREATE INDEX idx_product_sizes_warehouse ON product_sizes(warehouse_id);
  `,
];

export function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = Number(row?.user_version ?? 0);

  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${version + 1} failed: ${(error as Error).message}`);
    }
  }
}

/** 複数の書き込みをまとめて実行する。 */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
