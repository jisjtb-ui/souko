import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useSimulationStore } from '../store/simulationStore';

/**
 * 下部のイベントログ。
 * Phase 1 では編集操作を記録し、Phase 4 以降はシミュレーションイベントも
 * 同じ形式でここに流す。
 */
export function EventLog(): JSX.Element {
  const logs = useEditorStore((s) => s.logs);
  const simEvents = useSimulationStore((s) => s.snapshot?.events);
  const [collapsed, setCollapsed] = useState(false);
  const [source, setSource] = useState<'auto' | 'editor'>('auto');

  // シミュレーション実行中はその履歴を表示する（新しい順）
  const simRows = useMemo(() => {
    if (!simEvents || source === 'editor') return null;
    return simEvents
      .slice(-400)
      .reverse()
      .map((event) => ({
        id: event.id,
        time: event.atClock,
        level: event.type === 'error' ? ('error' as const) : ('info' as const),
        message: event.message,
      }));
  }, [simEvents, source]);

  const rows = simRows ?? logs;

  return (
    <footer className={collapsed ? 'eventlog collapsed' : 'eventlog'}>
      <div className="eventlog-head">
        <span className="panel-title">{simRows ? 'シミュレーションログ' : 'イベントログ'}</span>
        <span className="muted small">{rows.length} 件</span>
        {simEvents && (
          <button type="button" className="link" onClick={() => setSource(source === 'auto' ? 'editor' : 'auto')}>
            {source === 'auto' ? '編集ログを表示' : 'シミュレーションログを表示'}
          </button>
        )}
        <button type="button" className="link" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? '開く' : '閉じる'}
        </button>
      </div>
      {!collapsed && (
        <div className="eventlog-body">
          {rows.length === 0 && <div className="muted small">操作の記録がここに表示されます。</div>}
          {rows.map((entry) => (
            <div key={entry.id} className={`log-row ${entry.level}`}>
              <span className="log-time">{entry.time}</span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </footer>
  );
}
