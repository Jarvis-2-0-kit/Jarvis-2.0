/**
 * IMessageView — macOS iMessage messenger interface
 *
 * Split-panel: conversation list + contacts (left) + chat thread (right)
 * Uses AppleScript for chat list + Contacts.app for names
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageCircle, Send, RefreshCw, Search, X,
  Plus, User, ChevronRight, Paperclip, AlertTriangle,
  Phone, Mail, ArrowLeft,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';
import { useGatewayStore } from '../store/gateway-store.js';

// ─── Types ───────────────────────────────────────────

interface Conversation {
  chatId: string;
  displayName: string;
  handle: string;
  handles: string[];
  lastMessage: string;
  lastMessageDate: string;
  lastFromMe: boolean;
  messageCount: number;
  unreadCount: number;
}

interface Contact {
  name: string;
  phones: string[];
  emails: string[];
}

interface ChatMessage {
  id: string;
  text: string;
  isFromMe: boolean;
  date: string;
  sender: string;
  hasAttachment: boolean;
}

// ─── Helpers ─────────────────────────────────────────

function getInitials(name: string): string {
  if (!name) return '?';
  if (/^[+\d]/.test(name)) return name.slice(-2);
  const parts = name.split(/[\s,]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function truncate(s: string, max: number): string {
  return !s ? '' : s.length > max ? s.slice(0, max) + '...' : s;
}

const AVATAR_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30',
  '#5AC8FA', '#FF2D55', '#5856D6', '#FFCC00', '#00C7BE',
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

// ─── Main View ───────────────────────────────────────

export function IMessageView() {
  const connected = useGatewayStore((s) => s.connected);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [selectedHandle, setSelectedHandle] = useState<string>('');
  const [selectedName, setSelectedName] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [leftTab, setLeftTab] = useState<'chats' | 'contacts'>('chats');
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sendText, setSendText] = useState('');
  const [sending, setSending] = useState(false);
  const [available, setAvailable] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (!connected) return;
    setLoadingConvos(true);
    try {
      const [statusData, data] = await Promise.all([
        gateway.request('imessage.status').catch(() => ({ available: false })),
        gateway.request('imessage.conversations', { limit: 50 }).catch(() => ({ conversations: [] })),
      ]);
      setAvailable((statusData as { available: boolean }).available);
      setConversations((data as { conversations: Conversation[] }).conversations ?? []);
    } catch { /* ignore */ }
    setLoadingConvos(false);
  }, [connected]);

  // Load contacts
  const loadContacts = useCallback(async () => {
    if (!connected || contacts.length > 0) return;
    setLoadingContacts(true);
    try {
      const data = await gateway.request('imessage.contacts').catch(() => ({ contacts: [] }));
      setContacts((data as { contacts: Contact[] }).contacts ?? []);
    } catch { /* ignore */ }
    setLoadingContacts(false);
  }, [connected, contacts.length]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load contacts when switching to contacts tab
  useEffect(() => { if (leftTab === 'contacts') loadContacts(); }, [leftTab, loadContacts]);

  // Open conversation
  const openConversation = useCallback(async (chatId: string, handle: string, name: string) => {
    setSelectedChat(chatId);
    setSelectedHandle(handle);
    setSelectedName(name);
    setComposing(false);
    setLoadingChat(true);
    try {
      const data = await gateway.request('imessage.conversation', { chatId, limit: 100 });
      setMessages((data as { messages: ChatMessage[] }).messages ?? []);
    } catch { setMessages([]); }
    setLoadingChat(false);
  }, []);

  // Open new compose
  const startCompose = (to?: string, name?: string) => {
    setComposing(true);
    setSelectedChat(null);
    setMessages([]);
    setComposeTo(to || '');
    setSelectedHandle(to || '');
    setSelectedName(name || to || '');
  };

  // Send from contact
  const openContactChat = (contact: Contact) => {
    const handle = contact.phones[0] || contact.emails[0] || '';
    if (!handle) return;
    // Check if conversation exists
    const existing = conversations.find((c) =>
      c.handle === handle || c.handles.some((h) => h === handle)
    );
    if (existing) {
      openConversation(existing.chatId, existing.handle, existing.displayName);
    } else {
      startCompose(handle, contact.name);
    }
  };

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send
  const handleSend = async () => {
    const target = composing ? composeTo.trim() : selectedHandle;
    if (!target || !sendText.trim() || sending) return;
    setSending(true);
    try {
      const result = await gateway.request('imessage.send', { to: target, message: sendText.trim() });
      const r = result as { success: boolean; error?: string };
      if (r.success) {
        setSendText('');
        // Reload messages
        if (selectedChat) {
          const data = await gateway.request('imessage.conversation', { chatId: selectedChat, limit: 100 });
          setMessages((data as { messages: ChatMessage[] }).messages ?? []);
        } else if (composing) {
          // Switch to conversation mode after first send
          setComposing(false);
          setSelectedHandle(target);
          setSelectedName(composeTo);
          // Reload conversations to pick up the new one
          loadConversations();
        }
      }
    } catch { /* ignore */ }
    setSending(false);
  };

  // Real-time updates
  useEffect(() => {
    const handler = () => {
      if (selectedChat) {
        gateway.request('imessage.conversation', { chatId: selectedChat, limit: 100 })
          .then((data) => setMessages((data as { messages: ChatMessage[] }).messages ?? []))
          .catch(() => {});
      }
      loadConversations();
    };
    gateway.on('imessage.message', handler);
    return () => { gateway.off('imessage.message', handler); };
  }, [selectedChat, loadConversations]);

  // Filter
  const filteredConvos = searchQuery.trim()
    ? conversations.filter((c) =>
        c.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.handle.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  const filteredContacts = searchQuery.trim()
    ? contacts.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phones.some((p) => p.includes(searchQuery)) ||
        c.emails.some((e) => e.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : contacts;

  const chatActive = selectedChat || composing;
  const activeName = composing ? (composeTo || 'New Message') : selectedName;
  const activeHandle = composing ? composeTo : selectedHandle;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '10px 20px', borderBottom: '1px solid var(--border-primary)',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'rgba(0,122,255,0.15)', border: '1px solid rgba(0,122,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MessageCircle size={16} color="#007AFF" />
        </div>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 14,
          letterSpacing: 3, color: 'var(--text-primary)', margin: 0, flex: 1,
        }}>
          iMESSAGE
        </h1>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600,
          color: available ? '#34C759' : '#ef4444',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: available ? '#34C759' : '#ef4444',
            boxShadow: available ? '0 0 6px rgba(52,199,89,0.5)' : 'none',
          }} />
          {available ? 'CONNECTED' : 'UNAVAILABLE'}
        </span>
      </div>

      {/* Warning */}
      {!available && !loadingConvos && (
        <div style={{
          padding: '10px 20px', flexShrink: 0,
          background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid rgba(239,68,68,0.12)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertTriangle size={14} color="#ef4444" />
          <span style={{ fontSize: 11, color: '#ef4444' }}>macOS with Messages.app required</span>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left panel ── */}
        <div style={{
          width: 340, minWidth: 340, height: '100%',
          borderRight: '1px solid var(--border-primary)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-secondary)',
        }}>
          {/* New message + tabs */}
          <div style={{
            padding: '8px 12px', borderBottom: '1px solid var(--border-primary)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <button
              onClick={() => startCompose()}
              style={{
                width: '100%', padding: '8px 0',
                background: 'rgba(0,122,255,0.1)', border: '1px solid rgba(0,122,255,0.25)',
                borderRadius: 8, color: '#007AFF', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                letterSpacing: 0.5,
              }}
            >
              <Plus size={14} />
              New Message
            </button>

            {/* Tabs: Chats / Contacts */}
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg-tertiary)', borderRadius: 8, padding: 2 }}>
              {(['chats', 'contacts'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setLeftTab(t)}
                  style={{
                    flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600,
                    background: leftTab === t ? 'rgba(0,122,255,0.15)' : 'transparent',
                    border: leftTab === t ? '1px solid rgba(0,122,255,0.2)' : '1px solid transparent',
                    borderRadius: 6, color: leftTab === t ? '#007AFF' : 'var(--text-muted)',
                    cursor: 'pointer', fontFamily: 'var(--font-ui)', letterSpacing: 0.5,
                    textTransform: 'capitalize',
                  }}
                >
                  {t === 'chats' ? `Chats (${conversations.length})` : `Contacts (${contacts.length})`}
                </button>
              ))}
            </div>

            {/* Search */}
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: 8, color: 'var(--text-muted)' }} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={leftTab === 'chats' ? 'Search chats...' : 'Search contacts...'}
                style={{
                  width: '100%', padding: '6px 30px 6px 32px', fontSize: 12,
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                  borderRadius: 8, color: 'var(--text-primary)', outline: 'none',
                  fontFamily: 'var(--font-ui)',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute', right: 6, top: 5,
                    background: 'none', border: 'none', padding: 2,
                    cursor: 'pointer', color: 'var(--text-muted)',
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {leftTab === 'chats' ? (
              loadingConvos ? (
                <EmptyState text="Loading chats..." />
              ) : filteredConvos.length === 0 ? (
                <EmptyState text={searchQuery ? 'No chats found' : 'No conversations yet'} />
              ) : (
                filteredConvos.map((conv) => (
                  <ConversationRow
                    key={conv.chatId}
                    conv={conv}
                    selected={conv.chatId === selectedChat}
                    onClick={() => openConversation(conv.chatId, conv.handle, conv.displayName)}
                  />
                ))
              )
            ) : (
              loadingContacts ? (
                <EmptyState text="Loading contacts..." />
              ) : filteredContacts.length === 0 ? (
                <EmptyState text={searchQuery ? 'No contacts found' : 'No contacts'} />
              ) : (
                filteredContacts.map((contact, i) => (
                  <ContactRow
                    key={`${contact.name}-${i}`}
                    contact={contact}
                    onClick={() => openContactChat(contact)}
                  />
                ))
              )
            )}
          </div>

          {/* Refresh */}
          <div style={{
            padding: '6px 12px', borderTop: '1px solid var(--border-primary)',
            display: 'flex', justifyContent: 'center',
          }}>
            <button
              onClick={() => { loadConversations(); if (leftTab === 'contacts') loadContacts(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 14px', fontSize: 10,
                background: 'transparent', border: '1px solid var(--border-dim)',
                borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              <RefreshCw size={10} />
              REFRESH
            </button>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div style={{
          flex: 1, height: '100%', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-primary)',
        }}>
          {!chatActive ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 16,
            }}>
              <MessageCircle size={56} strokeWidth={1} color="var(--text-muted)" style={{ opacity: 0.2 }} />
              <span style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
                Select a conversation or start a new message
              </span>
              <button
                onClick={() => startCompose()}
                style={{
                  padding: '8px 24px', fontSize: 12,
                  background: 'rgba(0,122,255,0.1)', border: '1px solid rgba(0,122,255,0.25)',
                  borderRadius: 8, color: '#007AFF', cursor: 'pointer',
                  fontFamily: 'var(--font-ui)', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <Plus size={14} />
                New Message
              </button>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--border-primary)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--bg-secondary)', flexShrink: 0,
              }}>
                <button
                  onClick={() => { setSelectedChat(null); setComposing(false); }}
                  style={{
                    background: 'none', border: 'none', padding: 4,
                    cursor: 'pointer', color: 'var(--text-muted)',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <ArrowLeft size={16} />
                </button>

                {composing ? (
                  /* Compose header — TO field */
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontWeight: 600 }}>
                      To:
                    </span>
                    <input
                      value={composeTo}
                      onChange={(e) => { setComposeTo(e.target.value); setSelectedHandle(e.target.value); setSelectedName(e.target.value); }}
                      placeholder="Phone number or email..."
                      autoFocus
                      style={{
                        flex: 1, padding: '6px 12px', fontSize: 13,
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                        borderRadius: 8, color: 'var(--text-primary)', outline: 'none',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  </div>
                ) : (
                  /* Normal chat header */
                  <>
                    <div style={{
                      width: 34, height: 34, borderRadius: 17, flexShrink: 0,
                      background: avatarColor(activeHandle),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: '#fff',
                    }}>
                      {getInitials(activeName)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-white)', fontFamily: 'var(--font-ui)' }}>
                        {activeName}
                      </div>
                      {activeHandle !== activeName && (
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {activeHandle}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => selectedChat && openConversation(selectedChat, selectedHandle, selectedName)}
                      style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--text-muted)' }}
                    >
                      <RefreshCw size={13} />
                    </button>
                  </>
                )}
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
                {loadingChat ? (
                  <EmptyState text="Loading messages..." />
                ) : messages.length === 0 && !composing ? (
                  <EmptyState text="No messages yet — send one below" />
                ) : messages.length === 0 && composing ? (
                  <EmptyState text="Type a message to start the conversation" />
                ) : (
                  <>
                    {messages.map((msg, i) => {
                      const prevMsg = i > 0 ? messages[i - 1] : null;
                      const showDate = !prevMsg || msg.date?.split(' ')[0] !== prevMsg.date?.split(' ')[0];
                      return (
                        <div key={msg.id || i}>
                          {showDate && msg.date && (
                            <div style={{
                              textAlign: 'center', margin: '14px 0 10px',
                              fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                            }}>
                              {msg.date.split(' ')[0]}
                            </div>
                          )}
                          <MessageBubble msg={msg} />
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Send */}
              <div style={{
                padding: '10px 16px', borderTop: '1px solid var(--border-primary)',
                background: 'var(--bg-secondary)',
                display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0,
              }}>
                <textarea
                  value={sendText}
                  onChange={(e) => setSendText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="iMessage"
                  rows={1}
                  style={{
                    flex: 1, padding: '10px 16px', fontSize: 13,
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                    borderRadius: 20, color: 'var(--text-primary)', outline: 'none',
                    resize: 'none', fontFamily: 'var(--font-ui)',
                    maxHeight: 100, lineHeight: 1.4,
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!sendText.trim() || sending || !available || !(composing ? composeTo.trim() : selectedHandle)}
                  style={{
                    width: 36, height: 36, borderRadius: 18, flexShrink: 0,
                    background: sendText.trim() && available ? '#007AFF' : 'var(--bg-tertiary)',
                    border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: sendText.trim() && available ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                  }}
                >
                  <Send size={16} color={sendText.trim() && available ? '#fff' : 'var(--text-muted)'} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
      {text}
    </div>
  );
}

function ConversationRow({ conv, selected, onClick }: {
  conv: Conversation; selected: boolean; onClick: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', padding: '10px 14px', textAlign: 'left',
        background: selected ? 'rgba(0,122,255,0.12)' : hover ? 'rgba(255,255,255,0.03)' : 'transparent',
        border: 'none', borderBottom: '1px solid var(--border-dim)',
        borderLeft: selected ? '3px solid #007AFF' : '3px solid transparent',
        cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center',
        transition: 'background 0.1s',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 20, flexShrink: 0,
        background: avatarColor(conv.handle || conv.chatId),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: '#fff',
      }}>
        {getInitials(conv.displayName)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontSize: 12, fontWeight: conv.unreadCount > 0 ? 700 : 500,
            color: 'var(--text-white)', fontFamily: 'var(--font-ui)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {conv.displayName}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
            {formatRelativeDate(conv.lastMessageDate)}
          </span>
        </div>
        {conv.lastMessage && (
          <div style={{
            fontSize: 11, marginTop: 2,
            color: 'var(--text-muted)', fontFamily: 'var(--font-ui)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {conv.lastFromMe ? 'You: ' : ''}{truncate(conv.lastMessage, 45)}
          </div>
        )}
      </div>
    </button>
  );
}

function ContactRow({ contact, onClick }: { contact: Contact; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const primaryHandle = contact.phones[0] || contact.emails[0] || '';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', padding: '10px 14px', textAlign: 'left',
        background: hover ? 'rgba(255,255,255,0.03)' : 'transparent',
        border: 'none', borderBottom: '1px solid var(--border-dim)',
        cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center',
        transition: 'background 0.1s',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 20, flexShrink: 0,
        background: avatarColor(contact.name),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: '#fff',
      }}>
        {getInitials(contact.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: 'var(--text-white)',
          fontFamily: 'var(--font-ui)',
        }}>
          {contact.name}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          {contact.phones.slice(0, 2).map((p, i) => (
            <span key={i} style={{
              display: 'flex', alignItems: 'center', gap: 3,
              fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            }}>
              <Phone size={9} /> {p}
            </span>
          ))}
          {contact.emails.slice(0, 1).map((e, i) => (
            <span key={i} style={{
              display: 'flex', alignItems: 'center', gap: 3,
              fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            }}>
              <Mail size={9} /> {truncate(e, 25)}
            </span>
          ))}
        </div>
      </div>
      <ChevronRight size={14} color="var(--text-muted)" style={{ opacity: 0.3, flexShrink: 0 }} />
    </button>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const fromMe = msg.isFromMe;

  return (
    <div style={{
      display: 'flex',
      justifyContent: fromMe ? 'flex-end' : 'flex-start',
      marginBottom: 3,
    }}>
      <div style={{
        maxWidth: '70%', padding: '8px 14px',
        borderRadius: fromMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        background: fromMe ? '#007AFF' : 'var(--bg-tertiary)',
        border: fromMe ? 'none' : '1px solid var(--border-dim)',
        color: fromMe ? '#fff' : 'var(--text-white)',
      }}>
        {msg.hasAttachment && !msg.text && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, opacity: 0.7, fontStyle: 'italic',
          }}>
            <Paperclip size={12} /> Attachment
          </div>
        )}
        {msg.text && (
          <div style={{
            fontSize: 13, lineHeight: 1.4, fontFamily: 'var(--font-ui)',
            wordBreak: 'break-word',
          }}>
            {msg.text}
          </div>
        )}
        <div style={{
          fontSize: 9, marginTop: 3, opacity: 0.5, textAlign: 'right',
          fontFamily: 'var(--font-mono)',
        }}>
          {msg.date ? msg.date.split(' ')[1] || '' : ''}
        </div>
      </div>
    </div>
  );
}
