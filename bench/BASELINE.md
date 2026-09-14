# パフォーマンス計測ベースライン（改善前）

計測環境: Chromium 1600x950 / Node 22 / 本番ビルド
再現手順: `node bench/seed.mjs <size>` でデータ投入 → `node bench/ui-bench.mjs <label> <index>`

## ブラウザ（本番ビルド）

| データ | ロケーション | 初期ロード | FCP | ドラッグ | パン | ズーム | メモリ | DOM |
|---|---|---|---|---|---|---|---|---|
| medium | 3,600 | 2,299ms | 260ms | 44.0fps (p95 33ms) | 52.3fps | 36.1fps | 33.7MB | 524 |
| large | 20,000 | 1,975ms | 256ms | **20.3fps (p95 117ms / max 150ms)** | **22.1fps** | **14.3fps** | 61.7MB | 681 |

## 計算層（Node）

| 項目 | small (180ロケ) | medium (3,600ロケ) |
|---|---|---|
| NavGrid構築 | 6.1ms | 42.8ms |
| A* 1回（対角） | 13.1ms | 43.3ms |
| エンジン初期化 | 6.3ms | 77.6ms |
| step() x100 | 1.6ms | 3.1ms |
| step+snapshot x100 | 5.2ms | **55.5ms** |
| 1日分フル実行 | 1.96s | **66.1s** |
| heatmap.cells() | 0.4ms | 0.8ms |
| ボトルネック分析 | 0.9ms | 1.9ms |

## CPUプロファイル

### エンジン 1日分フル実行（medium）
```
20.9%  isLocationEligible      sim/slotting.ts   全ロケーション走査
19.8%  rackUnitOccupancy       sim/engine.ts     占有Mapを毎回作り直し
19.2%  inventoryByArea         sim/engine.ts     エリア別在庫を毎回作り直し
 7.9%  buildPutawayTask        sim/engine.ts
~15%   findPath                sim/astar.ts
```

### ブラウザ ラックドラッグ中（large 20,000ロケ・開発ビルド）
```
 4.8%  findDuplicateCodes      locations.ts      全ロケーションのMap構築（毎フレーム）
 4.1%  (anonymous)             LocationLayer.tsx 列グルーピングMap構築（毎フレーム）
 7.3%  jsxDEV                  React要素生成（ロケーション毎にGroup+Rect）
 6.6%  applyNodeProps          react-konva ノード属性適用
 3.8%  commitMutationEffects   React reconciliation
 ~5%   drawScene/_drawChildren Konvaレイヤー全再描画
```

---

# 計測結果（改善後）

同一手順・同一環境で再計測。

## ブラウザ（本番ビルド）

| データ | ロケーション | 初期ロード | ドラッグ | パン | ズーム | メモリ | 備考 |
|---|---|---|---|---|---|---|---|
| medium | 3,600 | 1,156ms (−50%) | 60.0fps (+36%) | 60.0fps (+15%) | 60.0fps (+66%) | 18.3MB (−46%) | 全操作で上限60fps |
| large | 20,000 | 1,036ms (−48%) | 59.5fps (+193%) | 60.0fps (+171%) | 55.2fps (+286%) | 42.6MB (−31%) | p95 17ms |

## 計算層（Node）

| 項目 | small 前→後 | medium 前→後 |
|---|---|---|
| step+snapshot x100 | 5.2ms → 4.8ms | 55.5ms → 12.9ms (−77%) |
| 1日分フル実行 | 1.96s → 0.69s (−65%) | 66.1s → 14.8s (−78%) |

## UI応答性（一括実行中）

| 項目 | 前 | 後 |
|---|---|---|
| large 一括実行 | 完了まで画面が完全フリーズ | 約21秒・実行中も31fpsで操作可能＋進捗表示 |

## 計算結果の同一性

`node bench/verify.mjs` のKPIフィンガープリント（入庫/出庫/作業数/走行距離/経過時間/稼働率/待機/積み重ね/空き/使用率/未達/中断/ヒートマップ合計/ゲート別統計/イベント数）を
改善前（git stash）と改善後で比較し、small・medium 両データで完全一致を確認。
