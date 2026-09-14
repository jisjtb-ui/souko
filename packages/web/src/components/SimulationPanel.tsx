import { useState } from 'react';
import { SLOTTING_STRATEGY_LABEL, formatDurationJa } from '@ws/shared';
import type { Bottleneck, SlottingStrategyKey } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';
import { useSimulationStore } from '../store/simulationStore';

/**
 * 右パネルのシミュレーションタブ。
 * 設定 → 実行 → KPI → ボトルネック → レイアウト比較 を1か所にまとめる。
 */
export function SimulationPanel(): JSX.Element {
  const config = useSimulationStore((s) => s.config);
  const setConfig = useSimulationStore((s) => s.setConfig);
  const status = useSimulationStore((s) => s.status);
  const snapshot = useSimulationStore((s) => s.snapshot);
  const bottlenecks = useSimulationStore((s) => s.bottlenecks);
  const runToEnd = useSimulationStore((s) => s.runToEnd);
  const progress = useSimulationStore((s) => s.progress);
  const error = useSimulationStore((s) => s.error);

  return (
    <>
      <div className="panel-block">
        <div className="panel-title">シミュレーション設定</div>
        <div className="field-grid">
          <label className="field">
            <span>開始時刻</span>
            <input type="time" value={config.startTime} onChange={(e) => setConfig({ startTime: e.target.value })} />
          </label>
          <label className="field">
            <span>終了時刻</span>
            <input type="time" value={config.endTime} onChange={(e) => setConfig({ endTime: e.target.value })} />
          </label>
          <label className="field">
            <span>初期在庫の充填率</span>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={Math.round(config.initialFillRatio * 100)}
              onChange={(e) => setConfig({ initialFillRatio: Number(e.target.value) / 100 })}
            />
          </label>
          <label className="field">
            <span>荷役時間 (秒)</span>
            <input
              type="number"
              min={1}
              value={config.handlingSeconds}
              onChange={(e) => setConfig({ handlingSeconds: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <label className="field">
            <span>保管場所の決め方</span>
            <select
              value={config.slottingStrategy}
              onChange={(e) => setConfig({ slottingStrategy: e.target.value as SlottingStrategyKey })}
            >
              {(Object.keys(SLOTTING_STRATEGY_LABEL) as SlottingStrategyKey[]).map((key) => (
                <option key={key} value={key}>
                  {SLOTTING_STRATEGY_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>乱数シード</span>
            <input
              type="number"
              value={config.seed}
              onChange={(e) => setConfig({ seed: Number(e.target.value) })}
              title="同じシードなら同じ入出庫データで比較できます"
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={config.collisionAvoidance}
            onChange={(e) => setConfig({ collisionAvoidance: e.target.checked })}
          />
          通路での追突回避（渋滞をシミュレーション）
        </label>

        <div className="btn-row">
          <button type="button" className="primary" onClick={runToEnd} disabled={status === 'computing'}>
            {status === 'computing' ? `計算中… ${Math.round(progress * 100)}%` : '最後まで一括実行'}
          </button>
        </div>
        {status === 'computing' && (
          <div className="progress-bar">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {error && <p className="warn">{error}</p>}
        <p className="muted small">
          上部の ▶ で2Dアニメーション再生、こちらは結果だけを即座に集計します。
        </p>
      </div>

      {snapshot && <KpiBlock />}
      {bottlenecks.length > 0 && <BottleneckBlock issues={bottlenecks} />}
      {status === 'finished' && <ComparisonBlock />}
    </>
  );
}

function KpiBlock(): JSX.Element | null {
  const snapshot = useSimulationStore((s) => s.snapshot);
  if (!snapshot) return null;
  const m = snapshot.metrics;

  const stat = (label: string, value: string): JSX.Element => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <>
      <div className="panel-block">
        <div className="panel-title">実績（{snapshot.clock} 時点）</div>
        <dl className="stat-grid">
          {stat('総入庫本数', `${m.inboundUnits.toLocaleString()} / ${m.plannedInboundUnits.toLocaleString()}`)}
          {stat('総出庫本数', `${m.outboundUnits.toLocaleString()} / ${m.plannedOutboundUnits.toLocaleString()}`)}
          {stat('未処理入庫', `${m.pendingInboundUnits.toLocaleString()} 本`)}
          {stat('未処理出荷', `${m.pendingOutboundUnits.toLocaleString()} 本`)}
          {stat('総搬送距離', `${Math.round(m.totalTravelM).toLocaleString()} m`)}
          {stat('平均搬送距離', `${Math.round(m.avgTravelPerTaskM)} m/作業`)}
          {stat('平均作業時間', formatDurationJa(m.avgTaskSeconds))}
          {stat('完了作業', `${m.completedTasks.toLocaleString()} 件`)}
          {stat('フォークリフト稼働率', `${Math.round(m.forkliftUtilization * 100)} %`)}
          {stat('待機時間', formatDurationJa(m.forkliftWaitSeconds))}
          {stat('ロケーション使用率', `${Math.round(m.locationUsageRatio * 100)} %`)}
          {stat('倉庫収納率', `${Math.round(m.storageFillRatio * 100)} %`)}
          {stat('空ラック', `${m.emptyRacks} 台`)}
          {stat('積み重ね済み', `${m.stackedRacks} 台`)}
          {stat('在庫不足', `${snapshot.unfulfilledOutboundUnits.toLocaleString()} 本`)}
          {stat('中断作業', `${snapshot.abortedTasks} 件`)}
        </dl>
      </div>

      <div className="panel-block">
        <div className="panel-title">ゲート別</div>
        <table className="master-table">
          <thead>
            <tr>
              <th>ゲート</th>
              <th>処理/計画</th>
              <th>能力</th>
              <th>稼働</th>
              <th title="ゲート前でラックが待った時間">滞留</th>
              <th title="最大の待ち台数">最大待</th>
            </tr>
          </thead>
          <tbody>
            {m.gates.map((gate) => (
              <tr key={gate.objectId}>
                <td>{gate.name}</td>
                <td>
                  {gate.processedUnits.toLocaleString()}/{gate.plannedUnits.toLocaleString()}
                </td>
                <td>{gate.capacityPerHour.toLocaleString()}/h</td>
                <td>{Math.round(gate.utilization * 100)}%</td>
                <td>{formatDurationJa(gate.totalWaitSeconds)}</td>
                <td>{gate.peakQueueLength}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-block">
        <div className="panel-title">フォークリフト</div>
        <table className="master-table">
          <thead>
            <tr>
              <th>車両</th>
              <th>状態</th>
              <th>作業</th>
              <th>距離</th>
              <th>待機</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.vehicles.map((vehicle) => (
              <tr key={vehicle.id}>
                <td>{vehicle.code}</td>
                <td>{vehicle.activity}</td>
                <td>{vehicle.completedTasks}</td>
                <td>{Math.round(vehicle.travelledM).toLocaleString()}m</td>
                <td>{formatDurationJa(vehicle.waitingSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BottleneckBlock({ issues }: { issues: Bottleneck[] }): JSX.Element {
  const select = useEditorStore((s) => s.select);
  return (
    <div className="panel-block">
      <div className="panel-title">ボトルネック分析</div>
      {issues.map((issue) => (
        <div key={issue.id} className={`bottleneck ${issue.severity}`}>
          <div className="bottleneck-title">
            {issue.severity === 'critical' ? '■' : issue.severity === 'warning' ? '▲' : 'ｉ'} {issue.title}
          </div>
          <div className="bottleneck-detail">{issue.detail}</div>
          {issue.targetId && (
            <button type="button" className="link" onClick={() => select([issue.targetId!])}>
              対象を表示
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ComparisonBlock(): JSX.Element {
  const savedRuns = useSimulationStore((s) => s.savedRuns);
  const saveRun = useSimulationStore((s) => s.saveRun);
  const compareSaved = useSimulationStore((s) => s.compareSaved);
  const comparison = useSimulationStore((s) => s.comparison);
  const clearRuns = useSimulationStore((s) => s.clearRuns);
  const layoutName = useEditorStore((s) => s.layout?.name ?? 'レイアウト');
  const [label, setLabel] = useState('');

  return (
    <div className="panel-block">
      <div className="panel-title">レイアウト比較</div>
      <div className="btn-row">
        <input
          className="master-name"
          placeholder={layoutName}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="button" onClick={() => saveRun(label || layoutName)}>
          結果を保存
        </button>
      </div>

      {savedRuns.length > 0 && (
        <div className="area-list">
          {savedRuns.map((run, index) => (
            <div key={index} className="list-row-button">
              <span>{run.label}</span>
              <span className="muted small">{Math.round(run.kpi.totalTravelM).toLocaleString()}m</span>
              <span className="muted small">{formatDurationJa(run.kpi.elapsedSeconds)}</span>
            </div>
          ))}
        </div>
      )}

      {savedRuns.length >= 2 && (
        <div className="btn-row">
          <button type="button" onClick={() => compareSaved(savedRuns.length - 2, savedRuns.length - 1)}>
            直近2件を比較
          </button>
          <button type="button" onClick={clearRuns}>
            クリア
          </button>
        </div>
      )}

      {comparison && (
        <>
          <p className="comparison-verdict">{comparison.verdict}</p>
          <table className="master-table">
            <thead>
              <tr>
                <th>指標</th>
                <th>{comparison.labelA}</th>
                <th>{comparison.labelB}</th>
                <th>差</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => {
                const improved = row.betterIsLower ? row.changePct < 0 : row.changePct > 0;
                return (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{formatValue(row.a, row.unit)}</td>
                    <td>{formatValue(row.b, row.unit)}</td>
                    <td className={improved ? 'delta good' : row.changePct === 0 ? '' : 'delta bad'}>
                      {row.changePct > 0 ? '+' : ''}
                      {row.changePct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <p className="muted small">
        同じ乱数シードのまま別レイアウトを実行すると、同一の入出庫データで比較できます。
      </p>
    </div>
  );
}

function formatValue(value: number, unit: string): string {
  if (unit === '秒') return formatDurationJa(value);
  if (unit === '%') return `${value.toFixed(1)}%`;
  return `${Math.round(value).toLocaleString()}${unit}`;
}
