import { createId } from './ids.js';
import type { ID } from './ids.js';
import type { RackType } from './logistics.js';
import type { Location, RackObject } from './types.js';
export type { LocationBlockRef } from './types.js';
import { generateLocationsForRack } from './locations.js';

/* ============================================================================
 * ロケーション自動生成
 * ----------------------------------------------------------------------------
 * 「ラックを1台ずつ並べる」のではなく、
 * 「縦方向の列数 × 横方向のブロック数」を入力して
 * フリーロケーション用の収納スペースをまとめて作る。
 *
 * 用語を混同しないよう、次の5つを別々の概念として扱う。
 *
 *   ラック種別  … 什器そのもの (大型/小型)。RackType。
 *   物理列      … 縦方向に並ぶラック1台ぶん。1ロケーションに verticalColumns 本。
 *   段          … 物理列の中の棚段。
 *   ロケーション住所 … "001-1"。縦の物理列をまとめた1つの保管場所。
 *   商品サイズ  … 195/65R15 など。ProductSize。
 *
 * 例: 縦3列 × 横23ブロック
 *   物理列     69本 (3 × 23)
 *   ロケーション 23個 (001-1 〜 001-23)
 *
 * 既存モデルへの対応:
 *   ロケーション住所 = RackObject 1台   (rack.block に住所を持つ)
 *   物理収納単位     = Location レコード (code は "001-1-C1-L1")
 * ========================================================================== */

/** ロケーション生成の条件。1グループ = 1回の生成単位。 */
export interface LocationGroup {
  id: ID;
  warehouseId: ID;
  layoutId: ID;
  name: string;
  /** ロケーション開始番号 ("001" / "101" など。桁数はそのまま使う) */
  startNumber: string;
  /** 使用するラック種別 */
  rackTypeId: ID;
  /** 縦方向の列数。1ロケーションに含まれる物理列の本数 */
  verticalColumns: number;
  /** 横方向のブロック数 = 生成されるロケーション数 */
  horizontalBlocks: number;
  /** 段数 */
  levels: number;
  /** 1列1段あたりの収納本数 */
  unitsPerSlot: number;
  /** ラック1台の幅 (m) */
  rackWidthM: number;
  /** ラック1台の奥行 (m) */
  rackDepthM: number;
  /** ラック1台の高さ (m) */
  rackHeightM: number;
  /** 縦列どうしの間隔 (m) */
  columnGapM: number;
  /** 横方向のブロック間隔 (m) */
  blockGapM: number;
  /** 配置の起点 (m) */
  x: number;
  y: number;
  /** 1ロケーションに1サイズだけを入れるか */
  singleSizePerLocation: boolean;
  createdAt: string;
}

export interface LocationGroupInput {
  warehouseId: ID;
  layoutId: ID;
  startNumber: string;
  rackTypeId: ID;
  verticalColumns: number;
  horizontalBlocks: number;
  levels?: number;
  unitsPerSlot?: number;
  rackWidthM?: number;
  rackDepthM?: number;
  rackHeightM?: number;
  columnGapM?: number;
  blockGapM?: number;
  x?: number;
  y?: number;
  name?: string;
  singleSizePerLocation?: boolean;
}

/** 入力を省略したときの既定値。最低限「開始番号・ラック種別・縦列数・横ブロック数」で生成できる。 */
export const LOCATION_GROUP_DEFAULTS = {
  levels: 4,
  unitsPerSlot: 10,
  rackWidthM: 2.5,
  rackDepthM: 1.2,
  rackHeightM: 2.0,
  columnGapM: 0,
  blockGapM: 0.1,
} as const;

export function createLocationGroup(input: LocationGroupInput): LocationGroup {
  return {
    id: createId('lgrp'),
    warehouseId: input.warehouseId,
    layoutId: input.layoutId,
    name: input.name ?? `ロケーション ${input.startNumber}`,
    startNumber: input.startNumber,
    rackTypeId: input.rackTypeId,
    verticalColumns: Math.max(1, Math.floor(input.verticalColumns)),
    horizontalBlocks: Math.max(1, Math.floor(input.horizontalBlocks)),
    levels: Math.max(1, Math.floor(input.levels ?? LOCATION_GROUP_DEFAULTS.levels)),
    unitsPerSlot: Math.max(1, Math.floor(input.unitsPerSlot ?? LOCATION_GROUP_DEFAULTS.unitsPerSlot)),
    rackWidthM: input.rackWidthM ?? LOCATION_GROUP_DEFAULTS.rackWidthM,
    rackDepthM: input.rackDepthM ?? LOCATION_GROUP_DEFAULTS.rackDepthM,
    rackHeightM: input.rackHeightM ?? LOCATION_GROUP_DEFAULTS.rackHeightM,
    columnGapM: input.columnGapM ?? LOCATION_GROUP_DEFAULTS.columnGapM,
    blockGapM: input.blockGapM ?? LOCATION_GROUP_DEFAULTS.blockGapM,
    x: input.x ?? 2,
    y: input.y ?? 2,
    singleSizePerLocation: input.singleSizePerLocation ?? true,
    createdAt: new Date().toISOString(),
  };
}

/**
 * ラック種別の実寸と収納本数を生成条件へ取り込む。
 *
 * 1つの物理収納単位 (1列1段) には可搬ラックが1台入るため、
 * 収納本数はそのラック種別の最大収納本数に合わせる。
 */
export function applyRackType(group: LocationGroup, rackType: RackType): LocationGroup {
  return {
    ...group,
    rackTypeId: rackType.id,
    rackWidthM: rackType.widthM,
    rackDepthM: rackType.depthM,
    rackHeightM: rackType.heightM,
    unitsPerSlot: Math.max(1, rackType.maxUnits),
  };
}

/* --------------------------------------------------------------- 住所と番号 */

/** ロケーション住所を作る。"001" + 3 -> "001-3" */
export function formatBlockCode(startNumber: string, blockIndex: number): string {
  return `${startNumber}-${blockIndex}`;
}

/** 物理収納単位の番号を作る。"001-1" + 列2 + 段3 -> "001-1-C2-L3" */
export function formatSlotCode(locationCode: string, column: number, level: number): string {
  return `${locationCode}-C${column}-L${level}`;
}

/** 物理収納単位の番号を住所・列・段に分解する。 */
export function parseSlotCode(
  code: string,
): { locationCode: string; column: number; level: number } | undefined {
  const match = /^(.*)-C(\d+)-L(\d+)$/.exec(code);
  if (!match) return undefined;
  return {
    locationCode: match[1]!,
    column: Number(match[2]),
    level: Number(match[3]),
  };
}

/* ------------------------------------------------------------------ 集計 */

/** 生成プレビューに出す数値。 */
export interface LocationGroupStats {
  /** 縦方向の列数 */
  verticalColumns: number;
  /** 横方向のブロック数 */
  horizontalBlocks: number;
  /** 段数 */
  levels: number;
  /** 物理列の総数 (縦列 × ブロック) */
  totalPhysicalColumns: number;
  /** ロケーション住所の数 (= ブロック数) */
  locationCount: number;
  /** 物理収納単位の数 (列 × 段 × ブロック) */
  slotCount: number;
  /** 1列あたりの収納本数 (1列1段 × 段数) */
  unitsPerColumn: number;
  /** 1ロケーションあたりの収納本数 */
  unitsPerLocation: number;
  /** 全体の収納本数 */
  totalUnits: number;
  /** 1ロケーションの外形 (m) */
  blockWidthM: number;
  blockDepthM: number;
  /** 生成範囲の外形 (m) */
  totalWidthM: number;
  totalDepthM: number;
}

export function locationGroupStats(group: LocationGroup): LocationGroupStats {
  const { verticalColumns, horizontalBlocks, levels, unitsPerSlot } = group;
  const unitsPerColumn = unitsPerSlot * levels;
  const unitsPerLocation = unitsPerColumn * verticalColumns;
  const blockDepthM =
    verticalColumns * group.rackDepthM + Math.max(0, verticalColumns - 1) * group.columnGapM;
  const blockWidthM = group.rackWidthM;

  return {
    verticalColumns,
    horizontalBlocks,
    levels,
    totalPhysicalColumns: verticalColumns * horizontalBlocks,
    locationCount: horizontalBlocks,
    slotCount: verticalColumns * levels * horizontalBlocks,
    unitsPerColumn,
    unitsPerLocation,
    totalUnits: unitsPerLocation * horizontalBlocks,
    blockWidthM,
    blockDepthM,
    totalWidthM:
      horizontalBlocks * blockWidthM + Math.max(0, horizontalBlocks - 1) * group.blockGapM,
    totalDepthM: blockDepthM,
  };
}

/** 生成条件の検証。 */
export function validateLocationGroup(group: LocationGroup): string[] {
  const errors: string[] = [];
  if (!group.startNumber.trim()) errors.push('ロケーション開始番号を入力してください');
  if (!/^[0-9A-Za-z]+$/.test(group.startNumber.trim())) {
    errors.push('開始番号は英数字で入力してください（例: 001, 101, A01）');
  }
  if (group.verticalColumns < 1) errors.push('縦方向の列数は1以上にしてください');
  if (group.horizontalBlocks < 1) errors.push('横方向のブロック数は1以上にしてください');
  if (group.levels < 1) errors.push('段数は1以上にしてください');
  if (group.unitsPerSlot < 1) errors.push('1列1段あたりの収納本数は1以上にしてください');
  if (group.rackWidthM <= 0 || group.rackDepthM <= 0) {
    errors.push('ラックの幅・奥行は0より大きい値にしてください');
  }
  if (group.columnGapM < 0 || group.blockGapM < 0) errors.push('間隔に負の値は指定できません');
  return errors;
}

/* ------------------------------------------------------------------ 生成 */

export interface GeneratedLocationGroup {
  group: LocationGroup;
  /** ロケーション住所ごとの配置オブジェクト (1住所 = 1ブロック) */
  objects: RackObject[];
  /** 物理収納単位 */
  locations: Location[];
  stats: LocationGroupStats;
}

/**
 * ロケーション住所と物理収納単位を生成する。
 *
 * 配置は「ブロックを横方向(X)に並べ、1ブロックの中で縦列を奥行方向(Y)に重ねる」。
 * 既存のラック描画・経路探索・シミュレーションをそのまま使えるよう、
 * 1ブロックを RackObject 1台として作る。
 */
export function generateLocationGroup(group: LocationGroup): GeneratedLocationGroup {
  const stats = locationGroupStats(group);
  const objects: RackObject[] = [];
  const locations: Location[] = [];

  for (let b = 0; b < group.horizontalBlocks; b++) {
    const blockIndex = b + 1;
    const locationCode = formatBlockCode(group.startNumber, blockIndex);
    const x = group.x + b * (stats.blockWidthM + group.blockGapM);

    const object: RackObject = {
      id: createId('rack'),
      layoutId: group.layoutId,
      kind: 'rack',
      name: locationCode,
      x,
      y: group.y,
      widthM: stats.blockWidthM,
      depthM: stats.blockDepthM,
      rotationDeg: 0,
      z: 0,
      rack: {
        columns: group.verticalColumns,
        levels: group.levels,
        capacityPerLocation: group.unitsPerSlot,
        face: 'front',
        // 縦列は奥行方向に重ねる（横幅を割るのではない）
        columnAxis: 'depth',
        rackTypeId: group.rackTypeId,
        block: {
          groupId: group.id,
          locationCode,
          blockIndex,
          singleSize: group.singleSizePerLocation,
        },
        naming: {
          // "001-1-C1-L1" の形にする
          pattern: '{area}-C{column}-L{level}',
          area: locationCode,
          columnStart: 1,
          columnDigits: 1,
          columnOrder: 'asc',
          levelStart: 1,
          levelDigits: 1,
          levelOrder: 'bottom-up',
        },
      },
    };

    objects.push(object);
    locations.push(...generateLocationsForRack(object));
  }

  return { group, objects, locations, stats };
}

/* --------------------------------------------- 住所ごとの状態と容量 (§8/§11/§12) */

/** ロケーション住所の状態。 */
export type LocationAddressStatus =
  | 'empty' // 空
  | 'inbound' // 入庫中
  | 'stored' // 在庫あり
  | 'full' // 満載
  | 'outbound'; // 出庫中

export const LOCATION_ADDRESS_STATUS_LABEL: Record<LocationAddressStatus, string> = {
  empty: '空',
  inbound: '入庫中',
  stored: '在庫あり',
  full: '満載',
  outbound: '出庫中',
};

/** 1つの物理収納単位 (001-1-C1-L1)。 */
export interface PhysicalSlotView {
  /** 既存 Location レコードの id */
  id: ID;
  code: string;
  columnIndex: number;
  levelIndex: number;
  capacity: number;
  currentQuantity: number;
  productSizeId?: ID;
}

/** 1つのロケーション住所 (001-1) の集計。 */
export interface LocationAddressView {
  locationCode: string;
  groupId?: ID;
  /** 住所に対応する配置オブジェクト */
  rackId: ID;
  blockIndex: number;
  /** 縦方向の物理列数 */
  columns: number;
  levels: number;
  /** 中心座標 (m) */
  x: number;
  y: number;
  widthM: number;
  depthM: number;
  status: LocationAddressStatus;
  /** 最大容量 */
  capacity: number;
  /** 現在在庫数 */
  currentQuantity: number;
  /** 空き容量 */
  freeCapacity: number;
  /** 使用率 (0-1) */
  usageRatio: number;
  /** この住所に入っている商品サイズ (1住所1サイズなら1件) */
  productSizeIds: ID[];
  slots: PhysicalSlotView[];
}

/** 集計に渡す在庫情報。シミュレーション結果から作る。 */
export interface AddressInventoryInput {
  /** ロケーションID -> 可搬ラックID */
  occupancy: ReadonlyMap<ID, ID>;
  /** 可搬ラックID -> 中身 */
  rackUnits: ReadonlyMap<ID, { currentUnits: number; capacityUnits: number; productSizeId?: ID; status?: string }>;
}

/**
 * ロケーション住所ごとに、物理収納単位・容量・在庫・ステータスをまとめる。
 *
 * 在庫情報を渡さない場合はすべて「空」として返す（生成直後の状態。§10）。
 */
export function summarizeLocationAddresses(
  objects: readonly RackObject[],
  locations: readonly Location[],
  inventory?: AddressInventoryInput,
): LocationAddressView[] {
  const byRack = new Map<ID, Location[]>();
  for (const location of locations) {
    const list = byRack.get(location.rackId) ?? [];
    list.push(location);
    byRack.set(location.rackId, list);
  }

  const views: LocationAddressView[] = [];

  for (const object of objects) {
    const block = object.rack.block;
    if (!block) continue;
    const slotsSource = (byRack.get(object.id) ?? []).slice().sort(
      (a, b) => a.column - b.column || a.level - b.level,
    );

    const slots: PhysicalSlotView[] = [];
    let capacity = 0;
    let current = 0;
    let inboundCount = 0;
    let outboundCount = 0;
    const sizes = new Set<ID>();

    for (const location of slotsSource) {
      const rackUnitId = inventory?.occupancy.get(location.id);
      const unit = rackUnitId ? inventory?.rackUnits.get(rackUnitId) : undefined;
      // 収納数はロケーション定義を優先し、無ければ実際のラックの満載本数を使う
      const slotCapacity = location.capacity > 0 ? location.capacity : (unit?.capacityUnits ?? 0);
      const quantity = unit?.currentUnits ?? 0;

      capacity += slotCapacity;
      current += quantity;
      if (unit?.productSizeId) sizes.add(unit.productSizeId);
      if (unit?.status === 'loading') inboundCount += 1;
      if (unit?.status === 'unloading') outboundCount += 1;

      slots.push({
        id: location.id,
        code: location.code,
        columnIndex: location.column,
        levelIndex: location.level,
        capacity: slotCapacity,
        currentQuantity: quantity,
        ...(unit?.productSizeId ? { productSizeId: unit.productSizeId } : {}),
      });
    }

    const status: LocationAddressStatus =
      outboundCount > 0
        ? 'outbound'
        : inboundCount > 0
          ? 'inbound'
          : current <= 0
            ? 'empty'
            : capacity > 0 && current >= capacity
              ? 'full'
              : 'stored';

    views.push({
      locationCode: block.locationCode,
      ...(block.groupId ? { groupId: block.groupId } : {}),
      rackId: object.id,
      blockIndex: block.blockIndex,
      columns: object.rack.columns,
      levels: object.rack.levels,
      x: object.x,
      y: object.y,
      widthM: object.widthM,
      depthM: object.depthM,
      status,
      capacity,
      currentQuantity: current,
      freeCapacity: Math.max(0, capacity - current),
      usageRatio: capacity > 0 ? current / capacity : 0,
      productSizeIds: [...sizes],
      slots,
    });
  }

  return views.sort(
    (a, b) => a.locationCode.localeCompare(b.locationCode, 'ja', { numeric: true }),
  );
}

/** 住所の集計から全体の数値を出す (§20 のレイアウト評価に使う)。 */
export interface LocationTotals {
  locationCount: number;
  slotCount: number;
  capacity: number;
  currentQuantity: number;
  freeCapacity: number;
  usageRatio: number;
  /** 使われている商品サイズの数 */
  sizeCount: number;
  emptyLocations: number;
  fullLocations: number;
}

export function locationTotals(views: readonly LocationAddressView[]): LocationTotals {
  const sizes = new Set<ID>();
  let capacity = 0;
  let current = 0;
  let slotCount = 0;
  let empty = 0;
  let full = 0;

  for (const view of views) {
    capacity += view.capacity;
    current += view.currentQuantity;
    slotCount += view.slots.length;
    if (view.status === 'empty') empty += 1;
    if (view.status === 'full') full += 1;
    for (const id of view.productSizeIds) sizes.add(id);
  }

  return {
    locationCount: views.length,
    slotCount,
    capacity,
    currentQuantity: current,
    freeCapacity: Math.max(0, capacity - current),
    usageRatio: capacity > 0 ? current / capacity : 0,
    sizeCount: sizes.size,
    emptyLocations: empty,
    fullLocations: full,
  };
}

/**
 * 保存済みのブロックからロケーショングループを復元する。
 *
 * ブロック(RackObject)には住所・グループID・列数・段数・収納数がすべて
 * 載っているため、グループ用のテーブルを増やさずに復元できる。
 */
export function deriveLocationGroups(
  objects: readonly RackObject[],
  warehouseId: ID,
  layoutId: ID,
): LocationGroup[] {
  const byGroup = new Map<ID, RackObject[]>();
  for (const object of objects) {
    const block = object.rack.block;
    if (!block) continue;
    const list = byGroup.get(block.groupId) ?? [];
    list.push(object);
    byGroup.set(block.groupId, list);
  }

  const groups: LocationGroup[] = [];
  for (const [groupId, blocks] of byGroup) {
    const sorted = blocks
      .slice()
      .sort((a, b) => (a.rack.block!.blockIndex ?? 0) - (b.rack.block!.blockIndex ?? 0));
    const first = sorted[0]!;
    const block = first.rack.block!;
    const startNumber = block.locationCode.replace(/-\d+$/, '');
    const columns = first.rack.columns;
    const rackDepthM = first.depthM / Math.max(1, columns);
    const blockGapM =
      sorted.length > 1 ? Math.max(0, sorted[1]!.x - first.x - first.widthM) : 0;

    groups.push({
      id: groupId,
      warehouseId,
      layoutId,
      name: `ロケーション ${startNumber}`,
      startNumber,
      rackTypeId: first.rack.rackTypeId ?? '',
      verticalColumns: columns,
      horizontalBlocks: sorted.length,
      levels: first.rack.levels,
      unitsPerSlot: first.rack.capacityPerLocation,
      rackWidthM: first.widthM,
      rackDepthM: Math.round(rackDepthM * 1000) / 1000,
      rackHeightM: LOCATION_GROUP_DEFAULTS.rackHeightM,
      columnGapM: 0,
      blockGapM: Math.round(blockGapM * 1000) / 1000,
      x: first.x,
      y: first.y,
      singleSizePerLocation: block.singleSize,
      createdAt: new Date(0).toISOString(),
    });
  }

  return groups.sort((a, b) => a.startNumber.localeCompare(b.startNumber, 'ja', { numeric: true }));
}
