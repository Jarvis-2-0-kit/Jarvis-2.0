import { useEffect, useState } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import { ScrollText, MessageSquare, Clock, Bot, ChevronRight } from 'lucide-react';

interface SessionInfo {
  id: string;
  agentId: string;
  taskId?: string;
  createdAt: number;
  messageCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

interface SessionDetail {
  id: string;
  agentId: string;
  messages: Array<{
    role: string;
    content: string;
    timestamp: number;
  }>;
  usage: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export function SessionsView() {
  const connected = useGatewayStore((s) => s.connected);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (connected) {
      void loadSessions();
    }
  }, [connected]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await gateway.request<SessionInfo[]>('sessions.list');
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      // sessions method may not exist yet
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSessionDetail = async (sessionId: string) => {
    try {
      const data = await gateway.request<SessionDetail>('sessions.get', { sessionId });
      setSelectedSession(data);
    } catch {
      setSelectedSession(null);
    }
  };

  const filteredSessions = filter === 'all'
    ? sessions
    : sessions.filter((s) => s.agentId === filter);

  const agentIds = [...new Set(sessions.map(s => s.agentId))];

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      {/* Sessions List */}
      <div style={{
        width: 360,
        minWidth: 360,
        borderRight: '1px solid var(--border-primary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <ScrollText size={16} color="var(--cyan-bright)" />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            letterSpacing: 2,
            color: 'var(--cyan-bright)',
          }}>
            SESSIONS
          </span>
          <span style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {filteredSessions.length}
          </span>
        </div>

        {/* Filters */}
        <div style={{
          padding: '6px 14px',
          borderBottom: '1px solid var(--border-dim)',
          display: 'flex',
          gap: 6,
          background: 'var(--bg-secondary)',
        }}>
          <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>ALL</FilterBtn>
          {agentIds.map(id => (
            <FilterBtn key={id} active={filter === id} onClick={() => setFilter(id)}>
              {id.replace('agent-', '').toUpperCase()}
            </FilterBtn>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              Loading sessions...
            </div>
          )}
          {!loading && filteredSessions.length === 0 && (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              No sessions found. Sessions will appear here when agents process tasks.
            </div>
          )}
          {filteredSessions.map((session) => (
            <div
              key={session.id}
              onClick={() => void loadSessionDetail(session.id)}
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border-dim)',
                cursor: 'pointer',
                background: selectedSession?.id === session.id ? 'var(--bg-hover)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => {
                if (selectedSession?.id !== session.id)
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
              }}
              onMouseLeave={(e) => {
                if (selectedSession?.id !== session.id)
                  e.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Bot size={12} color="var(--cyan-bright)" />
                <span style={{ fontSize: 11, color: 'var(--cyan-bright)', fontFamily: 'var(--font-mono)' }}>
                  {session.agentId}
                </span>
                <ChevronRight size={12} color="var(--text-muted)" style={{ marginLeft: 'auto' }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', display: 'flex', gap: 12 }}>
                <span><Clock size={10} style={{ verticalAlign: 'middle' }} /> {new Date(session.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', display: 'flex', gap: 12, marginTop: 2 }}>
                <span><MessageSquare size={10} style={{ verticalAlign: 'middle' }} /> {session.messageCount} msgs</span>
                <span>{session.totalTokens.toLocaleString()} tokens</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-dim)', background: 'var(--bg-secondary)' }}>
          <button onClick={() => void loadSessions()} style={{ width: '100%', fontSize: 10, padding: '4px 0' }}>
            REFRESH
          </button>
        </div>
      </div>

      {/* Session Detail */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {!selectedSession && (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
          }}>
            Select a session to view details
          </div>
        )}
        {selectedSession && (
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              <ScrollText size={16} color="var(--green-bright)" />
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                letterSpacing: 2,
                color: 'var(--green-bright)',
              }}>
                SESSION {selectedSession.id.slice(0, 8)}
              </span>
              <span style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                marginLeft: 'auto',
              }}>
                {selectedSession.usage.totalTokens.toLocaleString()} tokens
              </span>
            </div>

            {selectedSession.messages.map((msg, i) => (
              <div key={i} style={{
                marginBottom: 8,
                padding: '8px 12px',
                background: msg.role === 'assistant' ? 'rgba(0,255,65,0.03)' : 'rgba(0,255,255,0.03)',
                borderRadius: 4,
                borderLeft: `2px solid ${msg.role === 'assistant' ? 'var(--green-dim)' : 'var(--cyan-dim)'}`,
              }}>
                <div style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-display)',
                  letterSpacing: 1,
                  color: msg.role === 'assistant' ? 'var(--green-bright)' : 'var(--cyan-bright)',
                  marginBottom: 4,
                }}>
                  {msg.role.toUpperCase()}
                  {msg.timestamp && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div style={{
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 200,
                  overflow: 'auto',
                }}>
                  {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 9,
        padding: '2px 8px',
        background: active ? 'rgba(0,255,255,0.1)' : 'transparent',
        border: `1px solid ${active ? 'var(--cyan-dim)' : 'var(--border-dim)'}`,
        color: active ? 'var(--cyan-bright)' : 'var(--text-muted)',
        cursor: 'pointer',
        borderRadius: 3,
        fontFamily: 'var(--font-display)',
        letterSpacing: 1,
      }}
    >
      {children}
    </button>
  );
}
