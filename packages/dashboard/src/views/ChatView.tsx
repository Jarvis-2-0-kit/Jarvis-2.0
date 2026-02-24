/**
 * ChatView — Full-page chat interface with Jarvis agents
 *
 * Features:
 * - Session sidebar (past conversations)
 * - Real-time streaming from agents
 * - Rich message rendering (code blocks, markdown, tool calls)
 * - Message grouping by sender
 * - Typing/streaming indicators
 * - Quick slash commands
 * - Session persistence
 * - Image paste attachments (future)
 * - Abort running response
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent as RKE } from 'react';
import {
  Send, Copy, RotateCcw, ChevronDown, Bot, User, Cpu, Terminal,
  Plus, Trash2, MessageSquare, Clock, StopCircle, Loader2,
  ChevronRight, Hash, Sparkles, CheckCheck,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';
import { useGatewayStore } from '../store/gateway-store.js';

// ─── Types ─────────────────────────────────────────────────────────

interface ChatMsg {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  type?: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'system';
  toolName?: string;
  toolArgs?: string;
  sessionId?: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
}

interface MsgGroup {
  sender: string;
  messages: ChatMsg[];
}

// ─── Constants ─────────────────────────────────────────────────────

const SENDER_CFG: Record<string, { label: string; color: string; icon: typeof Bot; bg: string }> = {
  user:          { label: 'YOU',     color: 'var(--cyan-bright)',  icon: User,     bg: 'rgba(0,200,255,0.06)' },
  'agent-alpha': { label: 'ALPHA',   color: 'var(--green-bright)', icon: Bot,      bg: 'rgba(0,255,65,0.04)' },
  'agent-beta':  { label: 'BETA',    color: '#c084fc',             icon: Bot,      bg: 'rgba(192,132,252,0.04)' },
  system:        { label: 'SYSTEM',  color: '#fbbf24',             icon: Cpu,      bg: 'rgba(251,191,36,0.04)' },
  gateway:       { label: 'GATEWAY', color: '#60a5fa',             icon: Terminal, bg: 'rgba(96,165,250,0.04)' },
};

const QUICK_CMDS = [
  { cmd: '/status',  desc: 'System status' },
  { cmd: '/agents',  desc: 'List agents' },
  { cmd: '/tasks',   desc: 'Task queue' },
  { cmd: '/task',    desc: 'Create task' },
  { cmd: '/help',    desc: 'Commands help' },
];

const CSS = `
@keyframes cv-typing { 0%,20%{opacity:.3;transform:translateY(0)} 50%{opacity:1;transform:translateY(-3px)} 80%,100%{opacity:.3;transform:translateY(0)} }
@keyframes cv-slide  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
@keyframes cv-fade   { from{opacity:0} to{opacity:1} }
@keyframes cv-pulse  { 0%,100%{opacity:.5} 50%{opacity:1} }
@keyframes cv-stream { 0%{border-color:var(--green-dim)} 50%{border-color:var(--green-muted)} 100%{border-color:var(--green-dim)} }
`;

// ─── Main Component ────────────────────────────────────────────────

export function ChatView() {
  const connected = useGatewayStore((s) => s.connected);
  const agents = useGatewayStore((s) => s.agents);

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('default');
  const [sessionsLoading, setSessionsLoading] = useState(true);

  // Messages
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Streaming
  const [streamText, setStreamText] = useState<string | null>(null);
  const [streamFrom, setStreamFrom] = useState<string>('agent-alpha');
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  // Input
  const [input, setInput] = useState('');
  const [target, setTarget] = useState<'all' | 'agent-alpha' | 'agent-beta'>('all');
  const [showCmds, setShowCmds] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Refs
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // ── Inject CSS ──
  useEffect(() => {
    const id = 'cv-css';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }, []);

  // ── Load sessions ──
  useEffect(() => {
    if (!connected) return;
    gateway.request('chat.sessions').then((data) => {
      const list = (data as { sessions: ChatSession[] })?.sessions ?? [];
      setSessions(list);
      if (list.length > 0 && activeSessionId === 'default') {
        setActiveSessionId(list[0].id);
      }
      setSessionsLoading(false);
    }).catch(() => setSessionsLoading(false));
  }, [connected]);

  // ── Load messages for active session ──
  useEffect(() => {
    if (!connected || !activeSessionId) return;
    setLoadingHistory(true);
    gateway.request('chat.history', { sessionId: activeSessionId, limit: 200 }).then((data) => {
      const msgs = (data as { messages: ChatMsg[] })?.messages ?? [];
      setMessages(msgs);
      setLoadingHistory(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
    }).catch(() => {
      setMessages([]);
      setLoadingHistory(false);
    });
  }, [connected, activeSessionId]);

  // ── Listen for real-time chat messages ──
  useEffect(() => {
    const handler = (payload: unknown) => {
      const msg = payload as ChatMsg;
      // Only show messages for current session (or no session filter)
      if (msg.sessionId && msg.sessionId !== activeSessionId) return;

      setMessages((prev) => [...prev.slice(-500), msg]);

      // If this is from an agent, mark as done running
      if (msg.from !== 'user') {
        setIsAgentRunning(false);
        setStreamText(null);
      }

      // Auto-scroll if near bottom
      const c = scrollRef.current;
      if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 120) {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    };

    const streamHandler = (payload: unknown) => {
      const data = payload as { sessionId?: string; text: string; from?: string; done?: boolean };
      if (data.sessionId && data.sessionId !== activeSessionId) return;
      if (data.done) {
        setStreamText(null);
        setIsAgentRunning(false);
      } else {
        setStreamText(data.text);
        setStreamFrom(data.from ?? 'agent-alpha');
        setIsAgentRunning(true);
      }
    };

    gateway.on('chat.message', handler);
    gateway.on('chat.stream', streamHandler);

    return () => {
      gateway.off('chat.message', handler);
      gateway.off('chat.stream', streamHandler);
    };
  }, [activeSessionId]);

  // ── Also listen for store-based messages (fallback) ──
  const storeMessages = useGatewayStore((s) => s.chatMessages);
  useEffect(() => {
    if (storeMessages.length === 0) return;
    const last = storeMessages[storeMessages.length - 1];
    // Deduplicate — only append if not already in our local state
    setMessages((prev) => {
      if (prev.find((m) => m.id === last.id)) return prev;
      return [...prev.slice(-500), last as ChatMsg];
    });

    if (last.from !== 'user') {
      setIsAgentRunning(false);
    }
  }, [storeMessages.length]);

  // ── Send ──
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !connected) return;

    const msg: ChatMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: 'user',
      to: target,
      content: text,
      timestamp: Date.now(),
      sessionId: activeSessionId,
    };

    // Optimistic append
    setMessages((prev) => [...prev, msg]);
    setInput('');
    setIsAgentRunning(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    gateway.request('chat.send', { ...msg }).catch(() => {
      setIsAgentRunning(false);
    });

    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, [input, target, connected, activeSessionId]);

  // ── Abort ──
  const handleAbort = () => {
    gateway.request('chat.abort', { sessionId: activeSessionId }).catch(() => {});
    setIsAgentRunning(false);
    setStreamText(null);
  };

  // ── New session ──
  const handleNewSession = () => {
    const id = `session-${Date.now()}`;
    const session: ChatSession = {
      id,
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      preview: '',
    };
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(id);
    setMessages([]);
  };

  // ── Delete session ──
  const handleDeleteSession = (id: string) => {
    gateway.request('chat.session.delete', { sessionId: id }).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id);
      } else {
        handleNewSession();
      }
    }
  };

  // ── Keyboard ──
  const handleKeyDown = (e: RKE<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === '/' && input === '') setShowCmds(true);
    if (e.key === 'Escape') setShowCmds(false);
  };

  const handleInputChange = (v: string) => {
    setInput(v);
    setShowCmds(v.startsWith('/') && v.length < 12);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  };

  // ── Scroll detection ──
  const handleScroll = useCallback(() => {
    const c = scrollRef.current;
    if (!c) return;
    setShowScrollBtn(c.scrollHeight - c.scrollTop - c.clientHeight > 80);
  }, []);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollBtn(false);
  };

  const copyMsg = (id: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  // ── Group messages ──
  const groups = groupMessages(messages);

  // ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* ── Session sidebar ── */}
      <div style={{
        width: sidebarCollapsed ? 0 : 220,
        minWidth: sidebarCollapsed ? 0 : 220,
        borderRight: sidebarCollapsed ? 'none' : '1px solid var(--border-primary)',
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'all 0.2s ease',
      }}>
        {/* Sidebar header */}
        <div style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            letterSpacing: 2,
            color: 'var(--green-bright)',
            textTransform: 'uppercase',
          }}>
            Sessions
          </span>
          <button
            onClick={handleNewSession}
            title="New session"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24,
              background: 'var(--green-dim)', border: '1px solid var(--green-muted)',
              borderRadius: 4, cursor: 'pointer', color: 'var(--green-bright)',
            }}
          >
            <Plus size={12} />
          </button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {sessionsLoading ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 10 }}>
              Loading...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 10 }}>
              No sessions yet
            </div>
          ) : sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={s.id === activeSessionId}
              onClick={() => setActiveSessionId(s.id)}
              onDelete={() => handleDeleteSession(s.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Chat header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
                transform: sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                transition: 'transform 0.2s',
              }}
            >
              <ChevronRight size={14} />
            </button>
            <MessageSquare size={14} color="var(--cyan-bright)" />
            <span style={{
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              letterSpacing: 2,
              color: 'var(--text-primary)',
            }}>
              CHAT
            </span>

            {/* Online agents */}
            <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
              {Array.from(agents.values()).map((a) => (
                <span key={a.identity.agentId} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 9, color: 'var(--text-muted)',
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: a.status === 'idle' ? '#00ff41' : a.status === 'busy' ? '#fbbf24' : '#484f58',
                    boxShadow: a.status === 'idle' ? '0 0 4px rgba(0,255,65,0.5)' : 'none',
                  }} />
                  {a.identity.agentId.split('-')[1]?.toUpperCase()}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'agent-alpha', 'agent-beta'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTarget(t)}
                style={{
                  fontSize: 9, padding: '2px 8px',
                  background: target === t ? 'var(--green-dim)' : 'transparent',
                  border: `1px solid ${target === t ? 'var(--green-muted)' : 'var(--border-dim)'}`,
                  color: target === t ? 'var(--green-bright)' : 'var(--text-muted)',
                  borderRadius: 3, cursor: 'pointer', transition: 'all 0.15s ease',
                  fontFamily: 'var(--font-ui)', fontWeight: 600, letterSpacing: 1,
                }}
              >
                {t === 'all' ? 'ALL' : t === 'agent-alpha' ? 'ALPHA' : 'BETA'}
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '12px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            position: 'relative',
          }}
        >
          {loadingHistory ? (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 11, gap: 8,
            }}>
              <Loader2 size={14} style={{ animation: 'cv-pulse 1s ease infinite' }} />
              Loading history...
            </div>
          ) : messages.length === 0 ? (
            <EmptyState />
          ) : (
            groups.map((grp, i) => (
              <MessageGroupBlock
                key={`g-${i}-${grp.messages[0]?.id}`}
                group={grp}
                copiedId={copiedId}
                onCopy={copyMsg}
                onResend={(c) => { setInput(c); textareaRef.current?.focus(); }}
              />
            ))
          )}

          {/* Streaming indicator */}
          {isAgentRunning && (
            <StreamingIndicator text={streamText} from={streamFrom} />
          )}

          <div ref={bottomRef} />
        </div>

        {/* Scroll-to-bottom */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            style={{
              position: 'absolute', bottom: 80, right: 32,
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 12px', background: 'var(--bg-secondary)',
              border: '1px solid var(--green-dim)', borderRadius: 12,
              color: 'var(--green-bright)', fontSize: 9, cursor: 'pointer',
              zIndex: 5, animation: 'cv-fade 0.2s ease',
            }}
          >
            <ChevronDown size={10} /> New messages
          </button>
        )}

        {/* Quick commands */}
        {showCmds && (
          <div style={{
            padding: '6px 16px',
            borderTop: '1px solid var(--border-primary)',
            background: 'var(--bg-secondary)',
            display: 'flex', gap: 6, flexWrap: 'wrap',
          }}>
            {QUICK_CMDS
              .filter((c) => c.cmd.includes(input.toLowerCase()))
              .map((c) => (
                <button
                  key={c.cmd}
                  onClick={() => {
                    setInput(c.cmd + ' ');
                    setShowCmds(false);
                    textareaRef.current?.focus();
                  }}
                  style={{
                    padding: '3px 8px', background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-dim)', borderRadius: 4,
                    cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center',
                  }}
                >
                  <Hash size={9} color="var(--green-bright)" />
                  <span style={{ fontSize: 10, color: 'var(--green-bright)', fontFamily: 'var(--font-mono)' }}>
                    {c.cmd}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{c.desc}</span>
                </button>
              ))}
          </div>
        )}

        {/* Input area */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
          display: 'flex', gap: 8, alignItems: 'flex-end',
        }}>
          <span style={{
            color: connected ? 'var(--green-bright)' : 'var(--text-muted)',
            fontSize: 14, lineHeight: '32px', flexShrink: 0,
            fontFamily: 'var(--font-mono)', fontWeight: 700,
          }}>
            &gt;
          </span>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !connected
                ? 'Disconnected...'
                : `Message ${target === 'all' ? 'all agents' : target === 'agent-alpha' ? 'Alpha' : 'Beta'}... (/ for commands)`
            }
            disabled={!connected}
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 13, padding: '6px 0',
              resize: 'none', fontFamily: 'var(--font-ui)', lineHeight: 1.5,
              maxHeight: 160, overflow: 'auto',
            }}
          />
          {isAgentRunning ? (
            <button
              onClick={handleAbort}
              title="Stop"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6,
                color: '#ef4444', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <StopCircle size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32,
                background: input.trim() ? 'var(--green-dim)' : 'transparent',
                border: `1px solid ${input.trim() ? 'var(--green-muted)' : 'var(--border-dim)'}`,
                borderRadius: 6,
                color: input.trim() ? 'var(--green-bright)' : 'var(--text-muted)',
                cursor: input.trim() ? 'pointer' : 'default',
                flexShrink: 0, transition: 'all 0.15s ease',
              }}
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, opacity: 0.4,
    }}>
      <Sparkles size={32} color="var(--green-muted)" />
      <span style={{
        fontFamily: 'var(--font-display)', fontSize: 11,
        letterSpacing: 3, color: 'var(--text-muted)', textTransform: 'uppercase',
      }}>
        Chat with Jarvis
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        Type a message or use / commands
      </span>
    </div>
  );
}

function SessionItem({ session, active, onClick, onDelete }: {
  session: ChatSession; active: boolean;
  onClick: () => void; onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 12px',
        cursor: 'pointer',
        background: active ? 'rgba(0,255,65,0.06)' : hover ? 'rgba(255,255,255,0.02)' : 'transparent',
        borderLeft: active ? '2px solid var(--green-bright)' : '2px solid transparent',
        transition: 'all 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <MessageSquare size={10} color={active ? 'var(--green-bright)' : 'var(--text-muted)'} />
        <span style={{
          fontSize: 10, fontWeight: 600, color: active ? 'var(--green-bright)' : 'var(--text-primary)',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {session.title}
        </span>
        {hover && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', display: 'flex', padding: 2,
            }}
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
          <Clock size={7} style={{ marginRight: 2, verticalAlign: 'middle' }} />
          {formatRelativeTime(session.updatedAt)}
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
          {session.messageCount} msgs
        </span>
      </div>
      {session.preview && (
        <span style={{
          fontSize: 9, color: 'var(--text-muted)', marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {session.preview}
        </span>
      )}
    </div>
  );
}

function StreamingIndicator({ text, from }: { text: string | null; from: string }) {
  const cfg = SENDER_CFG[from] ?? SENDER_CFG['gateway'];
  const Icon = cfg.icon;

  return (
    <div style={{
      display: 'flex', gap: 10, padding: '8px 4px',
      animation: 'cv-slide 0.2s ease-out',
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: 4,
        background: cfg.bg, border: `1px solid ${cfg.color}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={12} color={cfg.color} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            color: cfg.color, fontFamily: 'var(--font-ui)',
          }}>
            {cfg.label}
          </span>
        </div>
        {text ? (
          <div style={{
            fontSize: 12, color: 'var(--green-secondary)', lineHeight: 1.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            borderLeft: '2px solid var(--green-dim)', paddingLeft: 10,
            animation: 'cv-stream 2s ease infinite',
          }}>
            {renderContent(text)}
            <span style={{
              display: 'inline-block', width: 6, height: 14,
              background: 'var(--green-bright)', marginLeft: 2,
              animation: 'cv-pulse 0.8s ease infinite', verticalAlign: 'text-bottom',
            }} />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <div style={{ display: 'flex', gap: 3 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: cfg.color, animation: `cv-typing 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              thinking...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageGroupBlock({ group, copiedId, onCopy, onResend }: {
  group: MsgGroup; copiedId: string | null;
  onCopy: (id: string, content: string) => void;
  onResend: (content: string) => void;
}) {
  const cfg = SENDER_CFG[group.sender] ?? SENDER_CFG['system'];
  const Icon = cfg.icon;

  return (
    <div style={{
      display: 'flex', gap: 10, padding: '8px 4px',
      animation: 'cv-slide 0.2s ease-out',
    }}>
      {/* Avatar */}
      <div style={{
        width: 24, height: 24, borderRadius: 4,
        background: cfg.bg, border: `1px solid ${cfg.color}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, marginTop: 1,
      }}>
        <Icon size={12} color={cfg.color} strokeWidth={1.5} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 3 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            color: cfg.color, fontFamily: 'var(--font-ui)',
          }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
            {formatTime(group.messages[0].timestamp)}
          </span>
        </div>

        {/* Messages */}
        {group.messages.map((msg) => (
          <MsgBubble
            key={msg.id}
            msg={msg}
            sender={group.sender}
            copiedId={copiedId}
            onCopy={onCopy}
            onResend={onResend}
          />
        ))}
      </div>
    </div>
  );
}

function MsgBubble({ msg, sender, copiedId, onCopy, onResend }: {
  msg: ChatMsg; sender: string; copiedId: string | null;
  onCopy: (id: string, content: string) => void;
  onResend: (content: string) => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', padding: '2px 0' }}
    >
      <div style={{
        fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        color: sender === 'user' ? 'var(--text-white)' : 'var(--green-secondary)',
      }}>
        {renderContent(msg.content)}
      </div>

      {hover && (
        <div style={{
          position: 'absolute', top: 0, right: 0,
          display: 'flex', gap: 2, animation: 'cv-fade 0.1s ease',
        }}>
          <button
            onClick={() => onCopy(msg.id, msg.content)}
            title={copiedId === msg.id ? 'Copied!' : 'Copy'}
            style={{
              width: 22, height: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
              borderRadius: 3, cursor: 'pointer',
              color: copiedId === msg.id ? 'var(--green-bright)' : 'var(--text-muted)',
            }}
          >
            {copiedId === msg.id ? <CheckCheck size={10} /> : <Copy size={10} />}
          </button>
          {sender === 'user' && (
            <button
              onClick={() => onResend(msg.content)}
              title="Edit & resend"
              style={{
                width: 22, height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)',
              }}
            >
              <RotateCcw size={10} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function groupMessages(msgs: ChatMsg[]): MsgGroup[] {
  const groups: MsgGroup[] = [];
  for (const m of msgs) {
    const last = groups[groups.length - 1];
    if (last && last.sender === m.from && m.timestamp - last.messages[last.messages.length - 1].timestamp < 120_000) {
      last.messages.push(m);
    } else {
      groups.push({ sender: m.from, messages: [m] });
    }
  }
  return groups;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${time}`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

/**
 * Render message content with basic markdown:
 * - ```code blocks```
 * - `inline code`
 * - **bold**
 * - URLs
 * - Tool call blocks (```tool:name ... ```)
 */
function renderContent(content: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const codeBlockRx = /```(\w*)\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let last = 0;
  let key = 0;

  while ((match = codeBlockRx.exec(content)) !== null) {
    if (match.index > last) {
      parts.push(...renderInline(content.substring(last, match.index), key));
      key += 20;
    }
    const lang = match[1] || '';
    const code = match[2].trim();

    // Tool call styling
    if (lang.startsWith('tool')) {
      parts.push(
        <div key={`tc-${key++}`} style={{
          background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)',
          borderRadius: 6, padding: '8px 12px', margin: '6px 0', fontSize: 11,
          fontFamily: 'var(--font-mono)', color: '#60a5fa',
        }}>
          <div style={{ fontSize: 9, color: '#60a5fa', marginBottom: 4, fontWeight: 600 }}>
            ⚡ TOOL: {lang.replace('tool:', '')}
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{code}</pre>
        </div>
      );
    } else {
      parts.push(
        <div key={`cb-${key++}`} style={{
          background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-dim)',
          borderRadius: 6, padding: '8px 12px', margin: '6px 0',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--green-primary)', whiteSpace: 'pre', overflowX: 'auto',
          position: 'relative',
        }}>
          {lang && (
            <span style={{
              position: 'absolute', top: 4, right: 8,
              fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase',
            }}>
              {lang}
            </span>
          )}
          {code}
        </div>
      );
    }
    last = match.index + match[0].length;
  }

  if (last < content.length) {
    parts.push(...renderInline(content.substring(last), key));
  }

  return parts.length > 0 ? parts : [content];
}

function renderInline(text: string, startKey: number): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const rx = /(\*\*(.+?)\*\*)|(`([^`]+?)`)|((https?:\/\/[^\s]+))/g;
  let m: RegExpExecArray | null;
  let li = 0;
  let k = startKey;

  while ((m = rx.exec(text)) !== null) {
    if (m.index > li) parts.push(text.substring(li, m.index));
    if (m[2]) {
      parts.push(<strong key={`b-${k++}`} style={{ color: 'var(--text-white)', fontWeight: 600 }}>{m[2]}</strong>);
    } else if (m[4]) {
      parts.push(
        <code key={`c-${k++}`} style={{
          background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3,
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cyan-bright)',
        }}>
          {m[4]}
        </code>
      );
    } else if (m[6]) {
      parts.push(
        <a key={`u-${k++}`} href={m[6]} target="_blank" rel="noopener noreferrer" style={{
          color: 'var(--cyan-bright)', textDecoration: 'underline',
          textDecorationColor: 'rgba(0,200,255,0.3)',
        }}>
          {m[6].length > 60 ? m[6].substring(0, 60) + '...' : m[6]}
        </a>
      );
    }
    li = m.index + m[0].length;
  }

  if (li < text.length) parts.push(text.substring(li));
  return parts;
}
