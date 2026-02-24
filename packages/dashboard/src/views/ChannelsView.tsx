/**
 * ChannelsView — Unified messaging channels hub
 *
 * Shows all messaging channels (WhatsApp, Telegram, Discord, iMessage)
 * with status, message counts, and quick actions.
 * Inspired by OpenClaw's multi-channel architecture.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageCircle,
  Send,
  Hash,
  MessageSquare,
  Wifi,
  WifiOff,
  Bot,
  Settings,
  ChevronRight,
  RefreshCw,
  Zap,
  Radio,
  Globe,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';

interface ChannelInfo {
  id: string;
  name: string;
  type: string;
  connected: boolean;
  messageCount: number;
  lastActivity?: number;
}

const CHANNEL_META: Record<string, {
  icon: typeof MessageCircle;
  color: string;
  description: string;
  route: string;
  setup: string;
}> = {
  whatsapp: {
    icon: MessageCircle,
    color: '#25D366',
    description: 'WhatsApp Business Cloud API — send & receive messages, auto-reply with Jarvis',
    route: '/whatsapp',
    setup: 'Meta Developer Console → Phone Number ID + Access Token',
  },
  telegram: {
    icon: Send,
    color: '#0088CC',
    description: 'Telegram Bot API — manage bot, auto-reply, process commands',
    route: '/telegram',
    setup: 'BotFather → Bot Token + Chat ID',
  },
  discord: {
    icon: Hash,
    color: '#5865F2',
    description: 'Discord Bot or Webhook — server integration, auto-reply, slash commands',
    route: '/discord',
    setup: 'Discord Dev Portal → Bot Token or Webhook URL',
  },
  slack: {
    icon: Hash,
    color: '#E01E5A',
    description: 'Slack workspace integration — Bot API + Socket Mode, auto-reply',
    route: '/slack',
    setup: 'Slack API → Bot Token + App Token (Socket Mode)',
  },
  imessage: {
    icon: MessageSquare,
    color: '#007AFF',
    description: 'macOS iMessage integration via AppleScript — send iMessage & SMS',
    route: '/imessage',
    setup: 'macOS only — uses Messages.app via osascript',
  },
};

export function ChannelsView() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadChannels();
    const interval = setInterval(loadChannels, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const result = await gateway.request('channels.list', {}) as ChannelInfo[];
      if (Array.isArray(result)) setChannels(result);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  const totalMessages = channels.reduce((sum, c) => sum + c.messageCount, 0);
  const connectedCount = channels.filter((c) => c.connected).length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Radio size={20} color="var(--cyan-bright)" />
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800,
            letterSpacing: 3, color: 'var(--cyan-bright)',
            textShadow: 'var(--glow-cyan)',
          }}>
            CHANNELS
          </span>
        </div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)',
          maxWidth: 500, lineHeight: 1.6,
        }}>
          Messaging channels connect Jarvis to WhatsApp, Telegram, Discord, and more.
          Each channel supports auto-reply, commands, and full Jarvis AI integration.
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 24,
      }}>
        {[
          { label: 'CHANNELS', value: channels.length, color: 'var(--cyan-bright)', icon: Globe },
          { label: 'CONNECTED', value: connectedCount, color: 'var(--green-bright)', icon: Wifi },
          { label: 'MESSAGES', value: totalMessages, color: 'var(--purple)', icon: MessageCircle },
        ].map((stat) => (
          <div key={stat.label} style={{
            padding: '12px 18px', borderRadius: 8,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-dim)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <stat.icon size={16} color={stat.color} style={{ opacity: 0.7 }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', color: stat.color }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 8, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-muted)' }}>
                {stat.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Channel cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380, 1fr))', gap: 12 }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, padding: 20 }}>
            <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
            Loading channels...
          </div>
        ) : (
          channels.map((channel) => {
            const meta = CHANNEL_META[channel.id] || {
              icon: MessageCircle,
              color: 'var(--text-muted)',
              description: 'Unknown channel',
              route: '#',
              setup: '',
            };
            const Icon = meta.icon;

            return (
              <div
                key={channel.id}
                onClick={() => navigate(meta.route)}
                style={{
                  padding: 16, borderRadius: 10,
                  background: 'linear-gradient(135deg, var(--bg-secondary), var(--bg-tertiary))',
                  border: `1px solid ${channel.connected ? `${meta.color}33` : 'var(--border-dim)'}`,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Glow effect for connected channels */}
                {channel.connected && (
                  <div style={{
                    position: 'absolute', top: -20, right: -20,
                    width: 80, height: 80, borderRadius: '50%',
                    background: `${meta.color}08`,
                    filter: 'blur(20px)',
                  }} />
                )}

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, position: 'relative' }}>
                  {/* Icon */}
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                    background: `${meta.color}15`,
                    border: `1px solid ${meta.color}33`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={20} color={meta.color} />
                  </div>

                  <div style={{ flex: 1 }}>
                    {/* Title + Status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
                        letterSpacing: 1.5, color: meta.color,
                      }}>
                        {channel.name.toUpperCase()}
                      </span>
                      <span style={{
                        fontSize: 8, fontFamily: 'var(--font-display)', letterSpacing: 1,
                        padding: '2px 6px', borderRadius: 3,
                        background: channel.connected ? `${meta.color}15` : 'rgba(255,85,85,0.1)',
                        border: `1px solid ${channel.connected ? `${meta.color}33` : '#ff555533'}`,
                        color: channel.connected ? meta.color : 'var(--red-bright)',
                        display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        {channel.connected ? <Wifi size={7} /> : <WifiOff size={7} />}
                        {channel.connected ? 'CONNECTED' : 'OFFLINE'}
                      </span>
                    </div>

                    {/* Description */}
                    <div style={{
                      fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)',
                      lineHeight: 1.5, marginBottom: 8,
                    }}>
                      {meta.description}
                    </div>

                    {/* Stats */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        <MessageCircle size={10} />
                        {channel.messageCount} msgs
                      </div>
                      {channel.lastActivity && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          Last: {new Date(channel.lastActivity).toLocaleDateString()}
                        </div>
                      )}
                      {!channel.connected && (
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontStyle: 'italic' }}>
                          Setup: {meta.setup}
                        </div>
                      )}
                    </div>
                  </div>

                  <ChevronRight size={16} color="var(--text-muted)" style={{ marginTop: 4 }} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Info: How channels work */}
      <div style={{
        marginTop: 32, padding: 16, borderRadius: 10,
        background: 'var(--bg-secondary)', border: '1px solid var(--border-dim)',
      }}>
        <div style={{
          fontSize: 10, fontFamily: 'var(--font-display)', fontWeight: 700,
          letterSpacing: 1.5, color: 'var(--cyan-bright)', marginBottom: 10,
        }}>
          HOW CHANNELS WORK
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
          fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', lineHeight: 1.6,
        }}>
          <div>
            <div style={{ color: 'var(--green-bright)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Zap size={10} /> Incoming Messages
            </div>
            Messages arrive via webhooks. Jarvis auto-replies if Jarvis Mode is ON. Commands like /status and /tasks are processed instantly.
          </div>
          <div>
            <div style={{ color: 'var(--cyan-bright)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Bot size={10} /> Jarvis AI Mode
            </div>
            When enabled, Jarvis uses the same AI that powers voice and chat to respond intelligently in Polish or English.
          </div>
          <div>
            <div style={{ color: 'var(--purple)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Settings size={10} /> Webhook Setup
            </div>
            Each channel needs a public URL for webhooks. Use ngrok or cloudflared: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}>ngrok http 18900</span>
          </div>
        </div>
      </div>
    </div>
  );
}
