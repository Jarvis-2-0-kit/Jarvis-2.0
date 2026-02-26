import { useGatewayStore } from '../../store/gateway-store.js';

const ROLE_LABELS: Record<string, string> = {
  orchestrator: 'ORCHESTRATOR',
  dev: 'DEVELOPER',
  marketing: 'MARKETING',
};

const AGENT_NAMES: Record<string, string> = {
  jarvis: 'JARVIS',
  'agent-smith': 'SMITH',
  'agent-johny': 'JOHNY',
};

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  idle: { label: 'IDLE', class: 'online' },
  busy: { label: 'ACTIVE', class: 'busy' },
  offline: { label: 'OFFLINE', class: 'offline' },
  error: { label: 'ERROR', class: 'error' },
  starting: { label: 'STARTING', class: 'busy' },
};

export function AgentPanel() {
  const agents = useGatewayStore((s) => s.agents);
  const activityLog = useGatewayStore((s) => s.activityLog);

  const agentList = Array.from(agents.values());

  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="panel-header">
        <span style={{ color: 'var(--cyan-bright)' }}>&gt;&gt;</span>
        AGENTS
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10 }}>
          {agentList.filter((a) => a.status !== 'offline').length}/{agentList.length} ONLINE
        </span>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {agentList.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--text-muted)' }}>
            <span style={{ animation: 'blink 1s ease-in-out infinite' }}>_</span>
            {' '}Waiting for agents to connect...
          </div>
        ) : (
          agentList.map((agent) => {
            const statusInfo = STATUS_LABELS[agent.status] ?? STATUS_LABELS['offline']!;
            const recentActivity = activityLog
              .filter((a) => a.agentId === agent.identity.agentId)
              .slice(-3);

            return (
              <div key={agent.identity.agentId} style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--border-primary)',
              }}>
                {/* Agent Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                }}>
                  <span className={`status-dot ${statusInfo.class}`} />
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 1,
                    color: 'var(--green-bright)',
                  }}>
                    {AGENT_NAMES[agent.identity.agentId] ?? agent.identity.agentId.toUpperCase()}
                  </span>
                  <span style={{
                    fontSize: 10,
                    color: 'var(--cyan-muted)',
                    fontFamily: 'var(--font-ui)',
                    letterSpacing: 1,
                  }}>
                    {ROLE_LABELS[agent.identity.role] ?? agent.identity.role}
                  </span>
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 10,
                    color: statusInfo.class === 'online' ? 'var(--green-muted)' :
                           statusInfo.class === 'busy' ? 'var(--amber)' :
                           statusInfo.class === 'error' ? 'var(--red-bright)' : 'var(--text-muted)',
                    fontWeight: 600,
                    letterSpacing: 1,
                  }}>
                    [{statusInfo.label}]
                  </span>
                </div>

                {/* Active Task */}
                {agent.activeTaskDescription && (
                  <div style={{
                    fontSize: 11,
                    color: 'var(--amber)',
                    paddingLeft: 16,
                    marginBottom: 4,
                  }}>
                    &gt; {agent.activeTaskDescription}
                  </div>
                )}

                {/* Stats */}
                <div style={{
                  display: 'flex',
                  gap: 12,
                  paddingLeft: 16,
                  fontSize: 10,
                  color: 'var(--text-muted)',
                }}>
                  <span>{agent.completedTasks} done</span>
                  {agent.failedTasks > 0 && (
                    <span style={{ color: 'var(--red-dim)' }}>{agent.failedTasks} failed</span>
                  )}
                </div>

                {/* Recent Activity */}
                {recentActivity.length > 0 && (
                  <div style={{ paddingLeft: 16, marginTop: 4 }}>
                    {recentActivity.map((a) => (
                      <div key={a.id} style={{
                        fontSize: 10,
                        color: 'var(--green-dim)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {a.detail}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
