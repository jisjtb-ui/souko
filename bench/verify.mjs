import { LogisticsSimulation, DEFAULT_SIM_CONFIG } from '@ws/shared';
import { SIZES, buildWarehouse } from './lib.mjs';

/** 決定論的な入力で実行し、結果の指紋を出す（変更前後で完全一致すべき）。 */
const size = process.argv[2] ?? 'small';
const wh = buildWarehouse(SIZES[size]);
const sim = new LogisticsSimulation({
  warehouse: wh.warehouse, objects: wh.objects, locations: wh.locations,
  areas: wh.areas, connections: wh.connections, shutters: wh.shutters,
  rackTypes: wh.rackTypes, productSizes: wh.productSizes,
  config: { ...DEFAULT_SIM_CONFIG, tickSeconds: 2, seed: 20240101 },
});
const t0 = performance.now();
const snap = sim.runToEnd();
const ms = performance.now() - t0;
const m = snap.metrics;
console.log(JSON.stringify({
  size, runMs: Math.round(ms),
  inbound: m.inboundUnits, outbound: m.outboundUnits, tasks: m.completedTasks,
  travelM: +m.totalTravelM.toFixed(3), elapsed: +m.elapsedSeconds.toFixed(1),
  util: +m.forkliftUtilization.toFixed(6), wait: +m.forkliftWaitSeconds.toFixed(3),
  stacked: m.stackedRacks, empty: m.emptyRacks, occupied: snap.occupancy.size,
  unfulfilled: snap.unfulfilledOutboundUnits, aborted: snap.abortedTasks,
  heatTraffic: +snap.heatmap.totalOf('traffic').toFixed(3),
  heatCongestion: +snap.heatmap.totalOf('congestion').toFixed(3),
  heatWork: +snap.heatmap.totalOf('work').toFixed(3),
  gates: m.gates.map((g) => `${g.name}:${g.processedUnits}/${Math.round(g.totalWaitSeconds)}`),
  events: snap.events.length,
}));
