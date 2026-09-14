import { createId } from '../domain/ids.js';
import { parseClock } from '../geometry/index.js';
import { Random } from './random.js';
import { drawFillUnits } from './mixes.js';
import type { ID } from '../domain/ids.js';
import type {
  FillMixEntry,
  InboundGateConfig,
  OutboundGateConfig,
  ProductSize,
  RackCategory,
  RackMixSetting,
  TimeBandSetting,
  VolumeClassKey,
} from '../domain/logistics.js';
import type { InboundGateObject, OutboundGateObject } from '../domain/types.js';

/* ============================================================================
 * 入出庫イベントの自動生成 (要件13)
 * ----------------------------------------------------------------------------
 * ゲートに設定した「1日の本数」「サイズ別割合」「時間帯別割合」
 * 「ボリューム区分の割合」「使用ラックサイズ割合」から、
 * 実際に処理される入庫・出庫イベントを生成する。
 *
 * 設定値が表示だけで終わらないよう、ここで作ったイベントが
 * そのままシミュレーションエンジンの入力になる。
 * ========================================================================== */

/** 1ラック分の倉入れ作業。 */
export interface InboundJob {
  id: ID;
  gateObjectId: ID;
  /** 発生時刻（シミュレーション内秒） */
  atSec: number;
  productSizeId: ID;
  /** このラックに積む本数 */
  units: number;
  /** 使用するラック種別の区分 */
  rackCategory: RackCategory;
}

/** 出荷オーダー1件。 */
export interface OutboundJob {
  id: ID;
  code: string;
  gateObjectId: ID;
  atSec: number;
  volumeClass: VolumeClassKey;
  lines: { productSizeId: ID; units: number }[];
  totalUnits: number;
}

export interface EventPlan {
  inbound: InboundJob[];
  outbound: OutboundJob[];
  warnings: string[];
  /** 計画本数（検証用） */
  plannedInboundUnits: number;
  plannedOutboundUnits: number;
}

export interface GenerateOptions {
  seed: number;
  /** シミュレーション開始時刻 "08:00" */
  startTime: string;
  /** シミュレーション終了時刻 "17:00" */
  endTime: string;
  /** 曜日 (0=日)。曜日別係数を使う場合に指定する。 */
  weekday?: number;
  /**
   * 入り本数の割合。1ラックに何本積むかを抽選する。
   * 未指定・空なら商品サイズの1ラックあたり本数をそのまま使う。
   */
  fillMix?: readonly FillMixEntry[];
}

/** 時間帯を秒の範囲へ変換し、開始時刻を0秒とした相対値にする。 */
function bandRange(band: TimeBandSetting, startSec: number): { from: number; to: number } {
  const from = parseClock(band.from) - startSec;
  const to = parseClock(band.to) - startSec;
  return { from, to: Math.max(from + 1, to) };
}

/** 曜日係数を適用した1日の本数。 */
function dailyVolumeFor(
  config: { dailyVolume: number; weekdayFactors?: readonly number[] },
  weekday?: number,
): number {
  if (weekday === undefined || !config.weekdayFactors) return config.dailyVolume;
  const factor = config.weekdayFactors[weekday] ?? 1;
  return Math.round(config.dailyVolume * factor);
}

/**
 * 「割合どおりの個数」に分配する。
 * 端数は最大剰余法で配り、合計が必ず total になるようにする。
 */
export function distributeByRatio(total: number, ratios: readonly number[]): number[] {
  const sum = ratios.reduce((acc, r) => acc + Math.max(0, r), 0);
  if (sum <= 0 || total <= 0) return ratios.map(() => 0);
  const exact = ratios.map((r) => (total * Math.max(0, r)) / sum);
  const floored = exact.map((v) => Math.floor(v));
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    floored[order[k]!.i]! += 1;
  }
  // それでも余る場合（比率が極端）は先頭へ寄せる
  if (remainder > 0 && floored.length > 0) floored[0]! += remainder;
  return floored;
}

/** 商品サイズが使えるラック区分。大型商品は大型ラックのみ、小型商品は両方使える。 */
export function allowedRackCategories(size: Pick<ProductSize, 'rackCategory'>): RackCategory[] {
  return size.rackCategory === 'large' ? ['large'] : ['small', 'large'];
}

/**
 * 使用ラックサイズ割合に従いつつ、商品サイズの制約を満たす区分を選ぶ。
 * 実績ベースで選ぶため、少数でも設定した割合に収束する。
 */
function chooseRackCategory(
  mix: RackMixSetting,
  allowed: readonly RackCategory[],
  used: { small: number; large: number },
): RackCategory {
  if (allowed.length === 1) return allowed[0]!;
  const total = used.small + used.large;
  if (mix.smallPct <= 0) return 'large';
  if (mix.largePct <= 0) return 'small';
  if (total === 0) return mix.smallPct >= mix.largePct ? 'small' : 'large';
  const smallDeficit = mix.smallPct - (used.small / total) * 100;
  const largeDeficit = mix.largePct - (used.large / total) * 100;
  return smallDeficit >= largeDeficit ? 'small' : 'large';
}

/**
 * 倉入れイベントを生成する。
 *
 * 1日の倉入れ本数 → サイズ別割合 → 時間帯別割合 の順に分配し、
 * 商品サイズごとの「1ラックあたり本数」でラック単位の作業に切り出す。
 */
export function generateInboundJobs(
  gates: readonly InboundGateObject[],
  productSizes: readonly ProductSize[],
  options: GenerateOptions,
): { jobs: InboundJob[]; warnings: string[]; plannedUnits: number } {
  const random = new Random(options.seed);
  const startSec = parseClock(options.startTime);
  const endSec = parseClock(options.endTime);
  const jobs: InboundJob[] = [];
  const warnings: string[] = [];
  let plannedUnits = 0;

  for (const gate of gates) {
    const config: InboundGateConfig = gate.inboundGate;
    const daily = dailyVolumeFor(config, options.weekday);
    if (daily <= 0) continue;
    plannedUnits += daily;

    // --- サイズ別に分配 ---
    const mixEntries = config.sizeMix.filter((entry) =>
      productSizes.some((size) => size.id === entry.productSizeId),
    );
    const entries =
      mixEntries.length > 0
        ? mixEntries
        : productSizes.map((size) => ({ productSizeId: size.id, ratioPct: size.inboundRatioPct }));
    if (entries.length === 0) {
      warnings.push(`${gate.name}: 商品サイズが未設定のため倉入れイベントを生成できません`);
      continue;
    }
    const perSize = distributeByRatio(daily, entries.map((e) => e.ratioPct));

    const usedCategories = { small: 0, large: 0 };

    for (const [sizeIndex, entry] of entries.entries()) {
      const size = productSizes.find((s) => s.id === entry.productSizeId);
      const sizeUnits = perSize[sizeIndex] ?? 0;
      if (!size || sizeUnits <= 0) continue;

      // --- 時間帯別に分配 ---
      const bands = config.timeBands.length > 0 ? config.timeBands : [{ from: config.openFrom, to: config.openTo, ratioPct: 100 }];
      const perBand = distributeByRatio(sizeUnits, bands.map((b) => b.ratioPct));

      for (const [bandIndex, band] of bands.entries()) {
        let remaining = perBand[bandIndex] ?? 0;
        if (remaining <= 0) continue;
        const range = bandRange(band, startSec);

        // --- 1ラック分ずつ作業に切り出す ---
        while (remaining > 0) {
          // 満載本数を基準に、入り本数の割合から1ラック分を決める
          const rackCapacity = Math.max(1, size.unitsPerRack);
          const units = Math.min(
            remaining,
            drawFillUnits(options.fillMix ?? [], rackCapacity, rackCapacity, random),
          );
          remaining -= units;
          const category = chooseRackCategory(
            config.rackMix,
            allowedRackCategories(size),
            usedCategories,
          );
          usedCategories[category] += 1;

          const atSec = Math.max(0, Math.min(random.between(range.from, range.to), endSec - startSec));
          jobs.push({
            id: createId('inj'),
            gateObjectId: gate.id,
            atSec,
            productSizeId: size.id,
            units,
            rackCategory: category,
          });
        }
      }
    }

    const smallShare = (usedCategories.small / Math.max(1, usedCategories.small + usedCategories.large)) * 100;
    if (
      config.rackMix.smallPct > 0 &&
      Math.abs(smallShare - config.rackMix.smallPct) > 15 &&
      usedCategories.small + usedCategories.large > 4
    ) {
      warnings.push(
        `${gate.name}: 商品サイズの制約により、小型ラックの実使用割合が ${smallShare.toFixed(0)}%（設定 ${config.rackMix.smallPct}%）になりました`,
      );
    }
  }

  jobs.sort((a, b) => a.atSec - b.atSec);
  return { jobs, warnings, plannedUnits };
}

/**
 * 出荷イベントを生成する。
 *
 * 1日の出荷本数 → ボリューム区分の割合 → 時間帯別割合 の順に分配し、
 * 区分ごとの「1オーダーあたり本数」でオーダーに切り出す。
 * オーダーの明細は商品サイズの出荷割合に従って抽選する。
 */
export function generateOutboundJobs(
  gates: readonly OutboundGateObject[],
  productSizes: readonly ProductSize[],
  options: GenerateOptions,
): { jobs: OutboundJob[]; warnings: string[]; plannedUnits: number } {
  const random = new Random(options.seed ^ 0x5f3759df);
  const startSec = parseClock(options.startTime);
  const endSec = parseClock(options.endTime);
  const jobs: OutboundJob[] = [];
  const warnings: string[] = [];
  let plannedUnits = 0;
  let orderNo = 0;

  for (const gate of gates) {
    const config: OutboundGateConfig = gate.outboundGate;
    const daily = dailyVolumeFor(config, options.weekday);
    if (daily <= 0) continue;
    plannedUnits += daily;

    const targetSizes = productSizes.filter(
      (size) => config.productSizeIds.length === 0 || config.productSizeIds.includes(size.id),
    );
    if (targetSizes.length === 0) {
      warnings.push(`${gate.name}: 出荷対象の商品サイズがありません`);
      continue;
    }

    const volumes = config.volumeMix.filter((v) => v.ratioPct > 0);
    if (volumes.length === 0) {
      warnings.push(`${gate.name}: ボリューム区分の割合が未設定です`);
      continue;
    }
    const perVolume = distributeByRatio(daily, volumes.map((v) => v.ratioPct));

    for (const [volumeIndex, volume] of volumes.entries()) {
      const volumeUnits = perVolume[volumeIndex] ?? 0;
      if (volumeUnits <= 0) continue;

      const bands =
        config.timeBands.length > 0
          ? config.timeBands
          : [{ from: config.openFrom, to: config.openTo, ratioPct: 100 }];
      const perBand = distributeByRatio(volumeUnits, bands.map((b) => b.ratioPct));

      for (const [bandIndex, band] of bands.entries()) {
        let remaining = perBand[bandIndex] ?? 0;
        if (remaining <= 0) continue;
        const range = bandRange(band, startSec);

        while (remaining > 0) {
          const orderUnits = Math.min(remaining, Math.max(1, volume.unitsPerOrder));
          remaining -= orderUnits;
          orderNo += 1;

          // 明細はサイズ別の出荷割合で抽選する
          const lines = buildOrderLines(orderUnits, targetSizes, random);
          const atSec = Math.max(0, Math.min(random.between(range.from, range.to), endSec - startSec));

          jobs.push({
            id: createId('outj'),
            code: `ORDER-${String(orderNo).padStart(4, '0')}`,
            gateObjectId: gate.id,
            atSec,
            volumeClass: volume.key,
            lines,
            totalUnits: lines.reduce((sum, l) => sum + l.units, 0),
          });
        }
      }
    }
  }

  jobs.sort((a, b) => a.atSec - b.atSec);
  return { jobs, warnings, plannedUnits };
}

/** 1オーダーの明細を、サイズ別出荷割合に従って組み立てる。 */
function buildOrderLines(
  totalUnits: number,
  sizes: readonly ProductSize[],
  random: Random,
): { productSizeId: ID; units: number }[] {
  // 大口ほど複数サイズが混ざるようにする（現実の出荷に近づける）
  const lineCount = Math.max(1, Math.min(sizes.length, Math.round(totalUnits / 60) + 1));
  const chosen: ProductSize[] = [];
  const weights = sizes.map((s) => Math.max(0.0001, s.outboundRatioPct));
  const pool = [...sizes];
  const poolWeights = [...weights];

  for (let i = 0; i < lineCount && pool.length > 0; i++) {
    const index = random.weightedIndex(poolWeights);
    if (index < 0) break;
    chosen.push(pool[index]!);
    pool.splice(index, 1);
    poolWeights.splice(index, 1);
  }
  if (chosen.length === 0) chosen.push(sizes[0]!);

  const split = distributeByRatio(
    totalUnits,
    chosen.map((s) => Math.max(0.0001, s.outboundRatioPct)),
  );
  return chosen
    .map((size, i) => ({ productSizeId: size.id, units: split[i] ?? 0 }))
    .filter((line) => line.units > 0);
}

/** 入出庫イベントをまとめて生成する。 */
export function generateEventPlan(
  inboundGates: readonly InboundGateObject[],
  outboundGates: readonly OutboundGateObject[],
  productSizes: readonly ProductSize[],
  options: GenerateOptions,
): EventPlan {
  const inbound = generateInboundJobs(inboundGates, productSizes, options);
  const outbound = generateOutboundJobs(outboundGates, productSizes, options);
  return {
    inbound: inbound.jobs,
    outbound: outbound.jobs,
    warnings: [...inbound.warnings, ...outbound.warnings],
    plannedInboundUnits: inbound.plannedUnits,
    plannedOutboundUnits: outbound.plannedUnits,
  };
}
