import { formatLocationCode } from '../domain/locations.js';
import { isRackObject } from '../domain/types.js';
import type { LayoutObject, Location, RackObject } from '../domain/types.js';
import type { FillMixEntry, LevelMixEntry } from '../domain/logistics.js';
import type { Random } from './random.js';

/* ============================================================================
 * 段数の割合 / 入り本数の割合
 * ----------------------------------------------------------------------------
 * レイアウトで決めるのは「列数」だけ。
 * 段数と入り本数はシミュレーション時に割合から抽選する。
 *
 * どちらも Random (mulberry32) を使うため、同じシードなら必ず同じ結果になる。
 * レイアウトA/Bの比較が成立するために、この決定性は必須。
 * ========================================================================== */

/** 段数の割合から1つ抽選する。未設定なら undefined（＝ラック定義の段数を使う）。 */
export function drawLevels(
  mix: readonly LevelMixEntry[],
  random: Random,
): number | undefined {
  if (mix.length === 0) return undefined;
  // 選択肢が1つなら抽選しない（乱数を消費すると他の抽選結果までずれるため）
  if (mix.length === 1) return Math.max(1, Math.floor(mix[0]!.levels));
  const index = random.weightedIndex(mix.map((m) => Math.max(0, m.ratioPct)));
  if (index < 0) return undefined;
  return Math.max(1, Math.floor(mix[index]!.levels));
}

/**
 * 入り本数の割合から積載本数を決める。
 *
 * @param capacityUnits そのラックの満載本数
 * @param baseUnits     未設定のときに使う本数（商品サイズの1ラックあたり本数）
 */
export function drawFillUnits(
  mix: readonly FillMixEntry[],
  capacityUnits: number,
  baseUnits: number,
  random: Random,
): number {
  if (capacityUnits <= 0) return 0;
  if (mix.length === 0) return Math.max(1, Math.min(capacityUnits, baseUnits));

  let entry = mix[0]!;
  if (mix.length > 1) {
    // 選択肢が1つのときは抽選しない（乱数を消費すると他の抽選までずれるため）
    const index = random.weightedIndex(mix.map((m) => Math.max(0, m.ratioPct)));
    if (index < 0) return Math.max(1, Math.min(capacityUnits, baseUnits));
    entry = mix[index]!;
  }

  const pct = Math.max(1, Math.min(100, entry.fillPct));
  // 1本未満にはしない（空ラックは別の状態として扱うため）
  return Math.max(1, Math.min(capacityUnits, Math.round((capacityUnits * pct) / 100)));
}

/**
 * 段数の割合に合わせて、保管ラックごとの保管位置を作り直す。
 *
 * レイアウトには「列ごとに1件」のロケーションだけが保存されている想定だが、
 * 既存データのように列×段で保存されていても壊さないよう、
 * 「列ごとにまとめてから、抽選した段数ぶんに並べ直す」方式にしている。
 *
 * - 抽選した段数が保存件数より少ない → 下段から必要数だけ使う
 * - 多い → 同じ列の座標を引き継いで段を積み増す
 *
 * mix が空のときは locations をそのまま返す（従来の挙動）。
 */
export function applyLevelMix(
  locations: readonly Location[],
  objects: readonly LayoutObject[],
  mix: readonly LevelMixEntry[],
  random: Random,
): Location[] {
  if (mix.length === 0) return [...locations];

  // 抽選の順番は「レイアウトに並んでいる順」に固定する。
  // ID は生成のたびに変わるため、ID順に並べると同じシードでも結果がぶれる。
  const racks = objects.filter(isRackObject);
  const rackIds = new Set(racks.map((r) => r.id));

  // ラック -> 列 -> その列のロケーション
  const byRack = new Map<string, Map<number, Location[]>>();
  for (const location of locations) {
    if (!rackIds.has(location.rackId)) continue;
    const columns = byRack.get(location.rackId) ?? new Map<number, Location[]>();
    const list = columns.get(location.column) ?? [];
    list.push(location);
    columns.set(location.column, list);
    byRack.set(location.rackId, columns);
  }

  const keep = new Set<string>();
  const added: Location[] = [];

  for (const rack of racks) {
    const columns = byRack.get(rack.id);
    const levels = drawLevels(mix, random) ?? rack.rack.levels;
    if (!columns) continue;
    const naming = rack.rack.naming;

    for (const columnNo of [...columns.keys()].sort((a, b) => a - b)) {
      // 減らすときは下段から使う（上の段を落とす）
      const stored = [...columns.get(columnNo)!].sort((a, b) => a.level - b.level);
      for (const location of stored.slice(0, levels)) keep.add(location.id);

      // 保存されている段数より多い段を要求された分だけ作る
      const base = stored[0]!;
      const usedLevels = new Set(stored.map((l) => l.level));
      for (let i = stored.length; i < levels; i++) {
        let levelNo =
          naming.levelOrder === 'bottom-up'
            ? naming.levelStart + i
            : naming.levelStart + (levels - 1 - i);
        // 既存の段と番号がぶつからないようにずらす
        while (usedLevels.has(levelNo)) levelNo += 1;
        usedLevels.add(levelNo);

        added.push({
          ...base,
          // 実行ごとに変わらない ID にする（比較の再現性のため）
          id: `${base.id}-L${levelNo}`,
          level: levelNo,
          code: formatLocationCode(naming, {
            area: naming.area,
            column: columnNo,
            level: levelNo,
            columnDigits: naming.columnDigits,
            levelDigits: naming.levelDigits,
            index: i + 1,
          }),
        });
      }
    }
  }

  // 元の並び順を保つ。段数が保存値と同じなら、入力とまったく同じ配列になる。
  const out = locations.filter((l) => !rackIds.has(l.rackId) || keep.has(l.id));
  return added.length === 0 ? out : out.concat(added);
}
