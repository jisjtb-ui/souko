import { describe, expect, it } from 'vitest';
import {
  NavGrid,
  areaSizeM2,
  areaWorldPolygon,
  areasBounds,
  assignAreaIds,
  assignLocationAreaIds,
  computeAreaStats,
  createArea,
  createConnection,
  createLayoutObject,
  createSampleWarehouse,
  createShutter,
  ensureDefaultArea,
  findAreaAt,
  findPath,
  generateLocationsForRack,
  isConnectionPassable,
  pointInArea,
  pointInConnection,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  suggestConnection,
  totalWarehouseArea,
  unionArea,
} from '../src/index.js';
import type { Area, RackObject, Shutter, Vec2 } from '../src/index.js';

/** 経路上で x = 指定値 になる点を求める（開口部を通過したかの検証用）。 */
function pointOnPathAtX(points: readonly Vec2[], x: number): Vec2 | undefined {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return { x, y: a.y + (b.y - a.y) * t };
    }
  }
  return undefined;
}

const WH = { id: 'wh_1', name: 'テスト', widthM: 60, depthM: 40 };
const L = 'lay_1';

function rectArea(name: string, x: number, y: number, w: number, d: number): Area {
  return createArea({ warehouseId: WH.id, layoutId: L, name, x, y, widthM: w, depthM: d });
}

describe('多角形の面積計算', () => {
  it('矩形の面積', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(50);
  });

  it('L字型の面積 (頂点座標から計算)', () => {
    // 20x20 の正方形から 10x10 を欠いたL字 = 300
    const lShape = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(polygonArea(lShape)).toBe(300);
    const centroid = polygonCentroid(lShape);
    expect(centroid.x).toBeGreaterThan(0);
    expect(pointInPolygon({ x: 5, y: 5 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 15 }, lShape)).toBe(false);
  });

  it('重なったエリアの総面積は二重計上しない', () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const b = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];
    // 単純合計は200、和集合は175
    expect(unionArea([a, b], 0.25)).toBeCloseTo(175, 0);
  });
});

describe('Area', () => {
  it('矩形エリアを作ると4頂点を持つ', () => {
    const area = rectArea('本棟', 10, 20, 30, 15);
    expect(area.type).toBe('rect');
    expect(area.polygon).toHaveLength(4);
    expect(areaSizeM2(area)).toBe(450);
    expect(areaWorldPolygon(area)[0]).toEqual({ x: 10, y: 20 });
  });

  it('多角形エリアを作れる', () => {
    const area = createArea({
      warehouseId: WH.id,
      layoutId: L,
      name: 'L字棟',
      x: 0,
      y: 0,
      polygon: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
    });
    expect(area.type).toBe('polygon');
    expect(areaSizeM2(area)).toBe(300);
    expect(pointInArea(area, { x: 5, y: 15 })).toBe(true);
    expect(pointInArea(area, { x: 15, y: 15 })).toBe(false);
  });

  it('回転したエリアでも面積は変わらない', () => {
    const area = rectArea('回転棟', 10, 10, 20, 10);
    area.rotationDeg = 37;
    expect(areaSizeM2(area)).toBe(200);
    const bounds = areasBounds([area]);
    expect(bounds.widthM).toBeGreaterThan(20);
  });

  it('座標からエリアを特定できる (重なりは z 優先)', () => {
    const a = rectArea('A', 0, 0, 20, 20);
    const b = rectArea('B', 10, 10, 20, 20);
    b.z = 1;
    expect(findAreaAt([a, b], { x: 5, y: 5 })?.name).toBe('A');
    expect(findAreaAt([a, b], { x: 25, y: 25 })?.name).toBe('B');
    expect(findAreaAt([a, b], { x: 15, y: 15 })?.name).toBe('B');
    expect(findAreaAt([a, b], { x: 50, y: 50 })).toBeUndefined();
  });

  it('既存の長方形倉庫はエリア1へ移行される', () => {
    const migrated = ensureDefaultArea(WH, L, []);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]!.name).toBe('エリア1');
    expect(areaSizeM2(migrated[0]!)).toBe(60 * 40);
    // すでにエリアがある場合はそのまま
    expect(ensureDefaultArea(WH, L, migrated)).toHaveLength(1);
  });
});

describe('オブジェクト・ロケーションのエリア所属', () => {
  it('中心座標からエリアが割り当てられる', () => {
    const areaA = rectArea('A棟', 0, 0, 30, 30);
    const areaB = rectArea('B棟', 40, 0, 30, 30);
    const rack = createLayoutObject({ layoutId: L, kind: 'rack', x: 5, y: 5, widthM: 8, depthM: 1.2 });
    const gate = createLayoutObject({ layoutId: L, kind: 'outbound-gate', x: 45, y: 10, widthM: 6, depthM: 4 });
    const outside = createLayoutObject({ layoutId: L, kind: 'pillar', x: 100, y: 100 });

    const assigned = assignAreaIds([rack, gate, outside], [areaA, areaB]);
    expect(assigned[0]!.areaId).toBe(areaA.id);
    expect(assigned[1]!.areaId).toBe(areaB.id);
    expect(assigned[2]!.areaId).toBeUndefined();

    const locations = assignLocationAreaIds(
      generateLocationsForRack(assigned[0] as RackObject),
      [areaA, areaB],
      assigned,
    );
    expect(locations.every((l) => l.areaId === areaA.id)).toBe(true);
  });

  it('エリアごとの集計が出せる', () => {
    const areaA = rectArea('A棟', 0, 0, 30, 30);
    const rack = createLayoutObject({ layoutId: L, kind: 'rack', x: 5, y: 5, widthM: 8, depthM: 1.2, rack: { columns: 4, levels: 2, capacityPerLocation: 10 } });
    const objects = assignAreaIds([rack], [areaA]);
    const locations = assignLocationAreaIds(generateLocationsForRack(objects[0] as RackObject), [areaA], objects);
    const stats = computeAreaStats(areaA, objects, locations);
    expect(stats.sizeM2).toBe(900);
    expect(stats.rackCount).toBe(1);
    expect(stats.locationCount).toBe(8);
    expect(stats.capacity).toBe(80);
  });

  it('倉庫総面積は全エリアの和集合', () => {
    const a = rectArea('A', 0, 0, 20, 20);
    const b = rectArea('B', 30, 0, 20, 20);
    expect(totalWarehouseArea([a, b])).toBeCloseTo(800, 0);
  });
});

describe('接続口とシャッター', () => {
  const areaA = rectArea('A棟', 0, 0, 20, 20);
  const areaB = rectArea('B棟', 24, 0, 20, 20);

  it('近接する2エリアの間に接続口を提案できる', () => {
    const suggestion = suggestConnection(areaA, areaB);
    expect(suggestion.x).toBeCloseTo(22, 0);
    expect(suggestion.distance).toBeCloseTo(4, 1);
    // 開口幅は結ぶ方向と直交する
    expect(Math.abs(suggestion.rotationDeg) % 180).toBeCloseTo(90, 0);
    expect(suggestion.spanM).toBeGreaterThan(4);
  });

  it('シャッターの状態で通行可否が変わる', () => {
    const conn = createConnection({
      warehouseId: WH.id,
      layoutId: L,
      fromAreaId: areaA.id,
      toAreaId: areaB.id,
      x: 22,
      y: 10,
      widthM: 4,
      spanM: 6,
      rotationDeg: 90,
    });
    const shutter = createShutter(conn.id);
    expect(isConnectionPassable(conn, [shutter])).toBe(true);

    const closed: Shutter[] = [{ ...shutter, state: 'closed' }];
    expect(isConnectionPassable(conn, closed)).toBe(false);

    // シャッターが無ければ接続口自体の passable に従う
    expect(isConnectionPassable(conn, [])).toBe(true);
    expect(isConnectionPassable({ ...conn, passable: false }, [])).toBe(false);
  });
});

describe('エリアをまたぐ経路探索', () => {
  const areaA = rectArea('A棟', 0, 0, 20, 20);
  const areaB = rectArea('B棟', 24, 0, 20, 20);
  const connection = createConnection({
    warehouseId: WH.id,
    layoutId: L,
    fromAreaId: areaA.id,
    toAreaId: areaB.id,
    x: 22,
    y: 10,
    widthM: 4,
    spanM: 6,
    rotationDeg: 90,
  });
  const warehouse = { widthM: 44, depthM: 20 };
  const gridOptions = { cellM: 0.5, clearanceM: 0.5 };

  it('エリア外は進入不可になる', () => {
    const grid = NavGrid.fromLayout(warehouse, [], {
      ...gridOptions,
      areas: [areaA, areaB],
      connections: [],
      shutters: [],
    });
    const gap = grid.worldToCell({ x: 22, y: 4 });
    expect(grid.isBlocked(gap.cx, gap.cy)).toBe(true);
    const inside = grid.worldToCell({ x: 10, y: 10 });
    expect(grid.isBlocked(inside.cx, inside.cy)).toBe(false);
  });

  it('接続口が無ければエリア間を移動できない', () => {
    const grid = NavGrid.fromLayout(warehouse, [], {
      ...gridOptions,
      areas: [areaA, areaB],
      connections: [],
      shutters: [],
    });
    const path = findPath(grid, { x: 5, y: 10 }, { x: 35, y: 10 }, { snapRadiusM: 1 });
    expect(path.found).toBe(false);
  });

  it('接続口があればエリアをまたいで経路が引ける', () => {
    const grid = NavGrid.fromLayout(warehouse, [], {
      ...gridOptions,
      areas: [areaA, areaB],
      connections: [connection],
      shutters: [],
    });
    const path = findPath(grid, { x: 5, y: 10 }, { x: 35, y: 10 });
    expect(path.found).toBe(true);
    // 経路が接続口の開口部を通っていること (x=22 の断面で確認)
    const crossing = pointOnPathAtX(path.points, 22);
    expect(crossing).toBeDefined();
    expect(pointInConnection(connection, crossing!)).toBe(true);
  });

  it('シャッターが閉じていると通行できない', () => {
    const shutter = createShutter(connection.id);
    const openGrid = NavGrid.fromLayout(warehouse, [], {
      ...gridOptions,
      areas: [areaA, areaB],
      connections: [connection],
      shutters: [shutter],
    });
    expect(findPath(openGrid, { x: 5, y: 10 }, { x: 35, y: 10 }).found).toBe(true);

    const closedGrid = NavGrid.fromLayout(warehouse, [], {
      ...gridOptions,
      areas: [areaA, areaB],
      connections: [connection],
      shutters: [{ ...shutter, state: 'closed' }],
    });
    expect(findPath(closedGrid, { x: 5, y: 10 }, { x: 35, y: 10 }, { snapRadiusM: 1 }).found).toBe(false);
  });

  it('隣接しているだけのエリアは壁で仕切られる', () => {
    // 隙間なく接している2エリア。接続口が無いので行き来できない。
    const left = rectArea('左', 0, 0, 20, 20);
    const right = rectArea('右', 20, 0, 20, 20);
    const grid = NavGrid.fromLayout({ widthM: 40, depthM: 20 }, [], {
      ...gridOptions,
      areas: [left, right],
      connections: [],
      shutters: [],
    });
    expect(findPath(grid, { x: 5, y: 10 }, { x: 35, y: 10 }, { snapRadiusM: 1 }).found).toBe(false);
  });

  it('サンプル倉庫では本棟から増築棟まで到達できる', () => {
    const sample = createSampleWarehouse();
    const grid = NavGrid.fromLayout(sample.warehouse, sample.objects, {
      cellM: 0.5,
      clearanceM: 0.6,
      areas: sample.areas,
      connections: sample.connections,
      shutters: sample.shutters,
    });
    const annexLocation = sample.locations.find((l) => l.code.startsWith('G-01'))!;
    const path = findPath(grid, { x: 9, y: 5 }, { x: annexLocation.approachX, y: annexLocation.approachY });
    expect(path.found).toBe(true);
    expect(path.lengthM).toBeGreaterThan(40);

    // シャッターを閉じると到達できなくなる
    const closedGrid = NavGrid.fromLayout(sample.warehouse, sample.objects, {
      cellM: 0.5,
      clearanceM: 0.6,
      areas: sample.areas,
      connections: sample.connections,
      shutters: sample.shutters.map((s) => ({ ...s, state: 'closed' as const })),
    });
    expect(
      findPath(closedGrid, { x: 9, y: 5 }, { x: annexLocation.approachX, y: annexLocation.approachY }, { snapRadiusM: 1 })
        .found,
    ).toBe(false);
  });
});
