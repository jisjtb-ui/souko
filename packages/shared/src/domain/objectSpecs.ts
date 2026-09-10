import type { LayoutObjectKind } from './types.js';

/** パレットに並べる配置オブジェクトの既定値。UI とドメインで共有する。 */
export interface ObjectKindSpec {
  kind: LayoutObjectKind;
  /** 日本語ラベル (UI 表示) */
  label: string;
  /** 分類 — ツールバーのグループ分け */
  group: 'storage' | 'structure' | 'area' | 'logistics' | 'equipment';
  /** 既定サイズ (m) */
  defaultWidthM: number;
  defaultDepthM: number;
  /** 塗り色 */
  fill: string;
  /** 枠線色 */
  stroke: string;
  /** 走行可能か (false = 障害物) */
  traversable: boolean;
  /** 入出庫の受け渡し地点になり得るか */
  dockPoint: boolean;
  /** 短い説明 (ツールチップ) */
  hint: string;
}

const SPEC_LIST: ObjectKindSpec[] = [
  {
    kind: 'rack',
    label: 'ラック',
    group: 'storage',
    defaultWidthM: 8,
    defaultDepthM: 1.2,
    fill: '#c8d8ee',
    stroke: '#41618f',
    traversable: false,
    dockPoint: false,
    hint: '列数・段数からロケーションを自動生成します',
  },
  {
    kind: 'shelf',
    label: '棚',
    group: 'storage',
    defaultWidthM: 2.4,
    defaultDepthM: 0.6,
    fill: '#d6e4d2',
    stroke: '#5c7d52',
    traversable: false,
    dockPoint: false,
    hint: '小物用の軽量棚。ラックと同様にロケーションを持ちます',
  },
  {
    kind: 'pillar',
    label: '柱',
    group: 'structure',
    defaultWidthM: 0.6,
    defaultDepthM: 0.6,
    fill: '#9aa3ad',
    stroke: '#5d646c',
    traversable: false,
    dockPoint: false,
    hint: '走行できない構造物',
  },
  {
    kind: 'wall',
    label: '壁',
    group: 'structure',
    defaultWidthM: 10,
    defaultDepthM: 0.3,
    fill: '#7f868e',
    stroke: '#4a5057',
    traversable: false,
    dockPoint: false,
    hint: '倉庫の壁・間仕切り',
  },
  {
    kind: 'door',
    label: '出入口',
    group: 'structure',
    defaultWidthM: 3,
    defaultDepthM: 0.3,
    fill: '#f3d9a4',
    stroke: '#a8802c',
    traversable: true,
    dockPoint: true,
    hint: '人・車両の出入口。通行可能',
  },
  {
    kind: 'truck-bay',
    label: 'トラックバース',
    group: 'area',
    defaultWidthM: 3.5,
    defaultDepthM: 12,
    fill: '#e6dcc8',
    stroke: '#8a7a52',
    traversable: true,
    dockPoint: true,
    hint: 'トラックの接車位置',
  },
  {
    kind: 'inbound-area',
    label: '入庫エリア',
    group: 'area',
    defaultWidthM: 8,
    defaultDepthM: 6,
    fill: '#cfe8d5',
    stroke: '#3f8557',
    traversable: true,
    dockPoint: true,
    hint: '入庫した荷物を一旦置く場所。入庫作業の起点になります',
  },
  {
    kind: 'shipping-area',
    label: '出荷エリア',
    group: 'area',
    defaultWidthM: 8,
    defaultDepthM: 6,
    fill: '#f7d7d2',
    stroke: '#b0503f',
    traversable: true,
    dockPoint: true,
    hint: 'ピッキングした荷物を集約する場所。出荷作業の終点になります',
  },
  {
    kind: 'staging-area',
    label: '一時置き場',
    group: 'area',
    defaultWidthM: 6,
    defaultDepthM: 4,
    fill: '#efe6c6',
    stroke: '#948334',
    traversable: true,
    dockPoint: true,
    hint: '仮置きスペース',
  },
  {
    kind: 'work-area',
    label: '作業エリア',
    group: 'area',
    defaultWidthM: 6,
    defaultDepthM: 4,
    fill: '#dedaf0',
    stroke: '#6a5fa8',
    traversable: true,
    dockPoint: false,
    hint: '検品・梱包などの作業スペース',
  },
  {
    kind: 'pedestrian-area',
    label: '歩行者エリア',
    group: 'area',
    defaultWidthM: 20,
    defaultDepthM: 1.2,
    fill: '#d9edf7',
    stroke: '#3d7f9e',
    traversable: true,
    dockPoint: false,
    hint: '歩行者通路。フォークリフトは進入コストが高くなります',
  },
  {
    kind: 'no-entry-area',
    label: '立入禁止',
    group: 'area',
    defaultWidthM: 4,
    defaultDepthM: 4,
    fill: '#f2c9c9',
    stroke: '#a83232',
    traversable: false,
    dockPoint: false,
    hint: 'フォークリフトが進入できないエリア',
  },
  {
    kind: 'inbound-gate',
    label: '倉入れ口',
    group: 'logistics',
    defaultWidthM: 6,
    defaultDepthM: 4,
    fill: '#bfe3c6',
    stroke: '#2f7d4f',
    traversable: true,
    dockPoint: true,
    hint: '入庫の起点。1日の倉入れ本数・サイズ別割合・時間帯別割合を設定します',
  },
  {
    kind: 'outbound-gate',
    label: '出荷ゲート',
    group: 'logistics',
    defaultWidthM: 6,
    defaultDepthM: 4,
    fill: '#f6c8bf',
    stroke: '#a63b28',
    traversable: true,
    dockPoint: true,
    hint: '出荷の終点。1日の出荷本数・処理能力・ボリューム割合を設定します',
  },
  {
    kind: 'empty-rack-yard',
    label: '空ラック置き場',
    group: 'logistics',
    defaultWidthM: 8,
    defaultDepthM: 6,
    fill: '#dfe3e8',
    stroke: '#59636e',
    traversable: true,
    dockPoint: true,
    hint: '空になったラックを積み重ねる場所。段数の上限まで積み上げます',
  },
  {
    kind: 'forklift',
    label: 'フォークリフト',
    group: 'equipment',
    defaultWidthM: 2.2,
    defaultDepthM: 1.2,
    fill: '#ffcf3f',
    stroke: '#8a6a00',
    traversable: true,
    dockPoint: false,
    hint: '初期位置に配置します。シミュレーションで走行します',
  },
];

export const OBJECT_SPECS: Record<LayoutObjectKind, ObjectKindSpec> = SPEC_LIST.reduce(
  (acc, spec) => {
    acc[spec.kind] = spec;
    return acc;
  },
  {} as Record<LayoutObjectKind, ObjectKindSpec>,
);

export const OBJECT_SPEC_LIST: readonly ObjectKindSpec[] = SPEC_LIST;

export function getObjectSpec(kind: LayoutObjectKind): ObjectKindSpec {
  return OBJECT_SPECS[kind];
}

/** 歩行者エリアの通行コスト倍率 (A* で使用)。 */
export const PEDESTRIAN_COST_MULTIPLIER = 4;
