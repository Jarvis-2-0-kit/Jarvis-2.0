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

import { useState, useRef, useEffect, useCallback, type KeyboardEvent as RKE, type MouseEvent as RME } from 'react';
import {
  Send, Copy, RotateCcw, ChevronDown, Bot, User, Cpu, Terminal,
  Plus, Trash2, MessageSquare, Clock, StopCircle, Loader2,
  ChevronRight, Hash, Sparkles, CheckCheck, GripVertical,
  Search, X, Pencil, Check, Wifi, WifiOff, Activity,
} from 'lucide-react';
import { ActivityFeed } from '../components/chat/ActivityFeed.js';
import { gateway } from '../gateway/client.js';
import { useGatewayStore } from '../store/gateway-store.js';
import { useToastStore } from '../store/toast-store.js';
import { formatTime, formatRelativeTime } from '../utils/formatters.js';

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
  thinking?: string;
}

/** Per-agent streaming state */
interface StreamState {
  phase: 'thinking' | 'text' | 'tool_start' | 'done';
  text?: string;
  toolName?: string;
  round?: number;
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
  jarvis:        { label: 'JARVIS',  color: 'var(--amber)',        icon: Bot,      bg: 'rgba(251,191,36,0.06)' },
  'agent-smith': { label: 'SMITH',   color: 'var(--green-bright)', icon: Bot,      bg: 'rgba(0,255,65,0.04)' },
  'agent-johny':  { label: 'JOHNY',   color: '#c084fc',             icon: Bot,      bg: 'rgba(192,132,252,0.04)' },
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
.cv-resize-handle:hover { background: rgba(0,255,65,0.1) !important; }
.cv-resize-handle:active { background: rgba(0,255,65,0.2) !important; }
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

  // Streaming — per-agent map to support multiple agents streaming at once
  const [agentStreams, setAgentStreams] = useState<Map<string, StreamState>>(new Map());
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  // Input
  const [input, setInput] = useState('');
  const [target, setTarget] = useState<'all' | 'jarvis' | 'agent-smith' | 'agent-johny'>('jarvis');
  const [showCmds, setShowCmds] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Edit
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // Latency
  const [latency, setLatency] = useState<number | null>(null);

  // Activity panel
  const [activityPanelOpen, setActivityPanelOpen] = useState(false);
  const [activityPanelWidth, setActivityPanelWidth] = useState(280);
  const isResizingActivity = useRef(false);
  const actStartX = useRef(0);
  const actStartWidth = useRef(0);

  // Toast
  const addToast = useToastStore((s) => s.addToast);

  // Resize
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Refs
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  // ── Prevent accidental tab close during streaming ──
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isAgentRunning) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isAgentRunning]);

  // ── Ctrl+F search ──
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen]);

  // ── Heartbeat / latency ──
  useEffect(() => {
    if (!connected) { setLatency(null); return; }
    const interval = setInterval(() => {
      const start = Date.now();
      gateway.request('ping').then(() => {
        setLatency(Date.now() - start);
      }).catch(() => setLatency(null));
    }, 15_000);
    // Initial ping
    const start = Date.now();
    gateway.request('ping').then(() => setLatency(Date.now() - start)).catch(() => {});
    return () => clearInterval(interval);
  }, [connected]);

  // ── Sidebar resize ──
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(Math.max(startWidth.current + (e.clientX - startX.current), 140), 500);
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startResize = (e: RME) => {
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // ── Activity panel resize ──
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingActivity.current) return;
      // Dragging left = larger panel (inverted because panel is on the right)
      const newWidth = Math.min(Math.max(actStartWidth.current - (e.clientX - actStartX.current), 200), 500);
      setActivityPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizingActivity.current) {
        isResizingActivity.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startActivityResize = (e: RME) => {
    e.preventDefault();
    isResizingActivity.current = true;
    actStartX.current = e.clientX;
    actStartWidth.current = activityPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

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
    }).catch((err) => {
      setSessionsLoading(false);
      addToast({ type: 'error', title: 'Sessions', message: `Failed to load sessions: ${(err as Error).message}` });
    });
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
    }).catch((err) => {
      setMessages([]);
      setLoadingHistory(false);
      addToast({ type: 'error', title: 'History', message: `Failed to load chat history: ${(err as Error).message}` });
    });
  }, [connected, activeSessionId]);

  // ── Listen for real-time chat messages ──
  useEffect(() => {
    const handler = (payload: unknown) => {
      const msg = payload as ChatMsg;
      console.log('[chat.message]', msg.from, msg.sessionId, activeSessionId, msg.content?.slice(0, 80));
      // Filter out messages from other sessions, but always show agent responses
      if (msg.from === 'user' && msg.sessionId && msg.sessionId !== activeSessionId) return;

      // Deduplicate: skip if message with same ID already exists (optimistic append or duplicate WS)
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev.slice(-500), msg];
      });

      // If this is from an agent, mark as done running and capture thinking
      if (msg.from !== 'user') {
        setIsAgentRunning(false);
        setAgentStreams((prev) => {
          const next = new Map(prev);
          next.delete(msg.from);
          return next;
        });
        // Capture thinking from metadata if present
        const raw = payload as Record<string, unknown>;
        if (raw.thinking && typeof raw.thinking === 'string') {
          msg.thinking = raw.thinking;
        }
      }

      // Auto-scroll if near bottom
      const c = scrollRef.current;
      if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 120) {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    };

    const streamHandler = (payload: unknown) => {
      const data = payload as {
        sessionId?: string; from?: string;
        phase?: 'thinking' | 'text' | 'tool_start' | 'done';
        text?: string; toolName?: string; round?: number;
        done?: boolean; // legacy compat
      };
      const agentId = data.from ?? 'jarvis';
      const phase = data.phase ?? (data.done ? 'done' : 'text');
      console.log('[chat.stream]', agentId, phase, data.toolName ?? data.text?.slice(0, 40) ?? '');

      if (phase === 'done') {
        setAgentStreams((prev) => {
          const next = new Map(prev);
          next.delete(agentId);
          return next;
        });
        if (agentStreams.size <= 1) setIsAgentRunning(false);
      } else {
        setAgentStreams((prev) => {
          const next = new Map(prev);
          next.set(agentId, { phase, text: data.text, toolName: data.toolName, round: data.round });
          return next;
        });
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

  // ── Reset streaming state on disconnect ──
  useEffect(() => {
    const unsub = gateway.on('_disconnected', () => {
      setIsAgentRunning(false);
      setAgentStreams(new Map());
    });
    return unsub;
  }, []);

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

    // Auto-name session from first message
    const currentSession = sessions.find((s) => s.id === activeSessionId);
    if (currentSession && (currentSession.title === 'New Chat' || currentSession.messageCount === 0)) {
      const autoTitle = text.length > 40 ? text.substring(0, 40) + '...' : text;
      setSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, title: autoTitle, messageCount: s.messageCount + 1 } : s));
    }

    gateway.request('chat.send', { ...msg }).catch((err) => {
      setIsAgentRunning(false);
      addToast({ type: 'error', title: 'Send failed', message: (err as Error).message });
    });

    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, [input, target, connected, activeSessionId]);

  // ── Abort ──
  const handleAbort = () => {
    gateway.request('chat.abort', { sessionId: activeSessionId }).catch((err) => {
      addToast({ type: 'warning', title: 'Abort', message: `Could not abort: ${(err as Error).message}` });
    });
    setIsAgentRunning(false);
    setAgentStreams(new Map());
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
    gateway.request('chat.session.delete', { sessionId: id }).catch((err) => {
      addToast({ type: 'error', title: 'Delete', message: `Failed to delete session: ${(err as Error).message}` });
    });
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

  // ── Filter & group messages ──
  const filteredMessages = searchQuery
    ? messages.filter((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;
  const groups = groupMessages(filteredMessages);

  // ── Edit handlers ──
  const handleStartEdit = (msg: ChatMsg) => {
    setEditingMsgId(msg.id);
    setEditText(msg.content);
  };

  const handleSaveEdit = () => {
    if (!editingMsgId || !editText.trim()) return;
    const text = editText.trim();
    // Send as a new message (edit = resend with new content)
    const msg: ChatMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: 'user',
      to: target,
      content: text,
      timestamp: Date.now(),
      sessionId: activeSessionId,
    };
    setMessages((prev) => [...prev, msg]);
    setIsAgentRunning(true);
    setEditingMsgId(null);
    setEditText('');
    gateway.request('chat.send', { ...msg }).catch((err) => {
      setIsAgentRunning(false);
      addToast({ type: 'error', title: 'Send failed', message: (err as Error).message });
    });
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  };

  const handleCancelEdit = () => {
    setEditingMsgId(null);
    setEditText('');
  };

  // ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* ── Session sidebar ── */}
      <div style={{
        width: sidebarCollapsed ? 0 : sidebarWidth,
        minWidth: sidebarCollapsed ? 0 : sidebarWidth,
        borderRight: sidebarCollapsed ? 'none' : '1px solid var(--border-primary)',
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: isResizing.current ? 'none' : 'all 0.2s ease',
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

      {/* ── Resize handle ── */}
      {!sidebarCollapsed && (
        <div
          onMouseDown={startResize}
          style={{
            width: 6,
            cursor: 'col-resize',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            position: 'relative',
            zIndex: 2,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,255,65,0.1)'; }}
          onMouseLeave={(e) => { if (!isResizing.current) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        >
          <GripVertical size={10} color="var(--text-muted)" style={{ opacity: 0.4 }} />
        </div>
      )}

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

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Latency indicator */}
            {connected && latency !== null && (
              <span style={{
                fontSize: 9, color: latency < 100 ? 'var(--green-muted)' : latency < 300 ? '#fbbf24' : '#ef4444',
                fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 3,
              }}>
                <Wifi size={10} />
                {latency}ms
              </span>
            )}
            {connected && latency === null && (
              <WifiOff size={10} color="var(--text-muted)" />
            )}

            {/* Search toggle */}
            <button
              onClick={() => {
                setSearchOpen(!searchOpen);
                if (!searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
                else setSearchQuery('');
              }}
              title="Search messages (Ctrl+F)"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24,
                background: searchOpen ? 'var(--green-dim)' : 'transparent',
                border: `1px solid ${searchOpen ? 'var(--green-muted)' : 'var(--border-dim)'}`,
                borderRadius: 4, cursor: 'pointer',
                color: searchOpen ? 'var(--green-bright)' : 'var(--text-muted)',
              }}
            >
              <Search size={11} />
            </button>

            {/* Activity feed toggle */}
            <button
              onClick={() => setActivityPanelOpen(!activityPanelOpen)}
              title="Toggle Activity Feed"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24,
                background: activityPanelOpen ? 'rgba(251,191,36,0.1)' : 'transparent',
                border: `1px solid ${activityPanelOpen ? 'rgba(251,191,36,0.4)' : 'var(--border-dim)'}`,
                borderRadius: 4, cursor: 'pointer',
                color: activityPanelOpen ? '#fbbf24' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
              }}
            >
              <Activity size={11} />
            </button>

            <div style={{ width: 1, height: 16, background: 'var(--border-dim)' }} />

            {(['all', 'jarvis', 'agent-smith', 'agent-johny'] as const).map((t) => (
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
                {t === 'all' ? 'ALL' : t === 'jarvis' ? 'JARVIS' : t === 'agent-smith' ? 'SMITH' : 'JOHNY'}
              </button>
            ))}
          </div>
        </div>

        {/* Search bar */}
        {searchOpen && (
          <div style={{
            padding: '6px 16px',
            borderBottom: '1px solid var(--border-primary)',
            background: 'var(--bg-tertiary)',
            display: 'flex', gap: 8, alignItems: 'center',
            animation: 'cv-slide 0.15s ease-out',
          }}>
            <Search size={12} color="var(--text-muted)" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-ui)',
              }}
            />
            {searchQuery && (
              <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {messages.filter((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase())).length} found
              </span>
            )}
            <button
              onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 2,
              }}
            >
              <X size={12} />
            </button>
          </div>
        )}

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
                searchQuery={searchQuery}
                editingMsgId={editingMsgId}
                editText={editText}
                onEditStart={handleStartEdit}
                onEditChange={setEditText}
                onEditSave={handleSaveEdit}
                onEditCancel={handleCancelEdit}
              />
            ))
          )}

          {/* Streaming indicators — one per agent */}
          {Array.from(agentStreams.entries()).map(([agentId, stream]) => (
            <StreamingIndicator key={agentId} agentId={agentId} stream={stream} />
          ))}

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
                : `Message ${target === 'all' ? 'all agents' : target === 'jarvis' ? 'Jarvis' : target === 'agent-smith' ? 'Smith' : 'Johny'}... (/ for commands)`
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

      {/* ── Activity Feed panel ── */}
      {activityPanelOpen && (
        <>
          {/* Resize handle */}
          <div
            onMouseDown={startActivityResize}
            style={{
              width: 6,
              cursor: 'col-resize',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              position: 'relative',
              zIndex: 2,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(251,191,36,0.1)'; }}
            onMouseLeave={(e) => { if (!isResizingActivity.current) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            <GripVertical size={10} color="var(--text-muted)" style={{ opacity: 0.4 }} />
          </div>

          {/* Panel */}
          <div style={{
            width: activityPanelWidth,
            minWidth: activityPanelWidth,
            borderLeft: '1px solid var(--border-primary)',
            overflow: 'hidden',
            transition: isResizingActivity.current ? 'none' : 'all 0.2s ease',
          }}>
            <ActivityFeed />
          </div>
        </>
      )}
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

function StreamingIndicator({ agentId, stream }: { agentId: string; stream: StreamState }) {
  const cfg = SENDER_CFG[agentId] ?? SENDER_CFG['gateway'];
  const Icon = cfg.icon;

  const phaseBadge = () => {
    if (stream.phase === 'thinking') return { label: 'THINKING', bg: 'rgba(168,85,247,0.15)', color: '#c084fc', border: '#7c3aed' };
    if (stream.phase === 'tool_start') return { label: `CALLING ${stream.toolName ?? 'tool'}`, bg: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '#d97706' };
    return null;
  };
  const badge = phaseBadge();

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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            color: cfg.color, fontFamily: 'var(--font-ui)',
          }}>
            {cfg.label}
          </span>
          {badge && (
            <span style={{
              fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
              padding: '1px 6px', borderRadius: 3,
              background: badge.bg, color: badge.color,
              border: `1px solid ${badge.border}44`,
            }}>
              {badge.label}
            </span>
          )}
          {(stream.round ?? 0) > 1 && (
            <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
              Round {stream.round}
            </span>
          )}
        </div>

        {/* Thinking phase: purple italic text */}
        {stream.phase === 'thinking' && stream.text ? (
          <div style={{
            fontSize: 11, color: '#c084fc', lineHeight: 1.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontStyle: 'italic',
            borderLeft: '2px solid #7c3aed44', paddingLeft: 10,
            maxHeight: 150, overflowY: 'auto',
          }}>
            {stream.text}
            <span style={{
              display: 'inline-block', width: 6, height: 14,
              background: '#c084fc', marginLeft: 2, opacity: 0.6,
              animation: 'cv-pulse 0.8s ease infinite', verticalAlign: 'text-bottom',
            }} />
          </div>
        ) : stream.phase === 'text' && stream.text ? (
          /* Text phase: green with cursor */
          <div style={{
            fontSize: 12, color: 'var(--green-secondary)', lineHeight: 1.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            borderLeft: '2px solid var(--green-dim)', paddingLeft: 10,
            animation: 'cv-stream 2s ease infinite',
          }}>
            {renderContent(stream.text)}
            <span style={{
              display: 'inline-block', width: 6, height: 14,
              background: 'var(--green-bright)', marginLeft: 2,
              animation: 'cv-pulse 0.8s ease infinite', verticalAlign: 'text-bottom',
            }} />
          </div>
        ) : stream.phase === 'tool_start' ? (
          /* Tool phase: just the badge, animated dots */
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <div style={{ display: 'flex', gap: 3 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: '#fbbf24', animation: `cv-typing 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              executing...
            </span>
          </div>
        ) : (
          /* Default: typing dots */
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

function MessageGroupBlock({ group, copiedId, onCopy, onResend, searchQuery, editingMsgId, editText, onEditStart, onEditChange, onEditSave, onEditCancel }: {
  group: MsgGroup; copiedId: string | null;
  onCopy: (id: string, content: string) => void;
  onResend: (content: string) => void;
  searchQuery: string;
  editingMsgId: string | null;
  editText: string;
  onEditStart: (msg: ChatMsg) => void;
  onEditChange: (text: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
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
            searchQuery={searchQuery}
            isEditing={editingMsgId === msg.id}
            editText={editText}
            onEditStart={() => onEditStart(msg)}
            onEditChange={onEditChange}
            onEditSave={onEditSave}
            onEditCancel={onEditCancel}
          />
        ))}
      </div>
    </div>
  );
}

function MsgBubble({ msg, sender, copiedId, onCopy, onResend, searchQuery, isEditing, editText, onEditStart, onEditChange, onEditSave, onEditCancel }: {
  msg: ChatMsg; sender: string; copiedId: string | null;
  onCopy: (id: string, content: string) => void;
  onResend: (content: string) => void;
  searchQuery: string;
  isEditing: boolean;
  editText: string;
  onEditStart: () => void;
  onEditChange: (text: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
}) {
  const [hover, setHover] = useState(false);

  if (isEditing) {
    return (
      <div style={{ padding: '4px 0' }}>
        <textarea
          value={editText}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSave(); }
            if (e.key === 'Escape') onEditCancel();
          }}
          autoFocus
          style={{
            width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--cyan-muted)',
            borderRadius: 4, padding: '6px 8px', color: 'var(--text-white)', fontSize: 12,
            fontFamily: 'var(--font-ui)', resize: 'vertical', minHeight: 36, outline: 'none',
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button onClick={onEditSave} style={{
            fontSize: 9, padding: '2px 8px', background: 'var(--green-dim)',
            border: '1px solid var(--green-muted)', borderRadius: 3,
            color: 'var(--green-bright)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <Check size={9} /> Send
          </button>
          <button onClick={onEditCancel} style={{
            fontSize: 9, padding: '2px 8px', background: 'transparent',
            border: '1px solid var(--border-dim)', borderRadius: 3,
            color: 'var(--text-muted)', cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', padding: '2px 0' }}
    >
      {/* Collapsible thinking block */}
      {msg.thinking && (
        <details style={{ marginBottom: 4 }}>
          <summary style={{
            fontSize: 9, color: '#c084fc', cursor: 'pointer',
            fontFamily: 'var(--font-ui)', letterSpacing: 0.5,
            userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Sparkles size={9} />
            View thinking
          </summary>
          <div style={{
            fontSize: 11, color: '#c084fc', lineHeight: 1.5,
            fontStyle: 'italic', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            padding: '6px 10px', marginTop: 4,
            borderLeft: '2px solid #7c3aed44',
            background: 'rgba(168,85,247,0.05)',
            borderRadius: '0 4px 4px 0',
            maxHeight: 200, overflowY: 'auto',
          }}>
            {msg.thinking}
          </div>
        </details>
      )}

      <div style={{
        fontSize: 12, lineHeight: 1.6, wordBreak: 'break-word',
        color: sender === 'user' ? 'var(--text-white)' : 'var(--green-secondary)',
      }}>
        {renderContent(msg.content, searchQuery)}
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
              onClick={onEditStart}
              title="Edit & resend"
              style={{
                width: 22, height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)',
              }}
            >
              <Pencil size={10} />
            </button>
          )}
          {sender === 'user' && (
            <button
              onClick={() => onResend(msg.content)}
              title="Resend"
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

/**
 * Render message content with full markdown support:
 * - ```code blocks``` with language labels
 * - ```tool:name blocks``` with special styling
 * - # Headers (h1-h6)
 * - Unordered lists (- or *)
 * - Ordered lists (1. 2. 3.)
 * - Blockquotes (> text)
 * - Horizontal rules (---)
 * - Tables (| col | col |)
 * - **bold**, *italic*, ~~strikethrough~~
 * - `inline code`
 * - URLs
 * - Search highlighting
 */
function renderContent(content: string, searchQuery = ''): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const codeBlockRx = /```(\w*(?::\w+)?)\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let last = 0;
  let key = 0;

  while ((match = codeBlockRx.exec(content)) !== null) {
    if (match.index > last) {
      parts.push(...renderBlocks(content.substring(last, match.index), key, searchQuery));
      key += 200;
    }
    const lang = match[1] || '';
    const code = match[2].trim();

    if (lang.startsWith('tool')) {
      parts.push(
        <div key={`tc-${key++}`} style={{
          background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)',
          borderRadius: 6, padding: '8px 12px', margin: '6px 0', fontSize: 11,
          fontFamily: 'var(--font-mono)', color: '#60a5fa',
        }}>
          <div style={{ fontSize: 9, color: '#60a5fa', marginBottom: 4, fontWeight: 600 }}>
            TOOL: {lang.replace('tool:', '')}
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
    parts.push(...renderBlocks(content.substring(last), key, searchQuery));
  }

  return parts.length > 0 ? parts : [content];
}

/** Process block-level markdown: headers, lists, blockquotes, tables, HR */
function renderBlocks(text: string, startKey: number, searchQuery: string): JSX.Element[] {
  const elements: JSX.Element[] = [];
  const lines = text.split('\n');
  let k = startKey;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(<hr key={`hr-${k++}`} style={{ border: 'none', borderTop: '1px solid var(--border-dim)', margin: '8px 0' }} />);
      i++; continue;
    }

    // Headers
    const hMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1].length;
      const sizes = [18, 16, 14, 13, 12, 11];
      elements.push(
        <div key={`h-${k++}`} style={{
          fontSize: sizes[level - 1], fontWeight: 700,
          color: level <= 2 ? 'var(--green-bright)' : 'var(--text-white)',
          margin: `${level <= 2 ? 10 : 6}px 0 4px`,
          fontFamily: level <= 2 ? 'var(--font-display)' : 'var(--font-ui)',
          letterSpacing: level <= 2 ? 1 : 0,
        }}>
          {renderInline(hMatch[2], k, searchQuery)}
        </div>
      );
      k += 20; i++; continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().substring(2));
        i++;
      }
      elements.push(
        <div key={`bq-${k++}`} style={{
          borderLeft: '3px solid var(--cyan-muted)', paddingLeft: 12,
          margin: '6px 0', color: 'var(--text-secondary)', fontStyle: 'italic',
          fontSize: 12, lineHeight: 1.6,
        }}>
          {quoteLines.map((ql, qi) => (
            <span key={qi}>{renderInline(ql, k + qi * 20, searchQuery)}{qi < quoteLines.length - 1 && <br />}</span>
          ))}
        </div>
      );
      k += quoteLines.length * 20; continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={`ul-${k++}`} style={{ margin: '4px 0', paddingLeft: 20, listStyleType: 'none' }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: 12, lineHeight: 1.6, padding: '1px 0', position: 'relative', paddingLeft: 12 }}>
              <span style={{ position: 'absolute', left: 0, color: 'var(--green-muted)' }}>&#9656;</span>
              {renderInline(item, k + j * 20, searchQuery)}
            </li>
          ))}
        </ul>
      );
      k += items.length * 20; continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${k++}`} style={{ margin: '4px 0', paddingLeft: 24 }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: 12, lineHeight: 1.6, padding: '1px 0', color: 'var(--green-muted)' }}>
              <span style={{ color: 'inherit' }}>{renderInline(item, k + j * 20, searchQuery)}</span>
            </li>
          ))}
        </ol>
      );
      k += items.length * 20; continue;
    }

    // Table
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) => row.split('|').slice(1, -1).map((c) => c.trim());
        const headers = parseRow(tableLines[0]);
        const hasSep = tableLines.length >= 2 && tableLines[1].includes('---');
        const dataStart = hasSep ? 2 : 1;
        const rows = tableLines.slice(dataStart).map(parseRow);

        elements.push(
          <div key={`tbl-${k++}`} style={{ overflowX: 'auto', margin: '8px 0' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
              <thead>
                <tr>
                  {headers.map((h, j) => (
                    <th key={j} style={{
                      padding: '4px 10px', borderBottom: '2px solid var(--green-dim)',
                      textAlign: 'left', color: 'var(--green-bright)',
                      fontWeight: 600, fontSize: 10, letterSpacing: 0.5, whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 1 ? 'rgba(0,255,65,0.02)' : 'transparent' }}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: '3px 10px', borderBottom: '1px solid var(--border-dim)',
                        color: 'var(--text-secondary)', fontSize: 11,
                      }}>{renderInline(cell, k + ri * 100 + ci, searchQuery)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        k += 200; continue;
      }
    }

    // Regular text line
    elements.push(
      <span key={`t-${k++}`} style={{ display: 'block' }}>
        {renderInline(trimmed, k, searchQuery)}
      </span>
    );
    k += 20; i++;
  }

  return elements;
}

/** Render inline markdown: bold, italic, strikethrough, code, URLs, search highlighting */
function renderInline(text: string, startKey: number, searchQuery = ''): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const rx = /\*\*(.+?)\*\*|\*([^*\n]+?)\*|~~(.+?)~~|`([^`\n]+?)`|(https?:\/\/[^\s)]+)/g;
  let m: RegExpExecArray | null;
  let li = 0;
  let k = startKey;

  while ((m = rx.exec(text)) !== null) {
    if (m.index > li) parts.push(...highlightSearch(text.substring(li, m.index), k, searchQuery));
    k += 5;

    if (m[1]) {
      // **bold**
      parts.push(<strong key={`b-${k++}`} style={{ color: 'var(--text-white)', fontWeight: 600 }}>{m[1]}</strong>);
    } else if (m[2]) {
      // *italic*
      parts.push(<em key={`i-${k++}`} style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{m[2]}</em>);
    } else if (m[3]) {
      // ~~strikethrough~~
      parts.push(<del key={`s-${k++}`} style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{m[3]}</del>);
    } else if (m[4]) {
      // `inline code`
      parts.push(
        <code key={`c-${k++}`} style={{
          background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3,
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cyan-bright)',
        }}>{m[4]}</code>
      );
    } else if (m[5]) {
      // URL
      parts.push(
        <a key={`u-${k++}`} href={m[5]} target="_blank" rel="noopener noreferrer" style={{
          color: 'var(--cyan-bright)', textDecoration: 'underline',
          textDecorationColor: 'rgba(0,200,255,0.3)',
        }}>{m[5].length > 60 ? m[5].substring(0, 60) + '...' : m[5]}</a>
      );
    }
    li = m.index + m[0].length;
  }

  if (li < text.length) parts.push(...highlightSearch(text.substring(li), k, searchQuery));
  return parts;
}

/** Highlight search query matches in text */
function highlightSearch(text: string, startKey: number, query: string): (string | JSX.Element)[] {
  if (!query || !text) return [text];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: (string | JSX.Element)[] = [];
  let last = 0;
  let k = startKey;
  let idx = lower.indexOf(q, last);

  while (idx !== -1) {
    if (idx > last) parts.push(text.substring(last, idx));
    parts.push(
      <mark key={`hl-${k++}`} style={{
        background: 'rgba(255,200,0,0.3)', color: 'inherit',
        borderRadius: 2, padding: '0 1px',
      }}>{text.substring(idx, idx + query.length)}</mark>
    );
    last = idx + query.length;
    idx = lower.indexOf(q, last);
  }

  if (last < text.length) parts.push(text.substring(last));
  return parts;
}
