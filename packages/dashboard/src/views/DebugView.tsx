import { useEffect, useState, useRef, useCallback } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  Bug,
  Send,
  Trash2,
  Copy,
  RefreshCw,
  Terminal,
  Zap,
  Eye,
  Clock,
  Filter,
  Download,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Hash,
  Timer,
  Bookmark,
} from 'lucide-react';

interface EventLogEntry {
  id: number;
  event: string;
  payload: unknown;
  timestamp: number;
}

interface RpcHistoryEntry {
  method: string;
  params: string;
  result: string;
  duration: number;
  timestamp: number;
  isError: boolean;
}

const ALL_METHODS = [
  { group: 'System', methods: ['health', 'health.detailed', 'system.metrics', 'system.processes'] },
  { group: 'Agents', methods: ['agents.list', 'agents.capabilities'] },
  { group: 'Tasks', methods: ['tasks.list', 'orchestrator.graph', 'orchestrator.ready'] },
  { group: 'Data', methods: ['sessions.list', 'usage.summary', 'logs.get', 'metrics.usage'] },
  { group: 'Config', methods: ['config.get', 'vnc.info', 'environment.list', 'apikeys.list'] },
  { group: 'Features', methods: ['notifications.config.get', 'scheduler.list', 'scheduler.history', 'workflows.list', 'workflows.runs', 'integrations.status'] },
];

const EVENT_COLORS: Record<string, string> = {
  'agent.': 'var(--cyan-bright)',
  'task.': 'var(--green-bright)',
  'chat.': 'var(--purple)',
  'system.': 'var(--amber)',
  'workflow.': 'var(--blue)',
  'log.': 'var(--text-muted)',
};

function getEventColor(event: string): string {
  for (const [prefix, color] of Object.entries(EVENT_COLORS)) {
    if (event.startsWith(prefix)) return color;
  }
  return 'var(--text-secondary)';
}

let eventLogId = 0;

export function DebugView() {
  const connected = useGatewayStore((s) => s.connected);

  // RPC Caller
  const [method, setMethod] = useState('health');
  const [params, setParams] = useState('{}');
  const [result, setResult] = useState<string>('');
  const [calling, setCalling] = useState(false);
  const [rpcHistory, setRpcHistory] = useState<RpcHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Saved Methods
  const [savedMethods, setSavedMethods] = useState<Array<{ method: string; params: string }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('jarvis-debug-saved') || '[]');
    } catch { return []; }
  });

  // Event Log
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [captureEvents, setCaptureEvents] = useState(true);
  const [eventFilter, setEventFilter] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<EventLogEntry | null>(null);
  const [showEventFilter, setShowEventFilter] = useState(false);
  const eventLogRef = useRef<HTMLDivElement>(null);

  // Raw Health
  const [rawHealth, setRawHealth] = useState<string>('');

  // Stats
  const [eventStats, setEventStats] = useState<Record<string, number>>({});

  // Capture all gateway events
  useEffect(() => {
    if (!connected || !captureEvents) return;

    const events = [
      'agent.status', 'agent.heartbeat', 'agent.activity',
      'task.created', 'task.completed', 'task.progress', 'task.assigned', 'task.cancelled',
      'chat.message', 'chat.response',
      'system.health',
      'workflow.started', 'workflow.completed', 'workflow.failed',
      'log.line',
    ];

    const unsubs = events.map((event) =>
      gateway.on(event, (payload) => {
        setEventLog((prev) => [
          ...prev.slice(-500),
          { id: ++eventLogId, event, payload, timestamp: Date.now() },
        ]);
        setEventStats((prev) => ({
          ...prev,
          [event]: (prev[event] || 0) + 1,
        }));
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [connected, captureEvents]);

  // Auto-scroll event log
  useEffect(() => {
    if (eventLogRef.current && !selectedEvent) {
      eventLogRef.current.scrollTop = eventLogRef.current.scrollHeight;
    }
  }, [eventLog, selectedEvent]);

  const handleRpcCall = useCallback(async () => {
    setCalling(true);
    setResult('');
    const start = performance.now();
    try {
      const parsedParams = JSON.parse(params);
      const res = await gateway.request(method, parsedParams);
      const duration = performance.now() - start;
      const resultStr = JSON.stringify(res, null, 2);
      setResult(resultStr);
      setRpcHistory((prev) => [...prev.slice(-50), {
        method, params, result: resultStr, duration, timestamp: Date.now(), isError: false,
      }]);
    } catch (err) {
      const duration = performance.now() - start;
      const errStr = `Error: ${(err as Error).message}`;
      setResult(errStr);
      setRpcHistory((prev) => [...prev.slice(-50), {
        method, params, result: errStr, duration, timestamp: Date.now(), isError: true,
      }]);
    } finally {
      setCalling(false);
    }
  }, [method, params]);

  const refreshHealth = async () => {
    try {
      const data = await gateway.request('health.detailed');
      setRawHealth(JSON.stringify(data, null, 2));
    } catch (err) {
      setRawHealth(`Error: ${(err as Error).message}`);
    }
  };

  useEffect(() => {
    if (connected) void refreshHealth();
  }, [connected]);

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  const saveMethod = () => {
    const entry = { method, params };
    const updated = [...savedMethods.filter((s) => s.method !== method), entry];
    setSavedMethods(updated);
    localStorage.setItem('jarvis-debug-saved', JSON.stringify(updated));
  };

  const exportEventLog = () => {
    const data = JSON.stringify(eventLog, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jarvis-events-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredEvents = eventFilter
    ? eventLog.filter((e) => e.event.includes(eventFilter))
    : eventLog;

  const topEvents = Object.entries(eventStats)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      {/* Left: RPC Caller + Health */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: 16,
        borderRight: '1px solid var(--border-primary)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Bug size={18} color="var(--amber)" />
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            letterSpacing: 2,
            color: 'var(--amber)',
            margin: 0,
          }}>
            DEBUG TOOLS
          </h1>
          <div style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            {connected ? <Wifi size={12} color="var(--green-bright)" /> : <WifiOff size={12} color="var(--red-bright)" />}
            <span style={{
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              color: connected ? 'var(--green-bright)' : 'var(--red-bright)',
            }}>
              {connected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
        </div>

        {/* Manual RPC Caller */}
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 6,
          marginBottom: 16,
        }}>
          <div style={{
            padding: '8px 14px',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: 2,
            color: 'var(--green-bright)',
          }}>
            <Terminal size={14} />
            RPC CALLER
            {rpcHistory.length > 0 && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                style={{
                  marginLeft: 'auto',
                  fontSize: 8,
                  padding: '2px 6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  color: showHistory ? 'var(--cyan-bright)' : 'var(--text-muted)',
                  borderColor: showHistory ? 'var(--cyan-dim)' : 'var(--border-dim)',
                }}
              >
                <Clock size={8} />
                HISTORY ({rpcHistory.length})
              </button>
            )}
          </div>

          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                placeholder="Method name (e.g. health, agents.list)"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                style={{ flex: 1, fontSize: 12 }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleRpcCall(); }}
              />
              <button
                onClick={saveMethod}
                title="Save method"
                style={{ fontSize: 8, padding: '4px 6px' }}
              >
                <Bookmark size={10} />
              </button>
              <button
                onClick={() => void handleRpcCall()}
                disabled={calling || !connected}
                className="primary"
                style={{
                  fontSize: 10,
                  padding: '4px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: (calling || !connected) ? 0.5 : 1,
                }}
              >
                <Send size={10} />
                {calling ? 'CALLING...' : 'SEND'}
              </button>
            </div>

            <textarea
              placeholder='{"key": "value"}'
              value={params}
              onChange={(e) => setParams(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                resize: 'vertical',
                marginBottom: 8,
              }}
              spellCheck={false}
            />

            {/* Method groups */}
            {ALL_METHODS.map((group) => (
              <div key={group.group} style={{ marginBottom: 6 }}>
                <span style={{
                  fontSize: 7,
                  fontFamily: 'var(--font-display)',
                  letterSpacing: 1,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                }}>
                  {group.group}
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
                  {group.methods.map((m) => (
                    <button
                      key={m}
                      onClick={() => { setMethod(m); setParams('{}'); }}
                      style={{
                        fontSize: 8,
                        padding: '2px 6px',
                        color: method === m ? 'var(--cyan-bright)' : 'var(--text-muted)',
                        borderColor: method === m ? 'var(--cyan-dim)' : 'var(--border-dim)',
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Saved methods */}
            {savedMethods.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span style={{
                  fontSize: 7,
                  fontFamily: 'var(--font-display)',
                  letterSpacing: 1,
                  color: 'var(--amber)',
                  textTransform: 'uppercase',
                }}>
                  Saved
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
                  {savedMethods.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setMethod(s.method); setParams(s.params); }}
                      style={{
                        fontSize: 8,
                        padding: '2px 6px',
                        color: 'var(--amber)',
                        borderColor: 'var(--amber-dim)',
                      }}
                    >
                      <Bookmark size={7} style={{ marginRight: 3 }} />
                      {s.method}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* RPC History */}
            {showHistory && rpcHistory.length > 0 && (
              <div style={{
                marginTop: 8,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-dim)',
                borderRadius: 4,
                maxHeight: 160,
                overflow: 'auto',
              }}>
                {[...rpcHistory].reverse().map((h, i) => (
                  <div
                    key={i}
                    onClick={() => { setMethod(h.method); setParams(h.params); setResult(h.result); }}
                    style={{
                      padding: '3px 8px',
                      borderBottom: '1px solid rgba(33,38,45,0.3)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{
                      fontSize: 8,
                      color: h.isError ? 'var(--red-bright)' : 'var(--green-bright)',
                      fontWeight: 600,
                    }}>
                      {h.isError ? 'ERR' : 'OK'}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {h.method}
                    </span>
                    <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Timer size={7} />
                      {h.duration.toFixed(0)}ms
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Result */}
            {result && (
              <div style={{
                position: 'relative',
                background: 'var(--bg-primary)',
                border: `1px solid ${result.startsWith('Error') ? 'var(--red-dim)' : 'var(--border-dim)'}`,
                borderRadius: 4,
                padding: 10,
                maxHeight: 300,
                overflow: 'auto',
                marginTop: 8,
              }}>
                <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 2 }}>
                  <button
                    onClick={() => copyToClipboard(result)}
                    style={{ fontSize: 8, padding: '2px 6px' }}
                  >
                    <Copy size={10} />
                  </button>
                  <button
                    onClick={() => setResult('')}
                    style={{ fontSize: 8, padding: '2px 6px' }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
                <pre style={{
                  margin: 0,
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: result.startsWith('Error') ? 'var(--red-bright)' : 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {result}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Raw Health Snapshot */}
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 6,
        }}>
          <div style={{
            padding: '8px 14px',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: 2,
            color: 'var(--green-bright)',
          }}>
            <Eye size={14} />
            RAW HEALTH SNAPSHOT
            <button
              onClick={() => void refreshHealth()}
              style={{ marginLeft: 'auto', fontSize: 8, padding: '2px 6px' }}
            >
              <RefreshCw size={10} />
            </button>
            <button
              onClick={() => copyToClipboard(rawHealth)}
              style={{ fontSize: 8, padding: '2px 6px' }}
            >
              <Copy size={10} />
            </button>
          </div>
          <div style={{ padding: 10, maxHeight: 300, overflow: 'auto' }}>
            <pre style={{
              margin: 0,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
            }}>
              {rawHealth || 'Loading...'}
            </pre>
          </div>
        </div>
      </div>

      {/* Right: Live Event Log */}
      <div style={{
        width: 440,
        minWidth: 440,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Event Log Header */}
        <div style={{
          padding: '8px 14px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <Zap size={14} color="var(--amber)" />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: 2,
            color: 'var(--amber)',
          }}>
            LIVE EVENT STREAM
          </span>
          <span style={{
            fontSize: 9,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            padding: '1px 5px',
            background: 'var(--bg-tertiary)',
            borderRadius: 3,
          }}>
            {filteredEvents.length}
          </span>

          {captureEvents && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--red-bright)',
              animation: 'blink 1s infinite',
              flexShrink: 0,
            }} />
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
            <button
              onClick={() => setShowEventFilter(!showEventFilter)}
              style={{
                fontSize: 8, padding: '2px 6px',
                color: eventFilter ? 'var(--cyan-bright)' : 'var(--text-muted)',
                borderColor: eventFilter ? 'var(--cyan-dim)' : 'var(--border-dim)',
              }}
            >
              <Filter size={8} />
            </button>
            <button
              onClick={exportEventLog}
              style={{ fontSize: 8, padding: '2px 6px' }}
            >
              <Download size={8} />
            </button>
            <button
              onClick={() => setCaptureEvents(!captureEvents)}
              style={{
                fontSize: 8,
                padding: '2px 6px',
                color: captureEvents ? 'var(--green-bright)' : 'var(--text-muted)',
                borderColor: captureEvents ? 'var(--green-dim)' : 'var(--border-dim)',
              }}
            >
              {captureEvents ? 'CAPTURING' : 'PAUSED'}
            </button>
            <button
              onClick={() => { setEventLog([]); setEventStats({}); setSelectedEvent(null); }}
              style={{ fontSize: 8, padding: '2px 6px' }}
            >
              <Trash2 size={8} />
            </button>
          </div>
        </div>

        {/* Event Filter & Stats */}
        {showEventFilter && (
          <div style={{
            padding: '6px 10px',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-dim)',
          }}>
            <input
              type="text"
              placeholder="Filter events (e.g. agent, task.completed)"
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              style={{ width: '100%', fontSize: 10, padding: '3px 8px' }}
            />
            {topEvents.length > 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {topEvents.map(([evt, count]) => (
                  <span
                    key={evt}
                    onClick={() => setEventFilter(eventFilter === evt ? '' : evt)}
                    style={{
                      fontSize: 7,
                      padding: '1px 5px',
                      background: eventFilter === evt ? `${getEventColor(evt)}15` : 'var(--bg-secondary)',
                      border: `1px solid ${eventFilter === evt ? `${getEventColor(evt)}44` : 'var(--border-dim)'}`,
                      borderRadius: 3,
                      cursor: 'pointer',
                      color: getEventColor(evt),
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                  >
                    {evt}
                    <span style={{ color: 'var(--text-muted)' }}>{count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Event List */}
        <div
          ref={eventLogRef}
          style={{
            flex: 1,
            overflow: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
          }}
        >
          {filteredEvents.length === 0 && (
            <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 11 }}>
              {eventFilter ? 'No events match filter...' : 'Waiting for events...'}
            </div>
          )}

          {filteredEvents.map((entry) => (
            <div
              key={entry.id}
              onClick={() => setSelectedEvent(selectedEvent?.id === entry.id ? null : entry)}
              style={{
                padding: '3px 10px',
                borderBottom: '1px solid rgba(33,38,45,0.3)',
                cursor: 'pointer',
                background: selectedEvent?.id === entry.id ? 'var(--bg-tertiary)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                {selectedEvent?.id === entry.id
                  ? <ChevronDown size={8} color="var(--text-muted)" />
                  : <ChevronRight size={8} color="var(--text-muted)" />
                }
                <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span style={{
                  color: getEventColor(entry.event),
                  fontWeight: 600,
                }}>
                  {entry.event}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 8, marginLeft: 'auto' }}>
                  <Hash size={7} style={{ display: 'inline' }} />{entry.id}
                </span>
              </div>
              {selectedEvent?.id !== entry.id && (
                <div style={{
                  color: 'var(--text-muted)',
                  fontSize: 9,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                  paddingLeft: 14,
                }}>
                  {JSON.stringify(entry.payload).slice(0, 200)}
                </div>
              )}
              {/* Expanded payload */}
              {selectedEvent?.id === entry.id && (
                <div style={{
                  marginTop: 4,
                  padding: 8,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-dim)',
                  borderRadius: 4,
                  position: 'relative',
                }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(JSON.stringify(entry.payload, null, 2));
                    }}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      fontSize: 7, padding: '1px 4px',
                    }}
                  >
                    <Copy size={8} />
                  </button>
                  <pre style={{
                    margin: 0,
                    fontSize: 9,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}>
                    {JSON.stringify(entry.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
