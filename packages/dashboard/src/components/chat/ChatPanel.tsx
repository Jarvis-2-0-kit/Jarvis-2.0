/**
 * ChatPanel v2 — Enhanced chat with Jarvis agents
 *
 * Features:
 * - Typing indicator with animated dots
 * - Message grouping by sender (consecutive messages from same agent)
 * - Inline markdown-like rendering (bold, code, links)
 * - Quick command suggestions (/ commands)
 * - Message reactions (copy, re-send)
 * - Timestamp grouping (today, yesterday, date)
 * - Auto-resize textarea
 * - Unread message indicator
 * - Sound notification on new agent messages
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Send, Copy, RotateCcw, ChevronDown,
  Bot, User, Cpu, Terminal,
} from 'lucide-react';
import { useGatewayStore } from '../../store/gateway-store.js';
import { formatTime } from '../../utils/formatters.js';
import { gateway } from '../../gateway/client.js';

// --- Types ---

interface MessageGroup {
  sender: string;
  messages: Array<{
    id: string;
    content: string;
    timestamp: number;
  }>;
}

// --- Constants ---

const SENDER_CONFIG: Record<string, { label: string; color: string; icon: typeof Bot; bg: string }> = {
  'user': { label: 'YOU', color: 'var(--cyan-bright)', icon: User, bg: 'rgba(0,200,255,0.06)' },
  'jarvis': { label: 'JARVIS', color: 'var(--amber)', icon: Bot, bg: 'rgba(251,191,36,0.06)' },
  'agent-alpha': { label: 'SMITH', color: 'var(--green-bright)', icon: Bot, bg: 'rgba(0,255,65,0.04)' },
  'agent-beta': { label: 'JOHNY', color: '#c084fc', icon: Bot, bg: 'rgba(192,132,252,0.04)' },
  'system': { label: 'SYSTEM', color: '#fbbf24', icon: Cpu, bg: 'rgba(251,191,36,0.04)' },
  'gateway': { label: 'GATEWAY', color: '#60a5fa', icon: Terminal, bg: 'rgba(96,165,250,0.04)' },
};

const QUICK_COMMANDS = [
  { cmd: '/status', desc: 'Check system status' },
  { cmd: '/agents', desc: 'List active agents' },
  { cmd: '/tasks', desc: 'Show task queue' },
  { cmd: '/health', desc: 'System health check' },
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/clear', desc: 'Clear chat history' },
];

// --- Inject CSS ---
const CHAT_CSS = `
@keyframes typingDot {
  0%, 20% { opacity: 0.3; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-3px); }
  80%, 100% { opacity: 0.3; transform: translateY(0); }
}
@keyframes chatSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes chatFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes newMsgPulse {
  0%, 100% { box-shadow: none; }
  50% { box-shadow: 0 0 12px rgba(0,255,65,0.3); }
}
`;

export function ChatPanel() {
  const chatMessages = useGatewayStore((s) => s.chatMessages);
  const sendChat = useGatewayStore((s) => s.sendChat);
  const agents = useGatewayStore((s) => s.agents);
  const [input, setInput] = useState('');
  const [target, setTarget] = useState<'all' | 'jarvis' | 'agent-alpha' | 'agent-beta'>('jarvis');
  const [showCommands, setShowCommands] = useState(false);
  const [isTyping, setIsTyping] = useState<Record<string, boolean>>({});
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMessageCount = useRef(chatMessages.length);

  // Inject CSS
  useEffect(() => {
    const id = 'jarvis-chat-css';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = CHAT_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // Auto-scroll with smart detection
  useEffect(() => {
    if (chatMessages.length > prevMessageCount.current) {
      const container = scrollContainerRef.current;
      if (container) {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (isNearBottom) {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        } else {
          setShowScrollDown(true);
        }
      }
    }
    prevMessageCount.current = chatMessages.length;
  }, [chatMessages.length]);

  // Listen to real stream events for typing state
  useEffect(() => {
    const streamHandler = (payload: unknown) => {
      const data = payload as {
        from?: string;
        phase?: 'thinking' | 'text' | 'tool_start' | 'done';
        done?: boolean;
      };
      const agentId = data.from ?? 'jarvis';
      const phase = data.phase ?? (data.done ? 'done' : 'text');
      if (phase === 'done') {
        setIsTyping((prev) => ({ ...prev, [agentId]: false }));
      } else {
        setIsTyping((prev) => ({ ...prev, [agentId]: true }));
      }
    };

    // Also clear typing when a final message arrives
    const msgHandler = (payload: unknown) => {
      const msg = payload as { from?: string };
      if (msg.from && msg.from !== 'user') {
        setIsTyping((prev) => ({ ...prev, [msg.from!]: false }));
      }
    };

    gateway.on('chat.stream', streamHandler);
    gateway.on('chat.message', msgHandler);
    return () => {
      gateway.off('chat.stream', streamHandler);
      gateway.off('chat.message', msgHandler);
    };
  }, []);

  // Scroll detection
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    setShowScrollDown(!isNearBottom);
  }, []);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollDown(false);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    sendChat(target, text);
    setInput('');
    setShowCommands(false);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === '/' && input === '') {
      setShowCommands(true);
    }
    if (e.key === 'Escape') {
      setShowCommands(false);
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    setShowCommands(value.startsWith('/') && value.length < 10);

    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  };

  const copyMessage = (id: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  // Group consecutive messages from same sender
  const messageGroups = groupMessages(chatMessages);

  // Active agent statuses
  const activeTyping = Object.entries(isTyping).filter(([, v]) => v);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--cyan-bright)' }}>&gt;&gt;</span>
        <span>CHAT</span>

        {/* Online agents indicator */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {Array.from(agents.values()).map((agent) => (
            <span
              key={agent.identity.agentId}
              style={{
                width: 5, height: 5, borderRadius: '50%',
                background: agent.status === 'idle' ? '#00ff41' :
                           agent.status === 'busy' ? '#fbbf24' : '#484f58',
                boxShadow: agent.status === 'idle' ? '0 0 4px rgba(0,255,65,0.5)' : 'none',
              }}
              title={`${agent.identity.agentId}: ${agent.status}`}
            />
          ))}
        </div>

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['all', 'jarvis', 'agent-alpha', 'agent-beta'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTarget(t)}
              style={{
                fontSize: 9,
                padding: '1px 6px',
                background: target === t ? 'var(--green-dim)' : 'transparent',
                borderColor: target === t ? 'var(--green-muted)' : 'var(--border-dim)',
                color: target === t ? 'var(--green-bright)' : 'var(--text-muted)',
                borderRadius: 3,
                border: `1px solid ${target === t ? 'var(--green-muted)' : 'var(--border-dim)'}`,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {t === 'all' ? 'ALL' : t === 'jarvis' ? 'J' : t === 'agent-alpha' ? 'S' : 'JH'}
            </button>
          ))}
        </span>
      </div>

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          position: 'relative',
        }}
      >
        {chatMessages.length === 0 ? (
          <EmptyChat />
        ) : (
          messageGroups.map((group, gi) => (
            <MessageGroupBlock
              key={`grp-${gi}-${group.messages[0]?.id}`}
              group={group}
              copiedId={copiedId}
              onCopy={copyMessage}
              onResend={(content) => {
                setInput(content);
                textareaRef.current?.focus();
              }}
            />
          ))
        )}

        {/* Typing indicators */}
        {activeTyping.map(([agentId]) => (
          <TypingIndicator key={agentId} agentId={agentId} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollDown && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute',
            bottom: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--green-dim)',
            borderRadius: 12,
            color: 'var(--green-bright)',
            fontSize: 9,
            cursor: 'pointer',
            zIndex: 5,
            animation: 'chatFadeIn 0.2s ease',
          }}
        >
          <ChevronDown size={10} />
          New messages
        </button>
      )}

      {/* Quick commands popup */}
      {showCommands && (
        <div style={{
          padding: '6px 0',
          borderTop: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
        }}>
          {QUICK_COMMANDS
            .filter((c) => c.cmd.includes(input.toLowerCase()))
            .map((cmd) => (
              <button
                key={cmd.cmd}
                onClick={() => {
                  setInput(cmd.cmd + ' ');
                  setShowCommands(false);
                  textareaRef.current?.focus();
                }}
                style={{
                  display: 'flex',
                  width: '100%',
                  padding: '4px 12px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--green-bright)', fontFamily: 'var(--font-mono)' }}>
                  {cmd.cmd}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{cmd.desc}</span>
              </button>
            ))}
        </div>
      )}

      {/* Input area */}
      <div style={{
        padding: '8px 10px',
        borderTop: '1px solid var(--border-primary)',
        display: 'flex',
        gap: 6,
        alignItems: 'flex-end',
      }}>
        <span style={{
          color: 'var(--green-bright)',
          fontSize: 13,
          lineHeight: '28px',
          flexShrink: 0,
        }}>
          &gt;
        </span>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${target === 'all' ? 'all agents' : target === 'jarvis' ? 'Jarvis' : target === 'agent-alpha' ? 'Smith' : 'Johny'}... (/ for commands)`}
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: 12,
            padding: '4px 0',
            resize: 'none',
            fontFamily: 'var(--font-ui)',
            lineHeight: 1.4,
            maxHeight: 120,
            overflow: 'auto',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28, height: 28,
            background: input.trim() ? 'var(--green-dim)' : 'transparent',
            border: `1px solid ${input.trim() ? 'var(--green-muted)' : 'var(--border-dim)'}`,
            borderRadius: 4,
            color: input.trim() ? 'var(--green-bright)' : 'var(--text-muted)',
            cursor: input.trim() ? 'pointer' : 'default',
            flexShrink: 0,
            transition: 'all 0.15s ease',
          }}
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

// --- Sub-components ---

function EmptyChat() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      opacity: 0.4,
      padding: 24,
    }}>
      <Terminal size={24} color="var(--text-muted)" />
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 9,
        letterSpacing: 2,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        textAlign: 'center',
      }}>
        Send commands to your agents
      </span>
      <span style={{
        fontSize: 9,
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
      }}>
        Type / for quick commands
      </span>
    </div>
  );
}

function TypingIndicator({ agentId }: { agentId: string }) {
  const config = SENDER_CONFIG[agentId] ?? SENDER_CONFIG['system'];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 8px',
      animation: 'chatFadeIn 0.3s ease',
    }}>
      <span style={{
        fontSize: 9,
        color: config.color,
        fontFamily: 'var(--font-ui)',
        fontWeight: 600,
        letterSpacing: 1,
      }}>
        {config.label}
      </span>
      <div style={{ display: 'flex', gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 4, height: 4,
              borderRadius: '50%',
              background: config.color,
              animation: `typingDot 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        typing...
      </span>
    </div>
  );
}

function MessageGroupBlock({ group, copiedId, onCopy, onResend }: {
  group: MessageGroup;
  copiedId: string | null;
  onCopy: (id: string, content: string) => void;
  onResend: (content: string) => void;
}) {
  const config = SENDER_CONFIG[group.sender] ?? SENDER_CONFIG['system'];
  const Icon = config.icon;
  const [hoveredMsg, setHoveredMsg] = useState<string | null>(null);

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      padding: '6px 4px',
      animation: 'chatSlideIn 0.2s ease-out',
      borderRadius: 6,
      background: 'transparent',
    }}>
      {/* Avatar */}
      <div style={{
        width: 22, height: 22,
        borderRadius: 4,
        background: config.bg,
        border: `1px solid ${config.color}33`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginTop: 1,
      }}>
        <Icon size={11} color={config.color} strokeWidth={1.5} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Sender + first timestamp */}
        <div style={{
          display: 'flex',
          gap: 6,
          alignItems: 'baseline',
          marginBottom: 3,
        }}>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1,
            color: config.color,
            fontFamily: 'var(--font-ui)',
          }}>
            {config.label}
          </span>
          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
            {formatTime(group.messages[0].timestamp)}
          </span>
        </div>

        {/* Messages */}
        {group.messages.map((msg) => (
          <div
            key={msg.id}
            onMouseEnter={() => setHoveredMsg(msg.id)}
            onMouseLeave={() => setHoveredMsg(null)}
            style={{
              position: 'relative',
              padding: '2px 0',
            }}
          >
            <div style={{
              fontSize: 12,
              color: group.sender === 'user' ? 'var(--text-white)' : 'var(--green-secondary)',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {renderMessageContent(msg.content)}
            </div>

            {/* Hover actions */}
            {hoveredMsg === msg.id && (
              <div style={{
                position: 'absolute',
                top: 0,
                right: 0,
                display: 'flex',
                gap: 2,
                animation: 'chatFadeIn 0.1s ease',
              }}>
                <button
                  onClick={() => onCopy(msg.id, msg.content)}
                  title="Copy"
                  style={{
                    width: 20, height: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                    borderRadius: 3, cursor: 'pointer',
                    color: copiedId === msg.id ? 'var(--green-bright)' : 'var(--text-muted)',
                  }}
                >
                  <Copy size={9} />
                </button>
                {group.sender === 'user' && (
                  <button
                    onClick={() => onResend(msg.content)}
                    title="Edit & resend"
                    style={{
                      width: 20, height: 20,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                      borderRadius: 3, cursor: 'pointer',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <RotateCcw size={9} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Helpers ---

function groupMessages(messages: Array<{ id: string; from: string; to: string; content: string; timestamp: number }>): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const msg of messages) {
    const lastGroup = groups[groups.length - 1];

    // Group if same sender and within 2 minutes
    if (
      lastGroup &&
      lastGroup.sender === msg.from &&
      msg.timestamp - lastGroup.messages[lastGroup.messages.length - 1].timestamp < 120_000
    ) {
      lastGroup.messages.push({
        id: msg.id,
        content: msg.content,
        timestamp: msg.timestamp,
      });
    } else {
      groups.push({
        sender: msg.from,
        messages: [{
          id: msg.id,
          content: msg.content,
          timestamp: msg.timestamp,
        }],
      });
    }
  }

  return groups;
}

/**
 * Basic inline markdown rendering for chat messages.
 * Supports: **bold**, `code`, ```code blocks```, URLs
 */
function renderMessageContent(content: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  let remaining = content;
  let keyIdx = 0;

  // Process code blocks first
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let codeMatch: RegExpExecArray | null;
  let lastIndex = 0;

  // eslint-disable-next-line no-cond-assign
  while ((codeMatch = codeBlockRegex.exec(remaining)) !== null) {
    // Add text before code block
    if (codeMatch.index > lastIndex) {
      parts.push(...renderInlineMarkdown(remaining.substring(lastIndex, codeMatch.index), keyIdx));
      keyIdx += 10;
    }

    // Add code block
    parts.push(
      <div
        key={`code-${keyIdx++}`}
        style={{
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid var(--border-dim)',
          borderRadius: 4,
          padding: '6px 10px',
          margin: '4px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--green-primary)',
          whiteSpace: 'pre',
          overflowX: 'auto',
        }}
      >
        {codeMatch[1].trim()}
      </div>
    );

    lastIndex = codeMatch.index + codeMatch[0].length;
  }

  // Add remaining text
  if (lastIndex < remaining.length) {
    parts.push(...renderInlineMarkdown(remaining.substring(lastIndex), keyIdx));
  }

  return parts.length > 0 ? parts : [content];
}

function renderInlineMarkdown(text: string, startKey: number): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  // Simple inline processing: **bold**, `code`, URLs
  const inlineRegex = /(\*\*(.+?)\*\*)|(`([^`]+?)`)|((https?:\/\/[^\s]+))/g;
  let match: RegExpExecArray | null;
  let lastIdx = 0;
  let key = startKey;

  // eslint-disable-next-line no-cond-assign
  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.substring(lastIdx, match.index));
    }

    if (match[2]) {
      // **bold**
      parts.push(
        <strong key={`b-${key++}`} style={{ color: 'var(--text-white)', fontWeight: 600 }}>
          {match[2]}
        </strong>
      );
    } else if (match[4]) {
      // `inline code`
      parts.push(
        <code
          key={`c-${key++}`}
          style={{
            background: 'rgba(0,0,0,0.3)',
            padding: '1px 5px',
            borderRadius: 3,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--cyan-bright)',
          }}
        >
          {match[4]}
        </code>
      );
    } else if (match[6]) {
      // URL
      parts.push(
        <a
          key={`u-${key++}`}
          href={match[6]}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--cyan-bright)',
            textDecoration: 'underline',
            textDecorationColor: 'rgba(0,200,255,0.3)',
          }}
        >
          {match[6].length > 50 ? match[6].substring(0, 50) + '...' : match[6]}
        </a>
      );
    }

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(text.substring(lastIdx));
  }

  return parts;
}
