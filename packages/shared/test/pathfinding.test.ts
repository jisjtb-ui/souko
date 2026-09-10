import { describe, expect, it } from 'vitest';
import {
  NavGrid,
  createLayoutObject,
  createSampleWarehouse,
  estimateTravel,
  findPath,
  advanceAlongPath,
  segmentTravelSeconds,
  kmhToMps,
} from '../src/index.js';
import type { LayoutObject } from '../src/index.js';

const WH = { widthM: 20, depthM: 20 };

describe('NavGrid', () => {
  it('障害物をクリアランス分だけ膨張させる', () => {
    const wall = createLayoutObject({ layoutId: 'l', kind: 'wall', x: 10, y: 0, widthM: 1, depthM: 10 });
    const grid = NavGrid.fromLayout(WH, [wall], { cellM: 0.5, clearanceM: 0.5 });
    expect(grid.isBlocked(...cell(grid, 10.5, 5))).toBe(true);
    expect(grid.isBlocked(...cell(grid, 9.7, 5))).toBe(true); // 膨張分
    expect(grid.isBlocked(...cell(grid, 8, 5))).toBe(false);
  });

  it('通行可能エリアは塞がない', () => {
    const area = createLayoutObject({ layoutId: 'l', kind: 'shipping-area', x: 2, y: 2, widthM: 5, depthM: 5 });
    const grid = NavGrid.fromLayout(WH, [area], { cellM: 0.5, clearanceM: 0.5 });
    expect(grid.isBlocked(...cell(grid, 4, 4))).toBe(false);
  });

  it('歩行者エリアは通行コストが上がる', () => {
    const ped = createLayoutObject({ layoutId: 'l', kind: 'pedestrian-area', x: 2, y: 2, widthM: 5, depthM: 5 });
    const grid = NavGrid.fromLayout(WH, [ped], { cellM: 0.5, clearanceM: 0 });
    expect(grid.costAt(...cell(grid, 4, 4))).toBeGreaterThan(1);
  });

  it('倉庫外は範囲外として扱う', () => {
    const grid = NavGrid.fromLayout(WH, [], { cellM: 0.5, clearanceM: 0 });
    expect(grid.isBlocked(...cell(grid, 25, 5))).toBe(true);
  });
});

function cell(grid: NavGrid, x: number, y: number): [number, number] {
  const c = grid.worldToCell({ x, y });
  return [c.cx, c.cy];
}

describe('findPath', () => {
  it('障害物がなければほぼ直線', () => {
    const grid = NavGrid.fromLayout(WH, [], { cellM: 0.5, clearanceM: 0 });
    const path = findPath(grid, { x: 1, y: 1 }, { x: 18, y: 18 });
    expect(path.found).toBe(true);
    expect(path.lengthM).toBeCloseTo(Math.hypot(17, 17), 0);
    expect(path.points.length).toBe(2);
  });

  it('壁を迂回する', () => {
    // 上端から y=15 まで伸びる壁。下側 (y>15) を回るしかない。
    const wall = createLayoutObject({ layoutId: 'l', kind: 'wall', x: 9.5, y: 0, widthM: 1, depthM: 15 });
    const grid = NavGrid.fromLayout(WH, [wall], { cellM: 0.25, clearanceM: 0.3 });
    const path = findPath(grid, { x: 5, y: 2 }, { x: 15, y: 2 });
    expect(path.found).toBe(true);
    expect(path.lengthM).toBeGreaterThan(20);
    // 経路上のすべての点が壁を通過していないこと
    for (let i = 1; i < path.points.length; i++) {
      expect(grid.hasLineOfSight(path.points[i - 1]!, path.points[i]!)).toBe(true);
    }
    // 壁の下側を通っている
    expect(Math.max(...path.points.map((p) => p.y))).toBeGreaterThan(15);
  });

  it('到達不能なら found=false', () => {
    const objs: LayoutObject[] = [
      createLayoutObject({ layoutId: 'l', kind: 'wall', x: 10, y: 0, widthM: 0.5, depthM: 20 }),
    ];
    const grid = NavGrid.fromLayout(WH, objs, { cellM: 0.5, clearanceM: 0.2 });
    const path = findPath(grid, { x: 5, y: 10 }, { x: 15, y: 10 }, { snapRadiusM: 1 });
    expect(path.found).toBe(false);
  });

  it('ラック内の作業位置は近傍の通路へスナップされる', () => {
    const rack = createLayoutObject({ layoutId: 'l', kind: 'rack', x: 5, y: 5, widthM: 6, depthM: 1.2 });
    const grid = NavGrid.fromLayout(WH, [rack], { cellM: 0.25, clearanceM: 0.5 });
    const path = findPath(grid, { x: 1, y: 1 }, { x: 8, y: 5.6 });
    expect(path.found).toBe(true);
    expect(path.points.length).toBeGreaterThan(1);
  });

  it('サンプル倉庫で入庫エリアから最奥のラックまで経路が引ける', () => {
    const { warehouse, objects, locations } = createSampleWarehouse();
    const grid = NavGrid.fromLayout(warehouse, objects, { cellM: 0.5, clearanceM: 0.6 });
    const target = locations.find((l) => l.code.startsWith('F-10'))!;
    const path = findPath(grid, { x: 9, y: 5 }, { x: target.approachX, y: target.approachY });
    expect(path.found).toBe(true);
    expect(path.lengthM).toBeGreaterThan(10);
  });
});

describe('travel', () => {
  it('台形プロファイルの走行時間', () => {
    // 巡航2m/s, a=d=1m/s^2 -> 加速2秒(2m) + 定速48秒(96m) + 減速2秒(2m) = 52秒
    expect(segmentTravelSeconds(100, 2, 1, 1)).toBeCloseTo(52, 3);
  });

  it('短距離では最大速度に達しない (三角プロファイル)', () => {
    const t = segmentTravelSeconds(1, 10, 1, 1);
    expect(t).toBeCloseTo(2, 3); // peak=1m/s -> 1+1
  });

  it('速度を上げると所要時間が短くなる', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const slow = estimateTravel(points, { maxSpeedKmh: 2, accelMps2: 0.6, decelMps2: 0.8 });
    const fast = estimateTravel(points, { maxSpeedKmh: 10, accelMps2: 0.6, decelMps2: 0.8 });
    expect(fast.seconds).toBeLessThan(slow.seconds);
    expect(fast.distanceM).toBeCloseTo(100);
  });

  it('制限速度超過を記録する', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const r = estimateTravel(points, { maxSpeedKmh: 12, accelMps2: 1, decelMps2: 1, speedLimitKmh: 8 });
    expect(r.violationMeters).toBeGreaterThan(0);
    expect(r.violationSeconds).toBeGreaterThan(0);

    const ok = estimateTravel(points, { maxSpeedKmh: 8, accelMps2: 1, decelMps2: 1, speedLimitKmh: 8 });
    expect(ok.violationMeters).toBe(0);
  });

  it('方向転換を数える', () => {
    const r = estimateTravel(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      { maxSpeedKmh: 8, accelMps2: 1, decelMps2: 1, turnPenaltySeconds: 2 },
    );
    expect(r.turns).toBe(1);
  });
});

describe('advanceAlongPath', () => {
  it('指定距離だけ経路上を進む', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const step1 = advanceAlongPath(points, { x: 0, y: 0 }, 1, 5);
    expect(step1.position.x).toBeCloseTo(5);
    expect(step1.finished).toBe(false);
    expect(step1.headingDeg).toBeCloseTo(0);

    const step2 = advanceAlongPath(points, step1.position, step1.index, 10);
    expect(step2.position).toEqual({ x: 10, y: 5 });
    expect(step2.headingDeg).toBeCloseTo(90);

    const step3 = advanceAlongPath(points, step2.position, step2.index, 99);
    expect(step3.finished).toBe(true);
    expect(step3.position).toEqual({ x: 10, y: 10 });
  });
});

describe('kmhToMps', () => {
  it('8km/h は約2.22m/s', () => {
    expect(kmhToMps(8)).toBeCloseTo(2.222, 3);
  });
});
