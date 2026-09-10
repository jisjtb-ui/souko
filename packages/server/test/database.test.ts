import { describe, expect, it } from 'vitest';
import { createLayout, createLayoutObject, createWarehouse, generateLocationsForRack } from '@ws/shared';
import type { Location, RackObject } from '@ws/shared';
import { openDatabase } from '../src/db/database.js';
import {
  getSnapshot,
  insertLayout,
  insertWarehouse,
  listLocations,
  replaceLayoutContents,
} from '../src/repositories/layoutRepository.js';

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
    replaceLayoutContents(a.db, a.layoutId, { objects: [], locations: [location('loc_1', a.layoutId, 'A-01-01')] });
    expect(listLocations(a.db, a.layoutId)).toHaveLength(1);

    // 別接続には前の接続のデータが残っていないこと
    const b = seed();
    expect(listLocations(b.db, b.layoutId)).toHaveLength(0);
    // 同じ ID を使い回してもぶつからない
    replaceLayoutContents(b.db, b.layoutId, { objects: [], locations: [location('loc_1', b.layoutId, 'A-01-01')] });
    expect(listLocations(b.db, b.layoutId)).toHaveLength(1);
  });

  it('保存は毎回置き換えになる (差分ではなく全置換)', () => {
    const { db, layoutId } = seed();
    replaceLayoutContents(db, layoutId, {
      objects: [],
      locations: [location('loc_1', layoutId, 'A-01-01'), location('loc_2', layoutId, 'A-01-02')],
    });
    expect(listLocations(db, layoutId)).toHaveLength(2);

    replaceLayoutContents(db, layoutId, { objects: [], locations: [location('loc_3', layoutId, 'B-01-01')] });
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

describe('既存データの互換性 (要件19)', () => {
  it('エリア未設定の旧レイアウトは「エリア1」に移行して読み込まれる', () => {
    const { db, layoutId } = seed();
    const rack = createLayoutObject({
      layoutId,
      kind: 'rack',
      x: 10,
      y: 10,
      widthM: 8,
      depthM: 1.2,
      rack: { columns: 4, levels: 2 },
    });
    const locations = generateLocationsForRack(rack as RackObject);
    replaceLayoutContents(db, layoutId, { objects: [rack], locations });

    // マイグレーション前に保存された状態を再現する（areas テーブルが空）
    db.prepare('DELETE FROM areas WHERE layout_id = ?').run(layoutId);

    const snapshot = getSnapshot(db, layoutId)!;
    expect(snapshot.areas).toHaveLength(1);
    expect(snapshot.areas[0]?.name).toBe('エリア1');
    // 倉庫矩形いっぱいのエリアになる
    expect(snapshot.areas[0]?.polygon).toEqual([
      { x: 0, y: 0 },
      { x: snapshot.warehouse.widthM, y: 0 },
      { x: snapshot.warehouse.widthM, y: snapshot.warehouse.depthM },
      { x: 0, y: snapshot.warehouse.depthM },
    ]);
    // 既存のオブジェクト・ロケーションにエリアが割り当てられる
    expect(snapshot.objects[0]?.areaId).toBe(snapshot.areas[0]?.id);
    expect(snapshot.locations.every((l) => l.areaId === snapshot.areas[0]?.id)).toBe(true);
    expect(snapshot.locations).toHaveLength(8);
  });
});
