import type { ID } from './ids.js';
import type { TurnoverClass } from './types.js';

/* ============================================================================
 * 物流シミュレーション用のマスタ / 設定 / 実行時エンティティ
 * ----------------------------------------------------------------------------
 * 「ラック」は2つの概念に分けている。
 *
 *  - 保管ラック構造 (RackObject / Location): レイアウト上に固定された棚。
 *    ロケーションを生成する器であり、動かない。
 *  - 可搬ラック (RackUnit): 商品を積んで運ばれる実体（タイヤラック/カゴ台車）。
 *    ロケーションに格納され、出庫時にフォークリフトが出荷ゲートへ運び、
 *    空になったら空ラック置き場へ運んで積み重ねる。
 *
 * 要件の「ラックが空になる → 空ラック置き場へ搬送 → 積み重ね」は
 * すべて RackUnit の状態遷移として表現する。
 * ========================================================================== */

/** ラック種別（小型 / 大型） */
export type RackCategory = 'small' | 'large';

/** ラック種別マスタ。実寸と収納能力・積み重ね制限を持つ。 */
export interface RackType {
  id: ID;
  warehouseId: ID;
  code: string;
  name: string;
  category: RackCategory;
  widthM: number;
  depthM: number;
  heightM: number;
  /** 段数 */
  levels: number;
  /** 1段あたりの収納本数 */
  unitsPerLevel: number;
  /** 最大収納本数 (levels × unitsPerLevel を既定とするが個別指定も可) */
  maxUnits: number;
  /** 最大積載重量 (kg) */
  maxLoadKg: number;
  /** 中身がある場合の最大積み重ね段数 */
  maxStackWhenLoaded: number;
  /** 空の場合の最大積み重ね段数 */
  maxStackWhenEmpty: number;
  color?: string;
}

/**
 * 商品サイズマスタ。
 * タイヤサイズ (195/65R15 等) や S/M/L/XL を登録する。
 */
export interface ProductSize {
  id: ID;
  warehouseId: ID;
  /** サイズコード (195/65R15 など) */
  code: string;
  name: string;
  /** 使用可能なラック種別 */
  rackCategory: RackCategory;
  /** 1ラックあたりの収納本数 */
  unitsPerRack: number;
  /** 1本あたり重量 (kg) */
  weightPerUnitKg: number;
  /** 搬入割合 (%) — 倉入れイベント生成に使用 */
  inboundRatioPct: number;
  /** 出荷割合 (%) — 出荷イベント生成に使用 */
  outboundRatioPct: number;
  /** 出荷頻度 (保管場所最適化で使用) */
  turnover: TurnoverClass;
  /**
   * 優先保管エリア。ラック構造の「商品カテゴリ」と突き合わせる。
   * 例: 大型タイヤ -> "北側", 小型タイヤ -> "南側"
   */
  preferredAreaTag?: string;
  /** 優先的に使う倉入れ口 (LayoutObject の id) */
  inboundGateObjectId?: ID;
}

/* ------------------------------------------------------- 数量・割合の設定 */

/** 出荷ボリューム区分（小口 / 中口 / 大口 / 特大口） */
export type VolumeClassKey = 'small' | 'medium' | 'large' | 'xlarge';

export interface VolumeClassSetting {
  key: VolumeClassKey;
  label: string;
  /** 全出荷本数に占める割合 (%) */
  ratioPct: number;
  /** 1オーダーあたりの本数 */
  unitsPerOrder: number;
}

/** 時間帯別の数量配分。 */
export interface TimeBandSetting {
  /** "08:00" */
  from: string;
  /** "10:00" */
  to: string;
  /** 全体に占める割合 (%) */
  ratioPct: number;
}

/** 使用ラックサイズの割合。合計100%であること。 */
export interface RackMixSetting {
  smallPct: number;
  largePct: number;
}

/**
 * 段数の割合。
 *
 * 段数はレイアウトではなくシミュレーション時に決める。
 * 「3段のラックが40%、4段が45%、5段が15%」のように指定すると、
 * 保管ラック1本ごとに段数を抽選して保管位置を用意する。
 * 空にすると、従来どおりラック定義の段数を使う。
 */
export interface LevelMixEntry {
  /** 段数 */
  levels: number;
  /** この段数になるラックの割合 (%) */
  ratioPct: number;
}

/**
 * 入り本数の割合。
 *
 * 1ラックに何本入っているかをシミュレーション時に決める。
 * 満載に対する割合で指定する（100 = 満載）。
 * 空にすると、従来どおり商品サイズの1ラックあたり本数を使う。
 */
export interface FillMixEntry {
  /** 満載に対する割合 (%)。100 なら満載 */
  fillPct: number;
  /** この入り本数になるラックの割合 (%) */
  ratioPct: number;
}

/** サイズ別の搬入割合。 */
export interface SizeMixEntry {
  productSizeId: ID;
  ratioPct: number;
}

/** 曜日別係数 (0=日曜)。将来の実績データ取込に備えた枠。 */
export type WeekdayFactors = [number, number, number, number, number, number, number];

/* --------------------------------------------------------------- ゲート設定 */

/** 倉入れ口 (入庫ゲート) の設定。 */
export interface InboundGateConfig {
  code: string;
  /** 1日あたりの倉入れ本数 */
  dailyVolume: number;
  /** 1時間あたりの処理能力 (本/h) */
  capacityPerHour: number;
  /** 同時搬入台数 */
  concurrentSlots: number;
  /** 使用可能時間 */
  openFrom: string;
  openTo: string;
  /** 時間帯別の搬入割合 */
  timeBands: TimeBandSetting[];
  /** サイズ別搬入割合 */
  sizeMix: SizeMixEntry[];
  /** 使用ラックサイズ割合 */
  rackMix: RackMixSetting;
  /** 曜日別係数 (将来のCSV実績取込用) */
  weekdayFactors?: WeekdayFactors;
}

/** 出荷ゲートの設定。 */
export interface OutboundGateConfig {
  code: string;
  /** 1日あたりの出荷本数 */
  dailyVolume: number;
  /** 1時間あたりの処理能力 (本/h) */
  capacityPerHour: number;
  /** 同時処理可能台数 */
  concurrentSlots: number;
  openFrom: string;
  openTo: string;
  /** ボリューム区分別の割合 */
  volumeMix: VolumeClassSetting[];
  /** 時間帯別の出荷割合 */
  timeBands: TimeBandSetting[];
  /** 使用ラックサイズ割合 */
  rackMix: RackMixSetting;
  /** 出荷対象の商品サイズ (空なら全サイズ) */
  productSizeIds: ID[];
  weekdayFactors?: WeekdayFactors;
}

/** 空ラック置き場の設定。 */
export interface EmptyRackYardConfig {
  code: string;
  /** スタック位置の列数 */
  stackColumns: number;
  /** スタック位置の行数 */
  stackRows: number;
  /** 受け入れるラック種別 */
  acceptedCategory: RackCategory | 'both';
}

/* --------------------------------------------------- 実行時エンティティ */

/** 可搬ラックの状態。 */
export type RackUnitStatus =
  | 'empty' // 空
  | 'loading' // 入庫中（積込み中）
  | 'stored' // 保管中（使用中）
  | 'full' // 満載
  | 'unloading' // 出庫中（取り出し中）
  | 'carrying' // 搬送中
  | 'waiting' // 待機（ゲート前など）
  | 'stacked'; // 積み重ね済み

/** 可搬ラック（商品を積んで運ばれる実体）。 */
export interface RackUnit {
  id: ID;
  rackTypeId: ID;
  category: RackCategory;
  /** 積んでいる商品サイズ (空ラックは undefined) */
  productSizeId?: ID;
  /** 現在の積載本数 */
  currentUnits: number;
  /** 最大収納本数 */
  capacityUnits: number;
  status: RackUnitStatus;
  /** 保管中のロケーション */
  locationId?: ID;
  /** 搬送中のフォークリフト */
  forkliftId?: ID;
  /** ゲートで処理中の場合のゲートオブジェクトID */
  gateObjectId?: ID;
  /** 積み重ね先 */
  stackId?: ID;
  /** 積み重ね段位置 (1 始まり) */
  stackLevel?: number;
  /** 表示用のワールド座標 (m) */
  x: number;
  y: number;
  /** 入庫時刻 (シミュレーション内秒) */
  storedAtSec?: number;
}

/** 空ラックの積み重ねスタック。 */
export interface RackStack {
  id: ID;
  /** 空ラック置き場オブジェクトの id */
  yardObjectId: ID;
  /** スタック位置 (m) */
  x: number;
  y: number;
  /** このスタックが受け入れているラック種別 (最初に積まれたもので決まる) */
  rackTypeId?: ID;
  /** 下から順に積まれたラックID */
  rackUnitIds: ID[];
  /** 最大段数 (ラック種別の maxStackWhenEmpty) */
  maxLevels: number;
}

/** ロケーションの状態。 */
export type LocationStatus =
  | 'empty' // 空
  | 'partial' // 一部在庫
  | 'full' // 満載
  | 'inbound' // 入庫中
  | 'outbound' // 出庫中
  | 'reserved'; // 予約済み（作業割当済み）

/** ゲートの状態。 */
export type GateStatus =
  | 'idle' // 待機
  | 'receiving' // 入庫受付中
  | 'shipping' // 出荷中
  | 'queued' // 処理待ち
  | 'congested'; // 混雑

/** ゲートの実行時状態。 */
export interface GateRuntime {
  objectId: ID;
  type: 'inbound' | 'outbound';
  code: string;
  status: GateStatus;
  /** 処理中のフォークリフト数 */
  busySlots: number;
  concurrentSlots: number;
  /** 待機列の長さ */
  queueLength: number;
  /** 処理済み本数 */
  processedUnits: number;
  /** 計画本数 */
  plannedUnits: number;
  /** 待機時間の合計 (秒) */
  totalWaitSeconds: number;
  /** 混雑ピーク時の待機台数 */
  peakQueueLength: number;
  capacityPerHour: number;
}

/* -------------------------------------------------- シミュレーション設定 */

/** フリーロケーション（空きロケーション選択）の方式。 */
export type SlottingStrategyKey = 'nearest' | 'turnover' | 'preferred-zone' | 'balanced';

export interface LogisticsSimConfig {
  /** 開始時刻 "08:00" */
  startTime: string;
  /** 終了時刻 "17:00" */
  endTime: string;
  /** 物理更新の刻み (秒) */
  tickSeconds: number;
  /** 構内制限速度 (km/h) */
  speedLimitKmh: number;
  /** 経路探索のグリッド解像度 (m) */
  pathGridM: number;
  /** 車体クリアランス (m) */
  clearanceM: number;
  /** フリーロケーション方式 */
  slottingStrategy: SlottingStrategyKey;
  /** 乱数シード（同じ値なら同じイベント列＝レイアウト比較に必須） */
  seed: number;
  /** 開始時点の在庫充填率 (0-1)。出庫できる在庫を用意する。 */
  initialFillRatio: number;
  /**
   * 段数の割合。保管ラック1本ごとに段数を抽選する。
   * 空配列なら、ラック定義に保存されている段数をそのまま使う。
   */
  levelMix: LevelMixEntry[];
  /**
   * 入り本数の割合。可搬ラック1台ごとに積載本数を抽選する。
   * 空配列なら、商品サイズの1ラックあたり本数をそのまま使う。
   */
  fillMix: FillMixEntry[];
  /** フォークリフトの荷役時間 (秒) */
  handlingSeconds: number;
  /** 通路での追突回避を行うか */
  collisionAvoidance: boolean;
  /**
   * 縦列(1本のラックの1列)に1サイズだけを入れる。
   * 同じ列に別サイズが混ざると、奥の在庫を出すのに手前をどける手間が出る。
   */
  oneSizePerLane: boolean;
}

export const DEFAULT_SIM_CONFIG: LogisticsSimConfig = {
  startTime: '08:00',
  endTime: '17:00',
  tickSeconds: 1,
  speedLimitKmh: 8,
  pathGridM: 0.5,
  clearanceM: 0.7,
  slottingStrategy: 'balanced',
  seed: 20240101,
  initialFillRatio: 0.5,
  // 既定は「3段・満載のみ」。従来と同じ結果になる出発点にしておき、
  // ばらつきを見たいときにユーザーが行を足して割合を変える。
  levelMix: [{ levels: 3, ratioPct: 100 }],
  fillMix: [{ fillPct: 100, ratioPct: 100 }],
  handlingSeconds: 20,
  collisionAvoidance: true,
  oneSizePerLane: true,
};

/* ------------------------------------------------------------ バリデーション */

/** 割合の合計が100%かを検証する。 */
export function validateRatioTotal(
  values: readonly number[],
  label: string,
  tolerance = 0.01,
): string[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (Math.abs(total - 100) > tolerance) {
    return [`${label}の合計が ${total.toFixed(1)}% です（100%にしてください）`];
  }
  return [];
}

export function validateRackMix(mix: RackMixSetting, label = '使用ラックサイズ割合'): string[] {
  return validateRatioTotal([mix.smallPct, mix.largePct], label);
}

/** 段数の割合。未設定（空）は「ラック定義の段数を使う」意味なので許容する。 */
export function validateLevelMix(mix: readonly LevelMixEntry[]): string[] {
  if (mix.length === 0) return [];
  const errors: string[] = [];
  for (const entry of mix) {
    if (!Number.isInteger(entry.levels) || entry.levels < 1) {
      errors.push(`段数は1以上の整数にしてください（${entry.levels}）`);
    }
    if (entry.ratioPct < 0) errors.push('段数の割合に負の値は指定できません');
  }
  const seen = new Set<number>();
  for (const entry of mix) {
    if (seen.has(entry.levels)) errors.push(`段数 ${entry.levels} が重複しています`);
    seen.add(entry.levels);
  }
  return errors.concat(validateRatioTotal(mix.map((m) => m.ratioPct), '段数の割合'));
}

/** 入り本数の割合。未設定（空）は「商品サイズの本数を使う」意味なので許容する。 */
export function validateFillMix(mix: readonly FillMixEntry[]): string[] {
  if (mix.length === 0) return [];
  const errors: string[] = [];
  for (const entry of mix) {
    if (entry.fillPct <= 0 || entry.fillPct > 100) {
      errors.push(`入り本数の割合は1〜100%で指定してください（${entry.fillPct}）`);
    }
    if (entry.ratioPct < 0) errors.push('入り本数の割合に負の値は指定できません');
  }
  const seen = new Set<number>();
  for (const entry of mix) {
    if (seen.has(entry.fillPct)) errors.push(`入り本数 ${entry.fillPct}% が重複しています`);
    seen.add(entry.fillPct);
  }
  return errors.concat(validateRatioTotal(mix.map((m) => m.ratioPct), '入り本数の割合'));
}

export function validateInboundGateConfig(config: InboundGateConfig): string[] {
  const errors: string[] = [];
  if (config.dailyVolume < 0) errors.push('1日あたりの倉入れ本数は0以上にしてください');
  if (config.capacityPerHour <= 0) errors.push('1時間あたりの処理能力は1以上にしてください');
  if (config.concurrentSlots <= 0) errors.push('同時搬入台数は1以上にしてください');
  errors.push(...validateRatioTotal(config.timeBands.map((b) => b.ratioPct), '時間帯別の搬入割合'));
  errors.push(...validateRatioTotal(config.sizeMix.map((s) => s.ratioPct), 'サイズ別搬入割合'));
  errors.push(...validateRackMix(config.rackMix));
  return errors;
}

export function validateOutboundGateConfig(config: OutboundGateConfig): string[] {
  const errors: string[] = [];
  if (config.dailyVolume < 0) errors.push('1日あたりの出荷本数は0以上にしてください');
  if (config.capacityPerHour <= 0) errors.push('1時間あたりの処理能力は1以上にしてください');
  if (config.concurrentSlots <= 0) errors.push('同時処理可能台数は1以上にしてください');
  errors.push(...validateRatioTotal(config.volumeMix.map((v) => v.ratioPct), 'ボリューム区分の割合'));
  errors.push(...validateRatioTotal(config.timeBands.map((b) => b.ratioPct), '時間帯別の出荷割合'));
  errors.push(...validateRackMix(config.rackMix));
  return errors;
}

/** 商品サイズの搬入割合合計を検証する。 */
export function validateProductSizes(sizes: readonly ProductSize[]): string[] {
  if (sizes.length === 0) return ['商品サイズを1件以上登録してください'];
  const errors = validateRatioTotal(sizes.map((s) => s.inboundRatioPct), 'サイズ別搬入割合');
  errors.push(...validateRatioTotal(sizes.map((s) => s.outboundRatioPct), 'サイズ別出荷割合'));
  return errors;
}
