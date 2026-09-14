import { describe, expect, it } from 'vitest';
import {
  createLayoutObject,
  findDuplicateCodes,
  formatLocationCode,
  generateLocationsForRack,
  previewLocationCodes,
  validateNamingRule,
  createNamingRule,
  laneDepthOf,
  DEFAULT_LANE_DEPTH,
} from '../src/index.js';
import type { RackObject } from '../src/index.js';

function makeRack(overrides: Parameters<typeof createLayoutObject>[0]['rack'] = {}, pos = { x: 10, y: 20 }): RackObject {
  return createLayoutObject({
    layoutId: 'lay_1',
    kind: 'rack',
    x: pos.x,
    y: pos.y,
    widthM: 8,
    depthM: 1.2,
    rack: overrides,
  }) as RackObject;
}

describe('formatLocationCode', () => {
  it('ゼロ埋めしてトークンを置換する', () => {
    const rule = createNamingRule('A');
    expect(
      formatLocationCode(rule, { area: 'A', column: 3, level: 2, columnDigits: 2, levelDigits: 2, index: 1 }),
    ).toBe('A-03-02');
  });

  it('パターンを変更できる', () => {
    const rule = createNamingRule('B', { pattern: '{area}{column}F{level}', columnDigits: 3, levelDigits: 1 });
    expect(
      formatLocationCode(rule, { area: 'B', column: 12, level: 4, columnDigits: 3, levelDigits: 1, index: 1 }),
    ).toBe('B012F4');
  });
});

describe('generateLocationsForRack', () => {
  it('列数 x 段数 のロケーションを生成する', () => {
    const rack = makeRack({ columns: 4, levels: 3 });
    const locs = generateLocationsForRack(rack);
    expect(locs).toHaveLength(12);
    expect(new Set(locs.map((l) => l.code)).size).toBe(12);
    expect(locs[0]!.code).toBe('A-01-01');
    expect(locs.at(-1)!.code).toBe('A-04-03');
  });

  it('間口の中心座標を計算する', () => {
    const rack = makeRack({ columns: 4, levels: 1 }, { x: 10, y: 20 });
    const locs = generateLocationsForRack(rack);
    // 幅8m / 4列 -> 間口2m, 最初の間口の中心は x=11
    expect(locs[0]!.x).toBeCloseTo(11);
    expect(locs[0]!.y).toBeCloseTo(20.6);
    expect(locs[3]!.x).toBeCloseTo(17);
  });

  it('作業位置はピッキング面の外側に取る', () => {
    const front = generateLocationsForRack(makeRack({ columns: 1, levels: 1, face: 'front' }));
    expect(front[0]!.approachY).toBeCloseTo(20 - 1.2);

    const back = generateLocationsForRack(makeRack({ columns: 1, levels: 1, face: 'back' }));
    expect(back[0]!.approachY).toBeCloseTo(20 + 1.2 + 1.2);
  });

  it('回転したラックでも座標が追従する', () => {
    const rack = makeRack({ columns: 2, levels: 1 });
    rack.rotationDeg = 90;
    const locs = generateLocationsForRack(rack);
    // 90度回転 -> ローカル +X はワールド +Y 方向
    expect(locs[0]!.x).toBeCloseTo(10 - 0.6);
    expect(locs[0]!.y).toBeCloseTo(20 + 2);
  });

  it('採番の向きを逆にできる', () => {
    const rack = makeRack({ columns: 3, levels: 2, naming: { columnOrder: 'desc', levelOrder: 'top-down' } });
    const locs = generateLocationsForRack(rack);
    expect(locs[0]!.code).toBe('A-03-02');
  });
});

describe('validateNamingRule', () => {
  it('番号が重複するパターンを弾く', () => {
    expect(validateNamingRule(createNamingRule('A', { pattern: '{area}' })).length).toBeGreaterThan(0);
    expect(validateNamingRule(createNamingRule('A'))).toHaveLength(0);
  });
});

describe('findDuplicateCodes', () => {
  it('同じエリア記号のラックが2本あると重複を検出する', () => {
    const a = generateLocationsForRack(makeRack({ columns: 2, levels: 1 }));
    const b = generateLocationsForRack(makeRack({ columns: 2, levels: 1 }));
    expect(findDuplicateCodes([...a, ...b]).size).toBe(2);
  });
});

describe('previewLocationCodes', () => {
  it('先頭数件だけ返す', () => {
    expect(previewLocationCodes(createNamingRule('C'), 10, 4, 3)).toEqual(['C-01-01', 'C-01-02', 'C-01-03']);
  });
});

describe('laneDepthOf', () => {
  it('laneDepth 未設定の既存ラックは 1 として扱う（従来の挙動）', () => {
    const rack = makeRack();
    expect(rack.rack.laneDepth).toBeUndefined();
    expect(laneDepthOf(rack.rack)).toBe(DEFAULT_LANE_DEPTH);
    expect(laneDepthOf(rack.rack)).toBe(1);
  });

  it('設定された奥行きレーン数をそのまま返す', () => {
    expect(laneDepthOf({ ...makeRack().rack, laneDepth: 5 })).toBe(5);
    expect(laneDepthOf({ ...makeRack().rack, laneDepth: 16 })).toBe(16);
  });

  it('不正な値は 1 以上の整数に丸める', () => {
    expect(laneDepthOf({ ...makeRack().rack, laneDepth: 0 })).toBe(1);
    expect(laneDepthOf({ ...makeRack().rack, laneDepth: -3 })).toBe(1);
    expect(laneDepthOf({ ...makeRack().rack, laneDepth: 3.7 })).toBe(3);
    expect(laneDepthOf({ ...makeRack().rack, laneDepth: Number.NaN })).toBe(1);
  });

  it('laneDepth はロケーション生成に影響しない（列×段のまま）', () => {
    const base = makeRack({ columns: 4, levels: 3 });
    const deep = makeRack({ columns: 4, levels: 3 });
    deep.rack.laneDepth = 7;

    const a = generateLocationsForRack(base);
    const b = generateLocationsForRack(deep);
    expect(a.length).toBe(12);
    expect(b.length).toBe(a.length);
    expect(b.map((l) => l.code)).toEqual(a.map((l) => l.code));
  });
});
