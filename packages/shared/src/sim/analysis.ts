import { formatDurationJa } from '../geometry/index.js';
import { stackUtilization } from './stacking.js';
import type { ID } from '../domain/ids.js';
import type { RackType } from '../domain/logistics.js';
import type { SimulationKpi, SimulationSnapshot } from './engine.js';

/* ============================================================================
 * ボトルネック分析 (要件17) とレイアウト比較 (要件18)
 * ----------------------------------------------------------------------------
 * 「どこで物流が詰まっているか」を、シミュレーション結果から具体的に示す。
 * ========================================================================== */

export type BottleneckSeverity = 'critical' | 'warning' | 'info';

export type BottleneckCategory =
  | 'outbound-gate'
  | 'inbound-gate'
  | 'forklift'
  | 'aisle'
  | 'storage'
  | 'empty-yard'
  | 'stock';

export interface Bottleneck {
  id: string;
  category: BottleneckCategory;
  severity: BottleneckSeverity;
  /** 一行の警告文 */
  title: string;
  /** 根拠となる数値 */
  detail: string;
  /** 対象オブジェクト（クリックで選択できるようにする） */
  targetId?: ID;
}

export interface AnalysisInput {
  snapshot: SimulationSnapshot;
  rackTypes: readonly RackType[];
  /** シミュレーションの想定稼働時間（秒） */
  plannedSeconds: number;
}

/** シミュレーション結果からボトルネックを抽出する。 */
export function analyzeBottlenecks(input: AnalysisInput): Bottleneck[] {
  const { snapshot, rackTypes, plannedSeconds } = input;
  const kpi = snapshot.metrics;
  const found: Bottleneck[] = [];
  const elapsedHours = Math.max(0.1, kpi.elapsedSeconds / 3600);

  /* --- ゲート --- */
  for (const gate of kpi.gates) {
    const shortfall = gate.plannedUnits - gate.processedUnits;
    const requiredPerHour = gate.plannedUnits / Math.max(0.1, plannedSeconds / 3600);

    if (shortfall > gate.plannedUnits * 0.05 && gate.plannedUnits > 0) {
      const severity: BottleneckSeverity = shortfall > gate.plannedUnits * 0.2 ? 'critical' : 'warning';
      const category = gate.type === 'outbound' ? 'outbound-gate' : 'inbound-gate';
      const base = `計画 ${gate.plannedUnits.toLocaleString()}本に対し ${gate.processedUnits.toLocaleString()}本しか処理できませんでした（未処理 ${shortfall.toLocaleString()}本）。`;

      if (gate.utilization >= 0.7 || gate.capacityPerHour < requiredPerHour) {
        // ゲート自体が能力不足
        found.push({
          id: `gate-shortfall-${gate.objectId}`,
          category,
          severity,
          title: `${gate.name}の処理能力が不足しています`,
          detail: `${base}能力 ${gate.capacityPerHour.toLocaleString()}本/時に対し、必要な処理速度は ${Math.round(requiredPerHour).toLocaleString()}本/時です。`,
          targetId: gate.objectId,
        });
      } else {
        // ゲートには余力があり、前後の工程が追いついていない
        found.push({
          id: `gate-starved-${gate.objectId}`,
          category,
          severity,
          title: `${gate.name}が前後の工程待ちになっています`,
          detail: `${base}ゲートの稼働率は ${Math.round(gate.utilization * 100)}% で能力には余裕があります。フォークリフトの台数・在庫・保管場所を確認してください。`,
          targetId: gate.objectId,
        });
      }
    }

    if (gate.peakQueueLength >= 5) {
      const avgQueue = gate.totalWaitSeconds / Math.max(1, kpi.elapsedSeconds);
      found.push({
        id: `gate-queue-${gate.objectId}`,
        category: gate.type === 'outbound' ? 'outbound-gate' : 'inbound-gate',
        severity: gate.peakQueueLength >= 10 ? 'critical' : 'warning',
        title: `${gate.name}の前でラックが滞留しています`,
        detail: `最大 ${gate.peakQueueLength} 台が順番待ち（平均 ${avgQueue.toFixed(1)} 台が常時滞留）。同時処理台数を増やすか、他のゲートへ振り分けてください。`,
        targetId: gate.objectId,
      });
    }

    if (gate.forkliftWaitSeconds > 600) {
      found.push({
        id: `gate-berth-${gate.objectId}`,
        category: gate.type === 'outbound' ? 'outbound-gate' : 'inbound-gate',
        severity: gate.forkliftWaitSeconds > 3600 ? 'warning' : 'info',
        title: `${gate.name}のバース待ちが発生しています`,
        detail: `フォークリフトの待機時間 合計 ${formatDurationJa(gate.forkliftWaitSeconds)}。同時処理台数（現在 ${gate.pendingRacks >= 0 ? '' : ''}）の見直しを検討してください。`,
        targetId: gate.objectId,
      });
    }
  }

  /* --- フォークリフト --- */
  for (const vehicle of snapshot.vehicles) {
    const utilization = vehicle.workingSeconds / Math.max(1, kpi.elapsedSeconds);
    if (utilization > 0.9) {
      found.push({
        id: `forklift-busy-${vehicle.id}`,
        category: 'forklift',
        severity: utilization > 0.97 ? 'critical' : 'warning',
        title: `${vehicle.code}の稼働率が${Math.round(utilization * 100)}%です`,
        detail: `走行距離 ${Math.round(vehicle.travelledM).toLocaleString()}m / 作業 ${vehicle.completedTasks}件。台数を増やすか、動線を短くする余地があります。`,
        targetId: vehicle.id,
      });
    }
    if (vehicle.waitingSeconds > kpi.elapsedSeconds * 0.15) {
      found.push({
        id: `forklift-wait-${vehicle.id}`,
        category: 'aisle',
        severity: 'warning',
        title: `${vehicle.code}の待機時間が長すぎます`,
        detail: `待機 ${formatDurationJa(vehicle.waitingSeconds)}（全体の ${Math.round((vehicle.waitingSeconds / Math.max(1, kpi.elapsedSeconds)) * 100)}%）。通路の交差やゲート待ちが原因です。`,
        targetId: vehicle.id,
      });
    }
  }

  /* --- 計画時間内に終わったか（台数不足の判定） --- */
  const overtimeSeconds = kpi.elapsedSeconds - plannedSeconds;
  if (overtimeSeconds > plannedSeconds * 0.05) {
    found.push({
      id: 'overtime',
      category: 'forklift',
      severity: overtimeSeconds > plannedSeconds * 0.3 ? 'critical' : 'warning',
      title: '計画時間内に処理が終わりませんでした',
      detail: `${formatDurationJa(overtimeSeconds)} 超過しました（実績 ${formatDurationJa(kpi.elapsedSeconds)} / 計画 ${formatDurationJa(plannedSeconds)}）。`,
    });

    if (snapshot.vehicles.length > 0 && kpi.forkliftUtilization > 0.55) {
      found.push({
        id: 'forklift-shortage',
        category: 'forklift',
        severity: 'critical',
        title: `フォークリフトの台数が不足しています（稼働率 ${Math.round(kpi.forkliftUtilization * 100)}%）`,
        detail: `${snapshot.vehicles.length}台で ${kpi.completedTasks} 件を処理し、${formatDurationJa(overtimeSeconds)} 超過しました。台数を増やすか動線を短縮してください。`,
      });
    }
  }

  if (snapshot.vehicles.length > 0) {
    const avgUtilization = kpi.forkliftUtilization;
    if (avgUtilization < 0.25) {
      found.push({
        id: 'forklift-idle',
        category: 'forklift',
        severity: 'info',
        title: 'フォークリフトに余力があります',
        detail: `平均稼働率 ${Math.round(avgUtilization * 100)}%。台数を減らしても処理できる可能性があります。`,
      });
    }
  }

  /* --- 通路（渋滞） --- */
  const totalWait = snapshot.vehicles.reduce((sum, v) => sum + v.waitingSeconds, 0);
  if (totalWait > kpi.elapsedSeconds * 0.3) {
    const avgPerTask = totalWait / Math.max(1, kpi.completedTasks);
    found.push({
      id: 'aisle-congestion',
      category: 'aisle',
      severity: totalWait > kpi.elapsedSeconds ? 'critical' : 'warning',
      title: '通路で待機が発生しています',
      detail: `全車の待機時間 合計 ${formatDurationJa(totalWait)}（1作業あたり平均 ${avgPerTask.toFixed(0)}秒）。通路幅の確保や動線の分離を検討してください。`,
    });
  }

  /* --- 保管容量 --- */
  if (kpi.locationUsageRatio > 0.95) {
    found.push({
      id: 'storage-full',
      category: 'storage',
      severity: 'critical',
      title: '保管ロケーションがほぼ満杯です',
      detail: `使用率 ${Math.round(kpi.locationUsageRatio * 100)}%。空きが無いと倉入れが止まります。`,
    });
  } else if (kpi.locationUsageRatio < 0.2 && kpi.inboundUnits > 0) {
    found.push({
      id: 'storage-empty',
      category: 'storage',
      severity: 'info',
      title: '保管ロケーションに余裕があります',
      detail: `使用率 ${Math.round(kpi.locationUsageRatio * 100)}%。ラック配置を見直して動線を短縮できる可能性があります。`,
    });
  }

  /* --- 空ラック置き場 --- */
  const yard = stackUtilization(snapshot.stacks, rackTypes);
  if (yard.totalStacks > 0) {
    const ratio = yard.stackedRacks / Math.max(1, yard.capacity);
    if (yard.full || ratio > 0.9) {
      found.push({
        id: 'yard-full',
        category: 'empty-yard',
        severity: yard.full ? 'critical' : 'warning',
        title: yard.full ? '空ラック置き場が満杯になりました' : '空ラック置き場が逼迫しています',
        detail: `${yard.stackedRacks} / ${yard.capacity} 台（スタック ${yard.usedStacks}/${yard.totalStacks}）。置き場を広げるか、空ラックの回収頻度を上げてください。`,
      });
    }
  } else if (snapshot.rackUnits.some((r) => r.status === 'empty')) {
    found.push({
      id: 'yard-missing',
      category: 'empty-yard',
      severity: 'warning',
      title: '空ラック置き場がありません',
      detail: '出荷後の空ラックを片付けられず、ゲート前に溜まります。',
    });
  }

  /* --- 在庫切れ --- */
  if (snapshot.unfulfilledOutboundUnits > 0) {
    found.push({
      id: 'stock-out',
      category: 'stock',
      severity: snapshot.unfulfilledOutboundUnits > kpi.plannedOutboundUnits * 0.1 ? 'critical' : 'warning',
      title: '在庫不足で出荷できなかった分があります',
      detail: `${snapshot.unfulfilledOutboundUnits.toLocaleString()}本が出荷できませんでした。倉入れ量・初期在庫・サイズ別割合を見直してください。`,
    });
  }

  if (snapshot.abortedTasks > 0) {
    found.push({
      id: 'unreachable',
      category: 'aisle',
      severity: 'critical',
      title: '到達できない作業がありました',
      detail: `${snapshot.abortedTasks}件の作業が中断しました。シャッターの開閉やエリアの接続口、通路の遮断を確認してください。`,
    });
  }

  const severityOrder: Record<BottleneckSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return found.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

/* ------------------------------------------------------------ レイアウト比較 */

export interface ComparisonRow {
  key: string;
  label: string;
  unit: string;
  a: number;
  b: number;
  /** 小さいほど良い指標か */
  betterIsLower: boolean;
  /** 改善率 (%) — Bを基準にAからの変化 */
  changePct: number;
}

export interface LayoutComparison {
  labelA: string;
  labelB: string;
  rows: ComparisonRow[];
  /** 総合判定 */
  verdict: string;
}

/**
 * 同じ入出庫条件で実行した2つのレイアウトを比較する (要件18)。
 */
export function compareSimulations(
  a: { label: string; kpi: SimulationKpi; snapshot?: SimulationSnapshot },
  b: { label: string; kpi: SimulationKpi; snapshot?: SimulationSnapshot },
): LayoutComparison {
  const row = (
    key: string,
    label: string,
    unit: string,
    valueA: number,
    valueB: number,
    betterIsLower: boolean,
  ): ComparisonRow => ({
    key,
    label,
    unit,
    a: valueA,
    b: valueB,
    betterIsLower,
    changePct: valueA === 0 ? 0 : ((valueB - valueA) / valueA) * 100,
  });

  const gateWait = (kpi: SimulationKpi): number =>
    kpi.gates.reduce((sum, g) => sum + g.totalWaitSeconds, 0);

  const rows: ComparisonRow[] = [
    row('travel', '総搬送距離', 'm', a.kpi.totalTravelM, b.kpi.totalTravelM, true),
    row('avgTravel', '1作業あたり搬送距離', 'm', a.kpi.avgTravelPerTaskM, b.kpi.avgTravelPerTaskM, true),
    row('elapsed', '処理時間', '秒', a.kpi.elapsedSeconds, b.kpi.elapsedSeconds, true),
    row('avgTask', '平均作業時間', '秒', a.kpi.avgTaskSeconds, b.kpi.avgTaskSeconds, true),
    row('utilization', 'フォークリフト稼働率', '%', a.kpi.forkliftUtilization * 100, b.kpi.forkliftUtilization * 100, true),
    row('forkliftWait', 'フォークリフト待機時間', '秒', a.kpi.forkliftWaitSeconds, b.kpi.forkliftWaitSeconds, true),
    row('gateWait', 'ゲート滞留時間', '秒', gateWait(a.kpi), gateWait(b.kpi), true),
    row('inbound', '総入庫本数', '本', a.kpi.inboundUnits, b.kpi.inboundUnits, false),
    row('outbound', '総出庫本数', '本', a.kpi.outboundUnits, b.kpi.outboundUnits, false),
    row('tasks', '完了作業数', '件', a.kpi.completedTasks, b.kpi.completedTasks, false),
    row('locationUsage', 'ロケーション使用率', '%', a.kpi.locationUsageRatio * 100, b.kpi.locationUsageRatio * 100, false),
    row('stacked', '空ラック積み重ね数', '台', a.kpi.stackedRacks, b.kpi.stackedRacks, false),
  ];

  // 総合判定は「総搬送距離」と「処理時間」を主指標にする
  const travel = rows.find((r) => r.key === 'travel')!;
  const elapsed = rows.find((r) => r.key === 'elapsed')!;
  const improved = travel.changePct < -1 && elapsed.changePct <= 1;
  const worsened = travel.changePct > 1;
  const verdict = improved
    ? `${b.label} の方が総搬送距離を ${Math.abs(travel.changePct).toFixed(1)}% 削減できます`
    : worsened
      ? `${b.label} は総搬送距離が ${travel.changePct.toFixed(1)}% 増えます`
      : '2案に大きな差はありません';

  return { labelA: a.label, labelB: b.label, rows, verdict };
}
