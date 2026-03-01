import { useRef, useEffect } from 'react';
import { useGatewayStore } from '../../store/gateway-store.js';

const AGENT_LABEL: Record<string, { label: string; color: string }> = {
  'agent-smith': { label: 'SMITH', color: 'var(--cyan-muted)' },
  'agent-johny': { label: 'JOHNY', color: 'var(--purple)' },
  jarvis: { label: 'JARVIS', color: 'var(--green-bright)' },
};

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
          consoleLines.map((line, i) => {
            const cfg = AGENT_LABEL[line.agentId] ?? { label: line.agentId.toUpperCase(), color: 'var(--text-muted)' };
            return (
              <div key={`line-${i}-${line.line.slice(0, 20)}`} style={{
                animation: 'slide-in 0.15s ease-out',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                <span style={{ color: cfg.color, fontSize: 10 }}>
                  [{cfg.label}]
                </span>
                {' '}
                <span style={{ color: 'var(--green-secondary)' }}>{line.line}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
