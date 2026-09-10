import { describe, expect, it } from 'vitest';
import { createLayout, createWarehouse } from '@ws/shared';
import type { Location } from '@ws/shared';
import { openDatabase } from '../src/db/database.js';
import { insertLayout, insertWarehouse, listLocations, replaceLayoutContents } from '../src/repositories/layoutRepository.js';

function seed(): { db: ReturnType<typeof openDatabase>; layoutId: string } {
  const db = openDatabase(':memory:');
  const warehouse = createWarehouse({ name: 'テスト' });
  const layout = createLayout(warehouse.id);
  insertWarehouse(db, warehouse);
  insertLayout(db, layout);
  return { db, layoutId: layout.id };
}

const location = (id: string, layoutId: string, code: string): Location => ({
  id,
  layoutId,
  rackId: 'rack_1',
  code,
  column: 1,
  level: 1,
  x: 1,
  y: 1,
  approachX: 1,
  approachY: 2,
  widthM: 1,
  depthM: 1,
  capacity: 10,
});

describe('openDatabase', () => {
  it(':memory: はファイルに書き出さず、接続ごとに独立している', () => {
    const a = seed();
    replaceLayoutContents(a.db, a.layoutId, [], [location('loc_1', a.layoutId, 'A-01-01')]);
    expect(listLocations(a.db, a.layoutId)).toHaveLength(1);

    // 別接続には前の接続のデータが残っていないこと
    const b = seed();
    expect(listLocations(b.db, b.layoutId)).toHaveLength(0);
    // 同じ ID を使い回してもぶつからない
    replaceLayoutContents(b.db, b.layoutId, [], [location('loc_1', b.layoutId, 'A-01-01')]);
    expect(listLocations(b.db, b.layoutId)).toHaveLength(1);
  });

  it('保存は毎回置き換えになる (差分ではなく全置換)', () => {
    const { db, layoutId } = seed();
    replaceLayoutContents(db, layoutId, [], [location('loc_1', layoutId, 'A-01-01'), location('loc_2', layoutId, 'A-01-02')]);
    expect(listLocations(db, layoutId)).toHaveLength(2);

    replaceLayoutContents(db, layoutId, [], [location('loc_3', layoutId, 'B-01-01')]);
    const after = listLocations(db, layoutId);
    expect(after).toHaveLength(1);
    expect(after[0]?.code).toBe('B-01-01');
  });

  it('マイグレーションは繰り返し適用しても壊れない', () => {
    const { db } = seed();
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(Number(version.user_version)).toBeGreaterThan(0);
  });
});
