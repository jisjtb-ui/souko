/**
 * @ws/shared — Web / Server 共通のドメインモデルとシミュレーションエンジン。
 *
 * UI から独立させることで、将来サーバ側でのバッチシミュレーションや
 * レイアウト最適化 (Phase 8) にも同じロジックを再利用できる。
 */

export * from './domain/ids.js';
export * from './domain/types.js';
export * from './domain/objectSpecs.js';
export * from './domain/locations.js';
export * from './domain/areas.js';
export * from './domain/logistics.js';
export * from './domain/logisticsFactories.js';
export * from './domain/factories.js';
export * from './domain/sampleWarehouse.js';

export * from './geometry/index.js';
export * from './geometry/polygon.js';

export * from './sim/navGrid.js';
export * from './sim/astar.js';
export * from './sim/travel.js';
export * from './sim/random.js';
export * from './sim/racks.js';
export * from './sim/eventGeneration.js';
export * from './sim/slotting.js';
export * from './sim/engine.js';
export * from './sim/heatmap.js';
export * from './sim/analysis.js';
export * from './sim/stacking.js';

export * from './io/csv.js';
export * from './io/exporters.js';

export const API_VERSION = 1;
