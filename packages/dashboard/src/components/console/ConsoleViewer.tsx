import { useRef, useEffect } from 'react';
import { useGatewayStore } from '../../store/gateway-store.js';

export function ConsoleViewer() {
  const consoleLines = useGatewayStore((s) => s.consoleLines);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLines.length]);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span style={{ color: 'var(--cyan-bright)' }}>&gt;&gt;</span>
        CONSOLE
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10 }}>
          {consoleLines.length} LINES
        </span>
      </div>
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '8px 12px',
        fontSize: 11,
        lineHeight: 1.6,
        fontFamily: 'var(--font-mono)',
      }}>
        {consoleLines.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--green-dim)' }}>[system]</span> Console output will appear here...
            <br />
            <span style={{ animation: 'blink 1s ease-in-out infinite', color: 'var(--green-bright)' }}>_</span>
          </div>
        ) : (
          consoleLines.map((line, i) => (
            <div key={`line-${i}-${line.line.slice(0, 20)}`} style={{
              animation: 'slide-in 0.15s ease-out',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              <span style={{
                color: line.agentId === 'agent-smith' ? 'var(--cyan-muted)' : 'var(--purple)',
                fontSize: 10,
              }}>
                [{line.agentId === 'agent-smith' ? 'SMITH' : 'JOHNY'}]
              </span>
              {' '}
              <span style={{ color: 'var(--green-secondary)' }}>{line.line}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
