import { createId } from './ids.js';
import type { ID } from './ids.js';
import { localToWorld, round } from '../geometry/index.js';
import type { Location, LocationNamingRule, RackObject } from './types.js';

/** ラック面からフォークリフト停車位置までの距離 (m)。 */
export const DEFAULT_APPROACH_OFFSET_M = 1.2;

export const DEFAULT_NAMING_RULE: LocationNamingRule = {
  pattern: '{area}-{column}-{level}',
  area: 'A',
  columnStart: 1,
  columnDigits: 2,
  columnOrder: 'asc',
  levelStart: 1,
  levelDigits: 2,
  levelOrder: 'bottom-up',
};

export interface NamingContext {
  area: string;
  column: number;
  level: number;
  columnDigits: number;
  levelDigits: number;
  /** ラック内の通し番号 (1 始まり) */
  index: number;
}

const pad = (value: number, digits: number): string => String(value).padStart(digits, '0');

/**
 * 採番ルールからロケーション番号を生成する。
 * 使えるトークン: {area} {column} {level} {index}
 */
export function formatLocationCode(rule: LocationNamingRule, ctx: NamingContext): string {
  return rule.pattern
    .replace(/\{area\}/g, ctx.area)
    .replace(/\{column\}/g, pad(ctx.column, ctx.columnDigits))
    .replace(/\{level\}/g, pad(ctx.level, ctx.levelDigits))
    .replace(/\{index\}/g, String(ctx.index));
}

/** 採番ルールの検証。UI のバリデーション用。 */
export function validateNamingRule(rule: LocationNamingRule): string[] {
  const errors: string[] = [];
  if (!rule.pattern.trim()) errors.push('命名パターンを入力してください');
  if (!/\{column\}/.test(rule.pattern) && !/\{index\}/.test(rule.pattern)) {
    errors.push('パターンに {column} か {index} を含めてください（番号が重複します）');
  }
  if (rule.columnDigits < 1 || rule.columnDigits > 6) errors.push('列の桁数は1〜6です');
  if (rule.levelDigits < 1 || rule.levelDigits > 6) errors.push('段の桁数は1〜6です');
  return errors;
}

/**
 * ラックから内部ロケーションを自動生成する。
 *
 * 2D 平面図なので、同じ列の各段は同一座標に重なる（高さ方向は段数で表現）。
 * approach 座標は「ピッキング面から通路側へ DEFAULT_APPROACH_OFFSET_M だけ離れた点」。
 */
export function generateLocationsForRack(
  rack: RackObject,
  options: { approachOffsetM?: number } = {},
): Location[] {
  const { columns, levels, naming, capacityPerLocation, category, face } = rack.rack;
  const offset = options.approachOffsetM ?? DEFAULT_APPROACH_OFFSET_M;
  const bayWidth = rack.widthM / Math.max(1, columns);
  const locations: Location[] = [];
  let index = 0;

  for (let c = 0; c < columns; c++) {
    const columnNo =
      naming.columnOrder === 'asc' ? naming.columnStart + c : naming.columnStart + (columns - 1 - c);

    for (let l = 0; l < levels; l++) {
      const levelNo =
        naming.levelOrder === 'bottom-up'
          ? naming.levelStart + l
          : naming.levelStart + (levels - 1 - l);
      index += 1;

      const localCenter = { x: bayWidth * (c + 0.5), y: rack.depthM / 2 };
      const world = localToWorld(rack, localCenter);

      // ピッキング面: front = ローカル -Y 側, back = ローカル +Y 側
      const approachLocal =
        face === 'back'
          ? { x: localCenter.x, y: rack.depthM + offset }
          : { x: localCenter.x, y: -offset };
      const approachWorld = localToWorld(rack, approachLocal);

      locations.push({
        id: createId('loc'),
        layoutId: rack.layoutId,
        rackId: rack.id,
        code: formatLocationCode(naming, {
          area: naming.area,
          column: columnNo,
          level: levelNo,
          columnDigits: naming.columnDigits,
          levelDigits: naming.levelDigits,
          index,
        }),
        column: columnNo,
        level: levelNo,
        x: round(world.x),
        y: round(world.y),
        approachX: round(approachWorld.x),
        approachY: round(approachWorld.y),
        widthM: round(bayWidth),
        depthM: rack.depthM,
        capacity: capacityPerLocation,
        ...(category ? { category } : {}),
      });
    }
  }
  return locations;
}

/**
 * レイアウト内でロケーション番号が重複していないか調べる。
 * 重複したコードと件数を返す。
 */
export function findDuplicateCodes(locations: readonly Location[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const loc of locations) {
    counts.set(loc.code, (counts.get(loc.code) ?? 0) + 1);
  }
  return new Map([...counts].filter(([, n]) => n > 1));
}

/**
 * 採番ルールのプレビュー (先頭 n 件)。ラック配置ダイアログで使う。
 */
export function previewLocationCodes(
  rule: LocationNamingRule,
  columns: number,
  levels: number,
  limit = 6,
): string[] {
  const out: string[] = [];
  let index = 0;
  for (let c = 0; c < columns && out.length < limit; c++) {
    for (let l = 0; l < levels && out.length < limit; l++) {
      index += 1;
      const columnNo =
        rule.columnOrder === 'asc' ? rule.columnStart + c : rule.columnStart + (columns - 1 - c);
      const levelNo =
        rule.levelOrder === 'bottom-up' ? rule.levelStart + l : rule.levelStart + (levels - 1 - l);
      out.push(
        formatLocationCode(rule, {
          area: rule.area,
          column: columnNo,
          level: levelNo,
          columnDigits: rule.columnDigits,
          levelDigits: rule.levelDigits,
          index,
        }),
      );
    }
  }
  return out;
}

/** 既存ロケーションのうち、指定ラックに属するものを除いたリストを返す。 */
export function withoutRackLocations(locations: readonly Location[], rackId: ID): Location[] {
  return locations.filter((l) => l.rackId !== rackId);
}
