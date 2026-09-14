import { LogisticsSimulation, DEFAULT_SIM_CONFIG, NavGrid, findPath, analyzeBottlenecks, parseClock } from '@ws/shared';
import { SIZES, buildWarehouse, fmt, measure } from './lib.mjs';

const sizeKey = process.argv[2] ?? 'small';
const config = SIZES[sizeKey];
if (!config) throw new Error(`unknown size: ${sizeKey}`);

const built = measure('倉庫生成', () => buildWarehouse(config));
const wh = built.result;
console.log(`\n=== ${sizeKey}: ラック ${wh.meta.rackCount} 本 / ロケーション ${wh.meta.locationCount.toLocaleString()} 箇所 / ${wh.meta.widthM}x${wh.meta.depthM}m ===`);
console.log(`倉庫生成            ${fmt(built.median)}`);

const gridBuild = measure('NavGrid構築', () =>
  NavGrid.fromLayout(wh.warehouse, wh.objects, {
    cellM: 0.5, clearanceM: 0.7, areas: wh.areas, connections: wh.connections, shutters: wh.shutters,
  }), 3);
console.log(`NavGrid構築         ${fmt(gridBuild.median)}  (${gridBuild.result.cols}x${gridBuild.result.rows} セル)`);

const grid = gridBuild.result;
const a = { x: 5, y: 5 };
const b = { x: wh.meta.widthM - 5, y: wh.meta.depthM - 5 };
const path = measure('A*（対角）', () => findPath(grid, a, b), 5);
console.log(`A* 1回（対角）      ${fmt(path.median)}  found=${path.result.found} len=${path.result.lengthM.toFixed(0)}m`);

const simInput = {
  warehouse: wh.warehouse, objects: wh.objects, locations: wh.locations,
  areas: wh.areas, connections: wh.connections, shutters: wh.shutters,
  rackTypes: wh.rackTypes, productSizes: wh.productSizes,
  config: { ...DEFAULT_SIM_CONFIG, tickSeconds: 2 },
};

const init = measure('エンジン初期化', () => new LogisticsSimulation(simInput), 3);
console.log(`エンジン初期化      ${fmt(init.median)}`);

const sim = new LogisticsSimulation(simInput);
const snapCost = measure('snapshot() 1回', () => sim.snapshot(), 20);
console.log(`snapshot() 1回      ${fmt(snapCost.median)}`);
const kpiCost = measure('kpi() 1回', () => sim.kpi(), 20);
console.log(`kpi() 1回           ${fmt(kpiCost.median)}`);

const stepOnly = measure('step() x100', () => { for (let i = 0; i < 100; i++) sim.step(2); }, 3);
console.log(`step() x100         ${fmt(stepOnly.median)}  (1tickあたり ${fmt(stepOnly.median / 100)})`);

const stepWithSnap = measure('step+snapshot x100', () => {
  for (let i = 0; i < 100; i++) { sim.step(2); sim.snapshot(); }
}, 3);
console.log(`step+snapshot x100  ${fmt(stepWithSnap.median)}  ← 再生ループの実際の負荷`);

const full = measure('1日分フル実行', () => new LogisticsSimulation(simInput).runToEnd(), 1);
console.log(`1日分フル実行       ${fmt(full.median)}`);

const snapshot = full.result;
const heat = measure('heatmap.cells()', () => snapshot.heatmap.cells('traffic', 0.015), 5);
console.log(`heatmap.cells()     ${fmt(heat.median)}  (${heat.result.length.toLocaleString()} セル)`);
const hot = measure('heatmap.hotspots()', () => snapshot.heatmap.hotspots('congestion', 3, 5), 5);
console.log(`heatmap.hotspots()  ${fmt(hot.median)}`);
const analysis = measure('ボトルネック分析', () => analyzeBottlenecks({
  snapshot, rackTypes: wh.rackTypes, plannedSeconds: parseClock('17:00') - parseClock('08:00'),
  objects: wh.objects, areas: wh.areas,
}), 5);
console.log(`ボトルネック分析    ${fmt(analysis.median)}`);
console.log(`結果: 入庫 ${snapshot.metrics.inboundUnits} / 出荷 ${snapshot.metrics.outboundUnits} / 作業 ${snapshot.metrics.completedTasks} / 距離 ${Math.round(snapshot.metrics.totalTravelM)}m`);
