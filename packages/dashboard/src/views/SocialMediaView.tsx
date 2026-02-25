import { useEffect, useState, useCallback } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  Share2,
  Send,
  Calendar,
  BarChart3,
  RefreshCw,
  Plus,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Twitter,
  Instagram,
  Facebook,
  Linkedin,
  Video,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────

interface ScheduledPost {
  id: string;
  platform: string;
  action: string;
  text: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  link?: string;
  title?: string;
  scheduledAt: number;
  status: 'scheduled' | 'published' | 'failed' | 'cancelled';
  createdAt: number;
  publishedAt?: number;
  error?: string;
}

type Tab = 'overview' | 'scheduled' | 'compose' | 'analytics';

const PLATFORMS = [
  { id: 'twitter', label: 'Twitter/X', icon: Twitter, color: '#1DA1F2' },
  { id: 'instagram', label: 'Instagram', icon: Instagram, color: '#E4405F' },
  { id: 'facebook', label: 'Facebook', icon: Facebook, color: '#1877F2' },
  { id: 'linkedin', label: 'LinkedIn', icon: Linkedin, color: '#0A66C2' },
  { id: 'tiktok', label: 'TikTok', icon: Video, color: '#00f2ea' },
] as const;

const POST_TYPES = ['post', 'photo', 'video', 'thread', 'carousel', 'reel'] as const;

// ─── Main View ──────────────────────────────────────

export function SocialMediaView() {
  const connected = useGatewayStore((s) => s.connected);
  const [tab, setTab] = useState<Tab>('overview');
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(false);

  // Compose form
  const [compose, setCompose] = useState({
    platform: 'twitter' as string,
    action: 'post' as string,
    text: '',
    mediaUrl: '',
    link: '',
    title: '',
    scheduledAt: '',
  });
  const [postNow, setPostNow] = useState(true);

  const fetchScheduled = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gateway.request<ScheduledPost[]>('social.schedule.list');
      if (Array.isArray(data)) setPosts(data);
    } catch {
      // Try alternate endpoint
      try {
        const data = await gateway.request<{ posts: ScheduledPost[] }>('social.scheduled');
        if (data?.posts) setPosts(data.posts);
      } catch { /* ignore */ }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) void fetchScheduled();
  }, [connected, fetchScheduled]);

  const handlePost = async () => {
    if (!compose.text.trim()) return;
    try {
      if (postNow) {
        await gateway.request('social.post', {
          platform: compose.platform,
          action: compose.action,
          text: compose.text,
          media_url: compose.mediaUrl || undefined,
          link: compose.link || undefined,
          title: compose.title || undefined,
        });
      } else {
        await gateway.request('social.schedule', {
          action: 'schedule',
          platform: compose.platform,
          post_type: compose.action,
          text: compose.text,
          media_url: compose.mediaUrl || undefined,
          scheduled_at: compose.scheduledAt,
        });
      }
      setCompose({ platform: 'twitter', action: 'post', text: '', mediaUrl: '', link: '', title: '', scheduledAt: '' });
      void fetchScheduled();
    } catch { /* ignore */ }
  };

  const handleCancel = async (postId: string) => {
    try {
      await gateway.request('social.schedule.cancel', { action: 'cancel', post_id: postId });
      void fetchScheduled();
    } catch { /* ignore */ }
  };

  const scheduled = posts.filter((p) => p.status === 'scheduled');
  const published = posts.filter((p) => p.status === 'published');
  const failed = posts.filter((p) => p.status === 'failed');

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 20,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Share2 size={20} color="#f472b6" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          letterSpacing: 3,
          color: '#f472b6',
          textShadow: '0 0 10px rgba(244,114,182,0.4)',
          margin: 0,
        }}>
          SOCIAL MEDIA
        </h1>
        <span style={{
          fontSize: 9,
          padding: '2px 8px',
          borderRadius: 3,
          background: 'rgba(244,114,182,0.08)',
          border: '1px solid rgba(244,114,182,0.3)',
          color: '#f472b6',
          fontFamily: 'var(--font-mono)',
        }}>
          {scheduled.length} scheduled / {published.length} published
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => void fetchScheduled()} style={{
            fontSize: 9, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
            borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer',
            fontFamily: 'var(--font-display)', letterSpacing: 1,
          }}>
            <RefreshCw size={10} /> REFRESH
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')} icon={<BarChart3 size={12} />} label="OVERVIEW" color="#f472b6" />
        <TabBtn active={tab === 'compose'} onClick={() => setTab('compose')} icon={<Plus size={12} />} label="COMPOSE" color="#f472b6" />
        <TabBtn active={tab === 'scheduled'} onClick={() => setTab('scheduled')} icon={<Calendar size={12} />} label={`SCHEDULED (${scheduled.length})`} color="#f472b6" />
        <TabBtn active={tab === 'analytics'} onClick={() => setTab('analytics')} icon={<BarChart3 size={12} />} label="ANALYTICS" color="#f472b6" />
      </div>

      {/* ── Overview Tab ── */}
      {tab === 'overview' && (
        <div>
          {/* Platform cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}>
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              const platformPosts = posts.filter((post) => post.platform === p.id);
              const platformScheduled = platformPosts.filter((post) => post.status === 'scheduled');
              const platformPublished = platformPosts.filter((post) => post.status === 'published');
              return (
                <div key={p.id} style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 8,
                  padding: 16,
                  borderTop: `3px solid ${p.color}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Icon size={18} color={p.color} />
                    <span style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 11,
                      letterSpacing: 1.5,
                      color: p.color,
                    }}>
                      {p.label.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <MiniStat label="Scheduled" value={String(platformScheduled.length)} color={p.color} />
                    <MiniStat label="Published" value={String(platformPublished.length)} color="var(--green-bright)" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 10,
          }}>
            <StatBox label="Total Posts" value={String(posts.length)} color="#f472b6" />
            <StatBox label="Scheduled" value={String(scheduled.length)} color="var(--cyan-bright)" />
            <StatBox label="Published" value={String(published.length)} color="var(--green-bright)" />
            <StatBox label="Failed" value={String(failed.length)} color="var(--red-bright)" />
            <StatBox label="Platforms" value={String(PLATFORMS.length)} color="var(--amber)" />
          </div>
        </div>
      )}

      {/* ── Compose Tab ── */}
      {tab === 'compose' && (
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid rgba(244,114,182,0.2)',
          borderRadius: 6,
          padding: 20,
        }}>
          <div style={{
            fontSize: 11, fontFamily: 'var(--font-display)', letterSpacing: 2,
            color: '#f472b6', marginBottom: 16,
          }}>
            COMPOSE POST
          </div>

          {/* Platform selector */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              PLATFORM
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[...PLATFORMS, { id: 'all' as const, label: 'All Platforms', icon: Share2, color: '#f472b6' }].map((p) => {
                const Icon = p.icon;
                const isActive = compose.platform === p.id;
                return (
                  <button key={p.id} onClick={() => setCompose({ ...compose, platform: p.id })} style={{
                    fontSize: 9, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5,
                    background: isActive ? `${p.color}15` : 'transparent',
                    border: `1px solid ${isActive ? p.color : 'var(--border-dim)'}`,
                    borderRadius: 4, color: isActive ? p.color : 'var(--text-muted)',
                    cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
                  }}>
                    <Icon size={12} /> {p.label.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Post type */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              CONTENT TYPE
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {POST_TYPES.map((type) => (
                <button key={type} onClick={() => setCompose({ ...compose, action: type })} style={{
                  fontSize: 9, padding: '3px 10px',
                  background: compose.action === type ? 'rgba(244,114,182,0.08)' : 'transparent',
                  border: `1px solid ${compose.action === type ? 'rgba(244,114,182,0.3)' : 'var(--border-dim)'}`,
                  borderRadius: 4, color: compose.action === type ? '#f472b6' : 'var(--text-muted)',
                  cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
                  textTransform: 'uppercase',
                }}>
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Text content */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
              CONTENT
            </label>
            <textarea
              value={compose.text}
              onChange={(e) => setCompose({ ...compose, text: e.target.value })}
              placeholder="Write your post content..."
              rows={4}
              style={{
                width: '100%', fontSize: 12, padding: '10px 12px', marginTop: 4,
                background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                borderRadius: 6, color: 'var(--text-white)', fontFamily: 'var(--font-mono)',
                resize: 'vertical', lineHeight: 1.6,
              }}
            />
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
              {compose.text.length} / 280
            </div>
          </div>

          {/* Optional fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <FormField label="MEDIA URL" value={compose.mediaUrl} onChange={(v) => setCompose({ ...compose, mediaUrl: v })} placeholder="https://..." />
            <FormField label="LINK" value={compose.link} onChange={(v) => setCompose({ ...compose, link: v })} placeholder="https://..." />
            <FormField label="TITLE (LinkedIn/TikTok)" value={compose.title} onChange={(v) => setCompose({ ...compose, title: v })} placeholder="Post title" />
          </div>

          {/* Post now / Schedule toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <button onClick={() => setPostNow(true)} style={{
              fontSize: 9, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
              background: postNow ? 'rgba(0,255,65,0.08)' : 'transparent',
              border: `1px solid ${postNow ? 'var(--green-dim)' : 'var(--border-dim)'}`,
              borderRadius: 4, color: postNow ? 'var(--green-bright)' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}>
              <Send size={10} /> POST NOW
            </button>
            <button onClick={() => setPostNow(false)} style={{
              fontSize: 9, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
              background: !postNow ? 'rgba(0,255,255,0.08)' : 'transparent',
              border: `1px solid ${!postNow ? 'var(--border-cyan)' : 'var(--border-dim)'}`,
              borderRadius: 4, color: !postNow ? 'var(--cyan-bright)' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}>
              <Clock size={10} /> SCHEDULE
            </button>
          </div>

          {!postNow && (
            <FormField
              label="SCHEDULED DATE (ISO)"
              value={compose.scheduledAt}
              onChange={(v) => setCompose({ ...compose, scheduledAt: v })}
              placeholder="2026-03-01T10:00:00Z"
            />
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={() => void handlePost()} style={{
              fontSize: 10, padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(244,114,182,0.12)', border: '1px solid rgba(244,114,182,0.4)',
              borderRadius: 6, color: '#f472b6', cursor: 'pointer',
              fontFamily: 'var(--font-display)', letterSpacing: 1, fontWeight: 700,
            }}>
              {postNow ? <><Send size={12} /> PUBLISH</> : <><Calendar size={12} /> SCHEDULE</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Scheduled Tab ── */}
      {tab === 'scheduled' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {loading && (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              Loading scheduled posts...
            </div>
          )}

          {!loading && scheduled.length === 0 && (
            <div style={{
              padding: 40, textAlign: 'center', color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)', fontSize: 12,
            }}>
              No scheduled posts. Go to Compose to create one.
            </div>
          )}

          {scheduled.sort((a, b) => a.scheduledAt - b.scheduledAt).map((post) => {
            const platform = PLATFORMS.find((p) => p.id === post.platform);
            const PlatformIcon = platform?.icon ?? Share2;
            const color = platform?.color ?? '#f472b6';

            return (
              <div key={post.id} style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                borderLeft: `3px solid ${color}`,
                borderRadius: 6,
                padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <PlatformIcon size={14} color={color} />
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 10, letterSpacing: 1,
                    color,
                  }}>
                    {post.platform.toUpperCase()}
                  </span>
                  <span style={{
                    fontSize: 8, padding: '1px 6px', borderRadius: 3,
                    background: 'rgba(0,255,255,0.06)', border: '1px solid var(--border-cyan)',
                    color: 'var(--cyan-bright)', fontFamily: 'var(--font-mono)',
                  }}>
                    {post.action}
                  </span>
                  <span style={{
                    fontSize: 8, padding: '1px 6px', borderRadius: 3,
                    background: 'var(--bg-tertiary)',
                    color: 'var(--amber)', fontFamily: 'var(--font-mono)',
                  }}>
                    <Clock size={8} style={{ display: 'inline', verticalAlign: -1, marginRight: 3 }} />
                    {new Date(post.scheduledAt).toLocaleString()}
                  </span>

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button onClick={() => void handleCancel(post.id)} title="Cancel" style={{
                      width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                      borderRadius: 4, color: 'var(--red-bright)', cursor: 'pointer', padding: 0,
                    }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                <div style={{
                  fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                  padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 4,
                  lineHeight: 1.5,
                }}>
                  {post.text}
                </div>

                {post.mediaUrl && (
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    Media: {post.mediaUrl}
                  </div>
                )}
              </div>
            );
          })}

          {/* Published history */}
          {published.length > 0 && (
            <>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2,
                color: 'var(--green-muted)', marginTop: 16, marginBottom: 8,
                paddingBottom: 6, borderBottom: '1px solid var(--border-primary)',
              }}>
                PUBLISHED ({published.length})
              </div>
              {published.slice(0, 20).map((post) => {
                const platform = PLATFORMS.find((p) => p.id === post.platform);
                const PlatformIcon = platform?.icon ?? Share2;
                return (
                  <div key={post.id} style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid rgba(0,255,65,0.1)',
                    borderRadius: 6,
                    padding: '8px 14px',
                    opacity: 0.7,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <CheckCircle size={12} color="var(--green-bright)" />
                    <PlatformIcon size={12} color={platform?.color} />
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {post.text}
                    </span>
                    <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {post.publishedAt ? new Date(post.publishedAt).toLocaleString() : ''}
                    </span>
                  </div>
                );
              })}
            </>
          )}

          {/* Failed posts */}
          {failed.length > 0 && (
            <>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2,
                color: 'var(--red-bright)', marginTop: 16, marginBottom: 8,
                paddingBottom: 6, borderBottom: '1px solid var(--border-primary)',
              }}>
                FAILED ({failed.length})
              </div>
              {failed.map((post) => (
                <div key={post.id} style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid rgba(255,100,100,0.15)',
                  borderRadius: 6,
                  padding: '8px 14px',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <XCircle size={12} color="var(--red-bright)" />
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', flex: 1 }}>
                    {post.text.slice(0, 60)}...
                  </span>
                  <span style={{ fontSize: 8, color: 'var(--red-bright)', fontFamily: 'var(--font-mono)' }}>
                    {post.error ?? 'Unknown error'}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Analytics Tab ── */}
      {tab === 'analytics' && (
        <div>
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 6,
            padding: 20,
            textAlign: 'center',
          }}>
            <BarChart3 size={32} color="var(--text-muted)" style={{ marginBottom: 8 }} />
            <div style={{
              fontSize: 12, fontFamily: 'var(--font-display)', letterSpacing: 2,
              color: 'var(--text-secondary)', marginBottom: 8,
            }}>
              ANALYTICS
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
              Analytics are fetched live by the agent using the <span style={{ color: '#f472b6' }}>social_analytics</span> tool.
              <br />
              Ask the agent: "Show me my Instagram analytics for this week"
              <br />
              or "Get Twitter engagement for my last 5 posts"
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
              marginTop: 20,
            }}>
              {PLATFORMS.map((p) => {
                const Icon = p.icon;
                return (
                  <div key={p.id} style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 6,
                    padding: 14,
                    textAlign: 'left',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <Icon size={14} color={p.color} />
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-display)', color: p.color, letterSpacing: 1 }}>
                        {p.label.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
                      {p.id === 'twitter' && 'Likes, retweets, replies, impressions, bookmarks'}
                      {p.id === 'instagram' && 'Reach, impressions, profile views, engagement'}
                      {p.id === 'facebook' && 'Page impressions, engaged users, followers'}
                      {p.id === 'linkedin' && 'Follower stats, share impressions, clicks'}
                      {p.id === 'tiktok' && 'Views, likes, comments, shares'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* === Sub-components === */

function TabBtn({ active, onClick, icon, label, color }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; color: string;
}) {
  return (
    <button onClick={onClick} style={{
      fontSize: 10, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 5,
      background: active ? `${color}12` : 'var(--bg-secondary)',
      border: `1px solid ${active ? `${color}44` : 'var(--border-primary)'}`,
      borderRadius: 4, color: active ? color : 'var(--text-muted)',
      cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
    }}>
      {icon} {label}
    </button>
  );
}

function FormField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', fontSize: 11, padding: '5px 10px', marginTop: 3,
          background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
          borderRadius: 4, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
        }}
      />
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 6,
      padding: '10px 12px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', color, fontWeight: 700 }}>
        {value}
      </div>
      <div style={{ fontSize: 8, fontFamily: 'var(--font-display)', color: 'var(--text-muted)', letterSpacing: 1, marginTop: 3 }}>
        {label.toUpperCase()}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontFamily: 'var(--font-display)', color, fontWeight: 700 }}>
        {value}
      </div>
      <div style={{ fontSize: 7, fontFamily: 'var(--font-display)', color: 'var(--text-muted)', letterSpacing: 1 }}>
        {label.toUpperCase()}
      </div>
    </div>
  );
}
