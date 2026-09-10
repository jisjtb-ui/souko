import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';

/**
 * 下部のイベントログ。
 * Phase 1 では編集操作を記録し、Phase 4 以降はシミュレーションイベントも
 * 同じ形式でここに流す。
 */
export function EventLog(): JSX.Element {
  const logs = useEditorStore((s) => s.logs);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <footer className={collapsed ? 'eventlog collapsed' : 'eventlog'}>
      <div className="eventlog-head">
        <span className="panel-title">イベントログ</span>
        <span className="muted small">{logs.length} 件</span>
        <button type="button" className="link" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? '開く' : '閉じる'}
        </button>
      </div>
      {!collapsed && (
        <div className="eventlog-body">
          {logs.length === 0 && <div className="muted small">操作の記録がここに表示されます。</div>}
          {logs.map((entry) => (
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
