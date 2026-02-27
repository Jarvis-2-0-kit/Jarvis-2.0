/**
 * WhatsAppView — Jarvis WhatsApp Integration via Baileys
 *
 * QR Code Login Flow (like WhatsApp Web):
 * 1. Click "Show QR" → gateway generates QR via Baileys
 * 2. Scan with WhatsApp app → Linked Devices
 * 3. Connection established → chat interface appears
 *
 * Features:
 * - QR code login (no API keys needed!)
 * - Real-time message send/receive via Baileys WebSocket
 * - Contact list built from message history
 * - Auto-reply with Jarvis AI
 * - Message history stored on NAS
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageCircle,
  Send,
  Settings,
  RefreshCw,
  Search,
  Phone,
  Bot,
  X,
  Check,
  AlertCircle,
  Wifi,
  WifiOff,
  QrCode,
  LogOut,
  Zap,
  Clock,
  ArrowLeft,
  Smartphone,
  Link,
  Loader,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';

interface WhatsAppContact {
  id: string;
  phone: string;
  name: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unread: number;
}

interface WhatsAppMessage {
  id: string;
  from: string;
  fromName?: string;
  to: string;
  body: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
  status: 'sent' | 'delivered' | 'read' | 'failed';
  type: 'text' | 'image' | 'audio' | 'document';
  autoReply?: boolean;
}

interface WhatsAppStatus {
  connected: boolean;
  loggedIn: boolean;
  selfJid: string | null;
  qrPending: boolean;
  message: string;
}

export function WhatsAppView() {
  const [status, setStatus] = useState<WhatsAppStatus>({
    connected: false, loggedIn: false, selfJid: null, qrPending: false, message: 'Loading...',
  });
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [selectedContact, setSelectedContact] = useState<WhatsAppContact | null>(null);
  const [composing, setComposing] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [sendToNumber, setSendToNumber] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);

  // QR Login state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [waitingForScan, setWaitingForScan] = useState(false);

  // Config
  const [jarvisMode, setJarvisMode] = useState(true);
  const [autoReplyLang, setAutoReplyLang] = useState<'pl' | 'en'>('pl');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load status and messages on mount
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for incoming messages
  useEffect(() => {
    const unsubMsg = gateway.on('whatsapp.message', (payload) => {
      const msg = payload as WhatsAppMessage;
      setMessages((prev) => [...prev, msg].slice(-500));
      updateContactFromMessage(msg);
    });
    const unsubSent = gateway.on('whatsapp.sent', (payload) => {
      // Sent confirmation — reload status
    });
    const unsubConn = gateway.on('whatsapp.connected', () => {
      setStatus((prev) => ({ ...prev, connected: true, message: 'Connected!' }));
      setQrDataUrl(null);
      setWaitingForScan(false);
      loadData();
    });
    const unsubDisconn = gateway.on('whatsapp.disconnected', () => {
      setStatus((prev) => ({ ...prev, connected: false }));
    });
    return () => { unsubMsg(); unsubSent(); unsubConn(); unsubDisconn(); };
  }, []);

  const updateContactFromMessage = (msg: WhatsAppMessage) => {
    const phone = msg.direction === 'incoming' ? msg.from : msg.to;
    const name = msg.fromName || phone.split('@')[0];
    setContacts((prev) => {
      const existing = prev.find((c) => c.phone === phone);
      if (existing) {
        return prev.map((c) =>
          c.phone === phone
            ? { ...c, lastMessage: msg.body, lastMessageTime: msg.timestamp, name: msg.fromName || c.name, unread: msg.direction === 'incoming' ? c.unread + 1 : c.unread }
            : c,
        );
      }
      return [
        { id: phone, phone, name, lastMessage: msg.body, lastMessageTime: msg.timestamp, unread: msg.direction === 'incoming' ? 1 : 0 },
        ...prev,
      ];
    });
  };

  const loadData = useCallback(async () => {
    try {
      const [statusRes, messagesRes, configRes] = await Promise.all([
        gateway.request('whatsapp.status', {}),
        gateway.request('whatsapp.messages', { limit: 200 }),
        gateway.request('whatsapp.config.get', {}),
      ]);

      const st = statusRes as WhatsAppStatus;
      if (st) setStatus(st);

      const msgData = messagesRes as { messages: WhatsAppMessage[] };
      if (msgData?.messages) {
        setMessages(msgData.messages);
        buildContactsFromMessages(msgData.messages);
      }

      const cfg = configRes as Record<string, unknown>;
      if (cfg) {
        setJarvisMode(!!(cfg.jarvisMode ?? true));
        setAutoReplyLang((cfg.autoReplyLanguage as 'pl' | 'en') ?? 'pl');
      }
    } catch { /* gateway not ready */ }
    finally { setLoading(false); }
  }, []);

  const buildContactsFromMessages = (msgs: WhatsAppMessage[]) => {
    const contactMap = new Map<string, WhatsAppContact>();
    for (const msg of msgs) {
      const phone = msg.direction === 'incoming' ? msg.from : msg.to;
      if (phone === 'jarvis') continue;
      const existing = contactMap.get(phone);
      if (!existing || (msg.timestamp > (existing.lastMessageTime || 0))) {
        contactMap.set(phone, {
          id: phone,
          phone,
          name: msg.fromName || phone.split('@')[0],
          lastMessage: msg.body,
          lastMessageTime: msg.timestamp,
          unread: 0,
        });
      }
    }
    setContacts(Array.from(contactMap.values()).sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0)));
  };

  // --- QR Login Flow ---

  const handleShowQR = async (force = false) => {
    setQrLoading(true);
    setQrMessage('Generating QR code...');
    try {
      const result = await gateway.request('whatsapp.login.start', { force }) as { qrDataUrl: string | null; message: string };
      setQrDataUrl(result.qrDataUrl);
      setQrMessage(result.message);

      // If QR was generated, start waiting for scan
      if (result.qrDataUrl) {
        setWaitingForScan(true);
        // Wait for scan in background
        const waitResult = await gateway.request('whatsapp.login.wait', {}) as { connected: boolean; message: string };
        setWaitingForScan(false);
        if (waitResult.connected) {
          setQrDataUrl(null);
          setQrMessage('Connected!');
          await loadData();
        } else {
          setQrMessage(waitResult.message);
        }
      }
    } catch (err) {
      setQrMessage(`Error: ${(err as Error).message}`);
    } finally {
      setQrLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const result = await gateway.request('whatsapp.logout', {}) as { success: boolean; message: string };
      setQrMessage(result.message);
      setQrDataUrl(null);
      await loadData();
    } catch (err) {
      setQrMessage(`Error: ${(err as Error).message}`);
    }
  };

  const handleConnect = async () => {
    try {
      await gateway.request('whatsapp.connect', {});
      await loadData();
    } catch { /* */ }
  };

  // --- Send Message ---

  const handleSend = async () => {
    if (!composing.trim() || !selectedContact) return;
    setSending(true);
    try {
      await gateway.request('whatsapp.send', {
        to: selectedContact.phone,
        message: composing.trim(),
      });
      setComposing('');
    } catch { /* */ }
    finally { setSending(false); }
  };

  const handleSendToNew = async () => {
    if (!composing.trim() || !sendToNumber.trim()) return;
    setSending(true);
    try {
      await gateway.request('whatsapp.send', {
        to: sendToNumber.trim(),
        message: composing.trim(),
      });
      setComposing('');
      setShowNewChat(false);
      await loadData();
    } catch { /* */ }
    finally { setSending(false); }
  };

  const handleSaveConfig = async () => {
    try {
      await gateway.request('whatsapp.config.set', {
        jarvisMode,
        autoReplyLanguage: autoReplyLang,
      });
    } catch { /* */ }
  };

  // Filter contacts
  const filteredContacts = contacts.filter((c) =>
    !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery),
  );

  // Messages for selected contact
  const contactMessages = selectedContact
    ? messages.filter((m) => m.from === selectedContact.phone || m.to === selectedContact.phone)
    : [];

  // --- NOT CONNECTED: Show QR Login Screen ---
  if (!status.connected) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(135deg, #075e54, #128c7e)',
        }}>
          <MessageCircle size={18} color="#25D366" />
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
            letterSpacing: 2, color: '#25D366', textShadow: '0 0 8px rgba(37,211,102,0.4)',
          }}>
            WHATSAPP
          </span>
          <span style={{
            fontSize: 9, padding: '2px 8px', borderRadius: 3,
            background: 'rgba(255,60,60,0.15)', border: '1px solid rgba(255,60,60,0.3)',
            color: '#ff6060', fontFamily: 'var(--font-display)', letterSpacing: 1,
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <WifiOff size={8} /> DISCONNECTED
          </span>
        </div>

        {/* QR Login Area */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: 40, gap: 24,
        }}>
          <Smartphone size={48} color="#25D366" style={{ opacity: 0.6 }} />

          <div style={{ textAlign: 'center', maxWidth: 400 }}>
            <h2 style={{
              fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800,
              letterSpacing: 3, color: '#25D366', margin: '0 0 8px',
            }}>
              CONNECT WHATSAPP
            </h2>
            <p style={{
              fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)',
              lineHeight: 1.6, margin: 0,
            }}>
              {status.loggedIn
                ? 'You have saved credentials. Click Connect or scan a new QR code.'
                : 'Scan the QR code with your WhatsApp app to link Jarvis as a device.'}
            </p>
          </div>

          {/* QR Code Display */}
          {qrDataUrl && (
            <div style={{
              padding: 16, borderRadius: 12, background: '#ffffff',
              boxShadow: '0 4px 24px rgba(37,211,102,0.2)',
            }}>
              <img
                src={qrDataUrl}
                alt="WhatsApp QR Code"
                style={{ width: 260, height: 260, display: 'block' }}
              />
            </div>
          )}

          {/* Waiting indicator */}
          {waitingForScan && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 6,
              background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)',
            }}>
              <Loader size={14} color="#25D366" style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 11, color: '#25D366', fontFamily: 'var(--font-ui)' }}>
                Waiting for scan...
              </span>
            </div>
          )}

          {/* Status message */}
          {qrMessage && (
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)',
              textAlign: 'center', maxWidth: 400,
            }}>
              {qrMessage}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            {status.loggedIn && (
              <button
                onClick={handleConnect}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 20px', borderRadius: 8,
                  background: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.4)',
                  color: '#25D366', cursor: 'pointer',
                  fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 1,
                }}
              >
                <Link size={14} /> CONNECT
              </button>
            )}

            <button
              onClick={() => handleShowQR(false)}
              disabled={qrLoading}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 20px', borderRadius: 8,
                background: '#25D366', border: 'none',
                color: '#ffffff', cursor: qrLoading ? 'wait' : 'pointer',
                fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 1,
                fontWeight: 700, opacity: qrLoading ? 0.6 : 1,
              }}
            >
              <QrCode size={14} /> {qrLoading ? 'GENERATING...' : 'SHOW QR'}
            </button>

            {status.loggedIn && (
              <button
                onClick={() => handleShowQR(true)}
                disabled={qrLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 20px', borderRadius: 8,
                  background: 'rgba(255,170,0,0.1)', border: '1px solid rgba(255,170,0,0.3)',
                  color: 'var(--amber)', cursor: 'pointer',
                  fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 1,
                }}
              >
                <RefreshCw size={14} /> RELINK
              </button>
            )}

            {status.loggedIn && (
              <button
                onClick={handleLogout}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 20px', borderRadius: 8,
                  background: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,60,60,0.3)',
                  color: '#ff6060', cursor: 'pointer',
                  fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 1,
                }}
              >
                <LogOut size={14} /> LOGOUT
              </button>
            )}
          </div>

          {/* Instructions */}
          <div style={{
            marginTop: 8, padding: 16, borderRadius: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-dim)',
            maxWidth: 460,
          }}>
            <div style={{
              fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1.5,
              color: '#25D366', marginBottom: 8, fontWeight: 700,
            }}>
              HOW TO CONNECT
            </div>
            <ol style={{
              margin: 0, paddingLeft: 16,
              fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)',
              lineHeight: 1.8,
            }}>
              <li>Click <strong style={{ color: '#25D366' }}>SHOW QR</strong> above</li>
              <li>Open WhatsApp on your phone</li>
              <li>Go to <strong>Settings → Linked Devices → Link a Device</strong></li>
              <li>Scan the QR code with your phone</li>
              <li>Done! Jarvis will receive and send messages through your account</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  // --- CONNECTED: Show Chat Interface ---
  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      {/* Left panel — Contacts */}
      <div style={{
        width: 280, minWidth: 280,
        borderRight: '1px solid var(--border-primary)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-secondary)',
      }}>
        {/* Contacts header */}
        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-dim)',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'linear-gradient(135deg, #075e5488, #128c7e44)',
        }}>
          <MessageCircle size={14} color="#25D366" />
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
            letterSpacing: 2, color: '#25D366', flex: 1,
          }}>
            WHATSAPP
          </span>
          <span style={{
            fontSize: 8, padding: '2px 6px', borderRadius: 3,
            background: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.3)',
            color: '#25D366', fontFamily: 'var(--font-display)', letterSpacing: 1,
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <Wifi size={7} /> ONLINE
          </span>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: showSettings ? '#25D366' : 'var(--text-muted)', display: 'flex',
            }}
          >
            <Settings size={14} />
          </button>
        </div>

        {/* Settings dropdown */}
        {showSettings && (
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--border-dim)',
            background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Connected as: {status.selfJid?.split('@')[0] || '?'}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={jarvisMode}
                onChange={(e) => { setJarvisMode(e.target.checked); setTimeout(handleSaveConfig, 100); }}
                style={{ accentColor: '#25D366' }}
              />
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
                Jarvis auto-reply
              </span>
            </label>
            <select
              value={autoReplyLang}
              onChange={(e) => { setAutoReplyLang(e.target.value as 'pl' | 'en'); setTimeout(handleSaveConfig, 100); }}
              style={{
                fontSize: 10, padding: '4px 8px', borderRadius: 4,
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
              }}
            >
              <option value="pl">Polish</option>
              <option value="en">English</option>
            </select>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleLogout}
                style={{
                  fontSize: 9, padding: '4px 10px', borderRadius: 4,
                  background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.2)',
                  color: '#ff6060', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                  fontFamily: 'var(--font-display)', letterSpacing: 1,
                }}
              >
                <LogOut size={9} /> LOGOUT
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        <div style={{
          padding: '8px 10px', borderBottom: '1px solid var(--border-dim)',
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg-tertiary)',
        }}>
          <Search size={12} color="var(--text-muted)" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            style={{
              flex: 1, background: 'none', border: 'none',
              color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', fontSize: 11, outline: 'none',
            }}
          />
        </div>

        {/* Contact list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* New chat button */}
          <button
            onClick={() => setShowNewChat(true)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--border-dim)',
              background: 'rgba(37,211,102,0.04)', cursor: 'pointer', textAlign: 'left',
              color: '#25D366',
            }}
          >
            <Phone size={14} />
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11 }}>New Chat</span>
          </button>

          {filteredContacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => {
                setSelectedContact(contact);
                setContacts((prev) => prev.map((c) => c.id === contact.id ? { ...c, unread: 0 } : c));
              }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', border: 'none',
                borderBottom: '1px solid var(--border-dim)',
                background: selectedContact?.id === contact.id ? 'rgba(37,211,102,0.08)' : 'transparent',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: '#25D36620', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#25D366', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
              }}>
                {contact.name[0]?.toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{
                  fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 600,
                  color: 'var(--text-primary)', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {contact.name}
                </div>
                {contact.lastMessage && (
                  <div style={{
                    fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1,
                  }}>
                    {contact.lastMessage}
                  </div>
                )}
              </div>
              {contact.unread > 0 && (
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', background: '#25D366',
                  color: '#fff', fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {contact.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right panel — Chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedContact && !showNewChat ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8, color: 'var(--text-muted)',
          }}>
            <MessageCircle size={40} color="#25D366" style={{ opacity: 0.2 }} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2 }}>
              SELECT A CHAT
            </span>
          </div>
        ) : showNewChat ? (
          /* New chat form */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setShowNewChat(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <ArrowLeft size={16} />
              </button>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: 2, color: '#25D366' }}>NEW MESSAGE</span>
            </div>
            <input
              value={sendToNumber}
              onChange={(e) => setSendToNumber(e.target.value)}
              placeholder="Phone number (e.g. 48123456789)"
              style={{
                padding: '10px 14px', borderRadius: 6,
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none',
              }}
            />
            <textarea
              value={composing}
              onChange={(e) => setComposing(e.target.value)}
              placeholder="Type your message..."
              rows={3}
              style={{
                padding: '10px 14px', borderRadius: 6,
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', fontSize: 13,
                outline: 'none', resize: 'vertical',
              }}
            />
            <button
              onClick={handleSendToNew}
              disabled={!composing.trim() || !sendToNumber.trim() || sending}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '10px 20px', borderRadius: 6,
                background: '#25D366', border: 'none', color: '#fff',
                cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 1,
                opacity: (!composing.trim() || !sendToNumber.trim()) ? 0.5 : 1,
              }}
            >
              <Send size={12} /> SEND
            </button>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border-primary)',
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'linear-gradient(135deg, #075e5422, #128c7e11)',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: '#25D36620', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#25D366', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
              }}>
                {selectedContact!.name[0]?.toUpperCase() || '?'}
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: 1, color: 'var(--text-primary)' }}>
                  {selectedContact!.name}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {selectedContact!.phone}
                </div>
              </div>
              {jarvisMode && (
                <span style={{
                  marginLeft: 'auto', fontSize: 8, padding: '2px 8px', borderRadius: 3,
                  background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)',
                  color: '#25D366', fontFamily: 'var(--font-display)', letterSpacing: 1,
                  display: 'flex', alignItems: 'center', gap: 3,
                }}>
                  <Bot size={8} /> JARVIS MODE
                </span>
              )}
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '12px 16px',
              display: 'flex', flexDirection: 'column', gap: 6,
              background: 'linear-gradient(180deg, #0b1015, #0d1218)',
            }}>
              {contactMessages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    justifyContent: msg.direction === 'outgoing' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div style={{
                    maxWidth: '70%',
                    padding: '8px 12px',
                    borderRadius: msg.direction === 'outgoing' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    background: msg.direction === 'outgoing'
                      ? '#005c4b'
                      : 'var(--bg-secondary)',
                    border: `1px solid ${msg.direction === 'outgoing' ? '#00856433' : 'var(--border-dim)'}`,
                  }}>
                    {msg.autoReply && (
                      <div style={{
                        fontSize: 8, color: '#25D366', fontFamily: 'var(--font-display)',
                        letterSpacing: 1, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        <Bot size={7} /> JARVIS AUTO-REPLY
                      </div>
                    )}
                    <div style={{
                      fontFamily: 'var(--font-ui)', fontSize: 12, lineHeight: 1.4,
                      color: 'var(--text-primary)',
                    }}>
                      {msg.body}
                    </div>
                    <div style={{
                      fontSize: 8, color: 'var(--text-muted)', marginTop: 4,
                      textAlign: 'right', fontFamily: 'var(--font-mono)',
                    }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {msg.direction === 'outgoing' && (
                        <Check size={8} color="#25D366" style={{ marginLeft: 4 }} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Compose */}
            <div style={{
              padding: '10px 16px',
              borderTop: '1px solid var(--border-primary)',
              display: 'flex', gap: 8,
              background: 'var(--bg-secondary)',
            }}>
              <input
                value={composing}
                onChange={(e) => setComposing(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message..."
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 20,
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                  color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', fontSize: 13, outline: 'none',
                }}
              />
              <button
                onClick={handleSend}
                disabled={!composing.trim() || sending}
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: composing.trim() ? '#25D366' : 'var(--bg-tertiary)',
                  border: 'none',
                  color: composing.trim() ? '#fff' : 'var(--text-muted)',
                  cursor: composing.trim() ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Send size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
