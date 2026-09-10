import { createId } from '@ws/shared';
import type { Product } from '@ws/shared';
import { transaction, type Db } from '../db/database.js';
import { rowToProduct } from './mappers.js';

type Row = Record<string, unknown>;

export function listProducts(db: Db, warehouseId: string): Product[] {
  const rows = db
    .prepare('SELECT * FROM products WHERE warehouse_id = ? ORDER BY code ASC')
    .all(warehouseId) as Row[];
  return rows.map(rowToProduct);
}

function upsert(db: Db, product: Product): Product {
  db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
  db.prepare(
    `INSERT INTO products (id, warehouse_id, code, name, jan_code, category, width_m, depth_m, height_m,
      weight_kg, turnover, units_per_pallet, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    product.id,
    product.warehouseId,
    product.code,
    product.name,
    product.janCode ?? null,
    product.category ?? null,
    product.widthM,
    product.depthM,
    product.heightM,
    product.weightKg,
    product.turnover,
    product.unitsPerPallet,
    product.note ?? null,
  );
  return product;
}

export function saveProduct(db: Db, warehouseId: string, input: Partial<Product>): Product {
  const product: Product = {
    id: input.id ?? createId('prd'),
    warehouseId,
    code: input.code ?? '',
    name: input.name ?? '',
    ...(input.janCode ? { janCode: input.janCode } : {}),
    ...(input.category ? { category: input.category } : {}),
    widthM: input.widthM ?? 0,
    depthM: input.depthM ?? 0,
    heightM: input.heightM ?? 0,
    weightKg: input.weightKg ?? 0,
    turnover: input.turnover ?? 'medium',
    unitsPerPallet: input.unitsPerPallet ?? 1,
    ...(input.note ? { note: input.note } : {}),
  };
  return upsert(db, product);
}

/** CSV インポート用の一括登録。 */
export function saveProducts(db: Db, warehouseId: string, inputs: readonly Partial<Product>[]): Product[] {
  return transaction(db, () => inputs.map((input) => saveProduct(db, warehouseId, input)));
}

export function deleteProduct(db: Db, id: string): boolean {
  return Number(db.prepare('DELETE FROM products WHERE id = ?').run(id).changes) > 0;
}
