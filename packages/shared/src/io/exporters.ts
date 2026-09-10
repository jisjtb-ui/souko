import { objectsToCsv } from './csv.js';
import { isForkliftObject, isRackObject } from '../domain/types.js';
import type { LayoutObject, LayoutSnapshot, Location, Product } from '../domain/types.js';

/** ロケーション一覧 CSV */
export function locationsToCsv(locations: readonly Location[], rackNameById: Map<string, string>): string {
  return objectsToCsv(locations, [
    { header: 'ロケーション番号', get: (l) => l.code },
    { header: 'ラックID', get: (l) => l.rackId },
    { header: 'ラック名', get: (l) => rackNameById.get(l.rackId) ?? '' },
    { header: '列', get: (l) => l.column },
    { header: '段', get: (l) => l.level },
    { header: 'X(m)', get: (l) => l.x },
    { header: 'Y(m)', get: (l) => l.y },
    { header: '作業位置X(m)', get: (l) => l.approachX },
    { header: '作業位置Y(m)', get: (l) => l.approachY },
    { header: '間口幅(m)', get: (l) => l.widthM },
    { header: '最大収納数', get: (l) => l.capacity },
    { header: 'カテゴリ', get: (l) => l.category ?? '' },
  ]);
}

/** 配置オブジェクト (ラック情報含む) CSV */
export function objectsToLayoutCsv(objects: readonly LayoutObject[]): string {
  return objectsToCsv(objects, [
    { header: 'ID', get: (o) => o.id },
    { header: '種別', get: (o) => o.kind },
    { header: '名称', get: (o) => o.name },
    { header: 'X(m)', get: (o) => o.x },
    { header: 'Y(m)', get: (o) => o.y },
    { header: '幅(m)', get: (o) => o.widthM },
    { header: '奥行(m)', get: (o) => o.depthM },
    { header: '回転(度)', get: (o) => o.rotationDeg },
    { header: '列数', get: (o) => (isRackObject(o) ? o.rack.columns : '') },
    { header: '段数', get: (o) => (isRackObject(o) ? o.rack.levels : '') },
    { header: '最大収納数', get: (o) => (isRackObject(o) ? o.rack.capacityPerLocation : '') },
    { header: 'エリア記号', get: (o) => (isRackObject(o) ? o.rack.naming.area : '') },
    { header: '最大速度(km/h)', get: (o) => (isForkliftObject(o) ? o.forklift.maxSpeedKmh : '') },
  ]);
}

export function productsToCsv(products: readonly Product[]): string {
  return objectsToCsv(products, [
    { header: '商品ID', get: (p) => p.code },
    { header: '商品名', get: (p) => p.name },
    { header: 'JANコード', get: (p) => p.janCode ?? '' },
    { header: 'カテゴリ', get: (p) => p.category ?? '' },
    { header: '幅(m)', get: (p) => p.widthM },
    { header: '奥行(m)', get: (p) => p.depthM },
    { header: '高さ(m)', get: (p) => p.heightM },
    { header: '重量(kg)', get: (p) => p.weightKg },
    { header: '出荷頻度', get: (p) => p.turnover },
    { header: 'パレット入数', get: (p) => p.unitsPerPallet },
  ]);
}

/** レイアウト全体を JSON でエクスポート (保存/読込・レイアウト比較の受け渡し用) */
export function snapshotToJson(snapshot: LayoutSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
