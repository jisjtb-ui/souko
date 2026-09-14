import { Random } from '../sim/random.js';
import type { LaneCapacityEntry } from './laneCapacity.js';
import { LANE_DEPTHS, buildCapacityIndex, capacityOf } from './laneCapacity.js';
import type { DeadPositionInput, Lane, LaneAssignment, DeadPositionStock } from './deadPosition.js';

/* ============================================================================
 * 死にポジション分析のサンプルデータ
 * ----------------------------------------------------------------------------
 * タイヤ倉庫を想定した架空のデータ。実レイアウトを読み込まなくても
 * 画面の動作を確認できるようにするためのもの。
 * Random は決定論的なので、何度作っても同じ結果になる。
 * ========================================================================== */

export interface SampleSize {
  id: string;
  code: string;
  /** 深さ1本あたりに入る本数 (深さ d のレーンなら d 倍) */
  unitsPerDepth: number;
  /** ピーク在庫本数 */
  peakUnits: number;
  /** 製造年週の内訳 */
  cohorts: { yearWeek: string; units: number }[];
}

export const SAMPLE_SIZES: readonly SampleSize[] = [
  {
    id: 'psz_195_65r15',
    code: '195/65R15',
    unitsPerDepth: 8,
    peakUnits: 730,
    cohorts: [
      { yearWeek: '2025-W08', units: 270 },
      { yearWeek: '2025-W21', units: 460 },
    ],
  },
  {
    id: 'psz_175_65r14',
    code: '175/65R14',
    unitsPerDepth: 9,
    peakUnits: 320,
    cohorts: [{ yearWeek: '2025-W14', units: 320 }],
  },
  {
    id: 'psz_205_55r16',
    code: '205/55R16',
    unitsPerDepth: 7,
    peakUnits: 400,
    cohorts: [
      { yearWeek: '2025-W05', units: 150 },
      { yearWeek: '2025-W19', units: 250 },
    ],
  },
  {
    id: 'psz_215_60r17',
    code: '215/60R17',
    unitsPerDepth: 6,
    peakUnits: 190,
    cohorts: [{ yearWeek: '2025-W11', units: 190 }],
  },
  {
    id: 'psz_225_45r18',
    code: '225/45R18',
    unitsPerDepth: 6,
    peakUnits: 90,
    cohorts: [{ yearWeek: '2025-W17', units: 90 }],
  },
  {
    id: 'psz_265_70r17',
    code: '265/70R17',
    unitsPerDepth: 4,
    peakUnits: 56,
    cohorts: [{ yearWeek: '2025-W03', units: 56 }],
  },
];

/** 深さごとのレーン本数。実倉庫のように深いレーンほど少ない。 */
const LANES_PER_DEPTH: Record<number, number> = {
  1: 6,
  2: 6,
  3: 8,
  4: 8,
  5: 6,
  6: 6,
  7: 10,
  11: 6,
  16: 8,
};

export function createSampleCapacityTable(
  sizes: readonly SampleSize[] = SAMPLE_SIZES,
): LaneCapacityEntry[] {
  const entries: LaneCapacityEntry[] = [];
  for (const size of sizes) {
    for (const depth of LANE_DEPTHS) {
      entries.push({
        depth,
        productSizeId: size.id,
        unitsPerLane: size.unitsPerDepth * depth,
      });
    }
  }
  return entries;
}

export function createSampleLanes(): Lane[] {
  const lanes: Lane[] = [];
  let block = 0;
  for (const depth of LANE_DEPTHS) {
    const count = LANES_PER_DEPTH[depth] ?? 4;
    block += 1;
    const blockName = String.fromCharCode('A'.charCodeAt(0) + block - 1);
    for (let i = 1; i <= count; i++) {
      lanes.push({
        id: `lane_${blockName}${String(i).padStart(2, '0')}`,
        label: `${blockName}-${String(i).padStart(2, '0')}`,
        depth,
        groupLabel: `${blockName}ブロック（深さ${depth}）`,
      });
    }
  }
  return lanes;
}

export function createSampleStock(
  sizes: readonly SampleSize[] = SAMPLE_SIZES,
): DeadPositionStock[] {
  return sizes.map((size) => ({
    productSizeId: size.id,
    peakUnits: size.peakUnits,
    cohorts: size.cohorts.map((c) => ({ yearWeek: c.yearWeek, units: c.units })),
  }));
}

/**
 * 現状の割り当てを作る。
 *
 * 「入荷した順に空いているレーンへ入れてきた」運用を再現する。
 * 深さを考えずに手前から詰めるため、深いレーンに少量だけ入るなどの
 * 無駄が自然に発生する。
 *
 * 在庫と収容本数マスタは引数で差し替えられる（画面で在庫を編集したとき、
 * 現状側も同じ在庫で作り直すため）。
 */
export function createSampleCurrentAssignments(
  lanes: readonly Lane[],
  stock: readonly DeadPositionStock[] = createSampleStock(),
  capacity: readonly LaneCapacityEntry[] = createSampleCapacityTable(),
  seed = 20250914,
): LaneAssignment[] {
  const random = new Random(seed);
  const capacityIndex = buildCapacityIndex(capacity);

  // 入荷順 = 製造年週の古い順。レーンはラベル順に手前から使っていく
  const arrivals = stock
    .flatMap((entry) =>
      (entry.cohorts && entry.cohorts.length > 0
        ? entry.cohorts
        : [{ units: entry.peakUnits }]
      ).map((cohort) => ({
        productSizeId: entry.productSizeId,
        yearWeek: cohort.yearWeek,
        units: cohort.units,
      })),
    )
    .filter((a) => a.units > 0)
    .sort(
      (a, b) =>
        (a.yearWeek ?? '').localeCompare(b.yearWeek ?? '') ||
        a.productSizeId.localeCompare(b.productSizeId),
    );

  const pool = [...lanes].sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  let cursor = 0;
  const assignments: LaneAssignment[] = [];

  for (const arrival of arrivals) {
    let remaining = arrival.units;
    while (remaining > 0 && cursor < pool.length) {
      const lane = pool[cursor]!;
      cursor += 1;
      const cap = capacityOf(capacityIndex, lane.depth, arrival.productSizeId);
      if (cap === undefined || cap <= 0) continue;
      // 満載まで詰めきらずに次の入荷へ移ることがある運用を再現する
      const fillRatio = random.between(0.55, 1.0);
      const units = Math.max(1, Math.min(remaining, Math.round(cap * fillRatio)));
      assignments.push({
        laneId: lane.id,
        productSizeId: arrival.productSizeId,
        units,
        ...(arrival.yearWeek !== undefined ? { yearWeek: arrival.yearWeek } : {}),
      });
      remaining -= units;
    }
  }

  return assignments;
}

/** サンプル入力一式。 */
export function createSampleDeadPositionInput(): DeadPositionInput {
  const lanes = createSampleLanes();
  return {
    lanes,
    current: createSampleCurrentAssignments(lanes),
    stock: createSampleStock(),
    capacity: createSampleCapacityTable(),
  };
}

/** サンプルのサイズコードを引くための対応表。 */
export function sampleSizeLabels(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const size of SAMPLE_SIZES) map[size.id] = size.code;
  return map;
}
