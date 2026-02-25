import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Activity,
  Bot,
  ScrollText,
  ListTodo,
  Coins,
  FileText,
  Settings,
  Bug,
  Puzzle,
  GitBranch,
  Bell,
  Key,
  Clock,
  Variable,
  GitCommitHorizontal,
  Package,
  AudioWaveform,
  HardDrive,
  Radio,
  MessageCircle,
  Send,
  Hash,
  Sparkles,
  Cpu,
  Brain,
  ShieldCheck,
  Server,
  Smartphone,
  Monitor,
  MessagesSquare,
  Network,
  Grid3X3,
  X,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}

interface NavGroup {
  label: string;
  color: string;
  items: NavItem[];
}

// ─── Pinned (always in sidebar) ─────────────────────

const PINNED: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/chat', icon: MessageCircle, label: 'Chat' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/tasks', icon: ListTodo, label: 'Tasks' },
];

// ─── Full-screen menu groups ────────────────────────

const MENU_GROUPS: NavGroup[] = [
  {
    label: 'Agents & Workflow',
    color: 'var(--cyan-bright)',
    items: [
      { to: '/agents', icon: Bot, label: 'Agents' },
      { to: '/tasks', icon: ListTodo, label: 'Tasks' },
      { to: '/sessions', icon: ScrollText, label: 'Sessions' },
      { to: '/workflows', icon: GitBranch, label: 'Workflows' },
      { to: '/timeline', icon: GitCommitHorizontal, label: 'Timeline' },
      { to: '/orchestrator', icon: Network, label: 'Orchestrator' },
      { to: '/approvals', icon: ShieldCheck, label: 'Approvals' },
      { to: '/scheduler', icon: Clock, label: 'Scheduler' },
    ],
  },
  {
    label: 'Communication',
    color: '#c084fc',
    items: [
      { to: '/chat', icon: MessageCircle, label: 'Chat' },
      { to: '/channels', icon: Radio, label: 'Channels' },
      { to: '/whatsapp', icon: Smartphone, label: 'WhatsApp' },
      { to: '/telegram', icon: Send, label: 'Telegram' },
      { to: '/discord', icon: Hash, label: 'Discord' },
      { to: '/slack', icon: MessagesSquare, label: 'Slack' },
      { to: '/imessage', icon: Monitor, label: 'iMessage' },
    ],
  },
  {
    label: 'AI & Knowledge',
    color: '#f0c040',
    items: [
      { to: '/voice', icon: AudioWaveform, label: 'Voice' },
      { to: '/memory', icon: Brain, label: 'Memory' },
      { to: '/skills', icon: Sparkles, label: 'Skills' },
      { to: '/providers', icon: Cpu, label: 'Models' },
      { to: '/plugins', icon: Package, label: 'Plugins' },
    ],
  },
  {
    label: 'Monitoring',
    color: 'var(--green-bright)',
    items: [
      { to: '/overview', icon: Activity, label: 'Overview' },
      { to: '/usage', icon: Coins, label: 'Usage' },
      { to: '/logs', icon: FileText, label: 'Logs' },
      { to: '/notifications', icon: Bell, label: 'Notifications' },
      { to: '/instances', icon: Server, label: 'Instances' },
    ],
  },
  {
    label: 'System',
    color: 'var(--text-secondary)',
    items: [
      { to: '/integrations', icon: Puzzle, label: 'Integrations' },
      { to: '/api-keys', icon: Key, label: 'API Keys' },
      { to: '/files', icon: HardDrive, label: 'Files' },
      { to: '/environment', icon: Variable, label: 'Environment' },
      { to: '/config', icon: Settings, label: 'Config' },
      { to: '/debug', icon: Bug, label: 'Debug' },
    ],
  },
];

// ─── Sidebar ────────────────────────────────────────

export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [menuOpen]);

  return (
    <>
      {/* ── Sidebar rail ── */}
      <nav style={{
        width: 56, minWidth: 56, height: '100%',
        background: 'linear-gradient(180deg, #0a0e14 0%, #080b10 100%)',
        borderRight: '1px solid var(--border-primary)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 6, paddingBottom: 6, gap: 2,
        zIndex: 10, flexShrink: 0,
      }}>
        {/* Pinned nav items */}
        {PINNED.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            style={({ isActive }) => ({
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              width: 44, height: 42, flexShrink: 0, borderRadius: 8, textDecoration: 'none',
              color: isActive ? 'var(--green-bright)' : 'var(--text-muted)',
              background: isActive ? 'rgba(0,255,65,0.08)' : 'transparent',
              border: isActive ? '1px solid rgba(0,255,65,0.15)' : '1px solid transparent',
              transition: 'all 0.15s ease', cursor: 'pointer',
            })}
            title={item.label}
          >
            <item.icon size={18} strokeWidth={1.5} />
            <span style={{
              fontSize: 7, fontFamily: 'var(--font-display)',
              letterSpacing: 0.5, marginTop: 2, textTransform: 'uppercase',
            }}>
              {item.label}
            </span>
          </NavLink>
        ))}

        {/* Separator */}
        <div style={{ width: 28, height: 1, background: 'var(--border-primary)', margin: '4px 0' }} />

        {/* Apps launcher button */}
        <button
          onClick={() => setMenuOpen(true)}
          title="All Apps"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 42, flexShrink: 0, borderRadius: 8,
            background: menuOpen ? 'rgba(0,255,65,0.1)' : 'transparent',
            border: menuOpen ? '1px solid rgba(0,255,65,0.15)' : '1px solid transparent',
            color: menuOpen ? 'var(--green-bright)' : 'var(--text-muted)',
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          <Grid3X3 size={18} strokeWidth={1.5} />
          <span style={{
            fontSize: 7, fontFamily: 'var(--font-display)',
            letterSpacing: 0.5, marginTop: 2, textTransform: 'uppercase',
          }}>
            Apps
          </span>
        </button>
      </nav>

      {/* ── Fullscreen overlay menu ── */}
      {menuOpen && <AppLauncher onClose={() => setMenuOpen(false)} />}
    </>
  );
}

// ─── App Launcher (fullscreen) ──────────────────────

function AppLauncher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');

  // Animate in
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 150);
  }, [onClose]);

  const handleNav = (to: string) => {
    navigate(to);
    handleClose();
  };

  // Flatten all items for search
  const allItems = MENU_GROUPS.flatMap((g) =>
    g.items.map((item) => ({ ...item, groupLabel: g.label, groupColor: g.color }))
  );

  const filteredGroups = search.trim()
    ? [{
        label: 'Search Results',
        color: 'var(--cyan-bright)',
        items: allItems.filter((i) =>
          i.label.toLowerCase().includes(search.toLowerCase()) ||
          i.groupLabel.toLowerCase().includes(search.toLowerCase())
        ),
      }]
    : MENU_GROUPS;

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: visible ? 'rgba(4,6,10,0.92)' : 'rgba(4,6,10,0)',
        backdropFilter: visible ? 'blur(20px)' : 'blur(0px)',
        WebkitBackdropFilter: visible ? 'blur(20px)' : 'blur(0px)',
        transition: 'all 0.2s ease',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        overflow: 'auto',
      }}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        style={{
          position: 'fixed', top: 16, right: 20, zIndex: 1001,
          width: 36, height: 36, borderRadius: 18,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--text-muted)',
          transition: 'all 0.15s',
        }}
      >
        <X size={18} />
      </button>

      {/* Content container (don't close on click inside) */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 1200, padding: '60px 48px 40px',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.98)',
          transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Search */}
        <div style={{
          display: 'flex', justifyContent: 'center', marginBottom: 40,
        }}>
          <div style={{
            width: '100%', maxWidth: 520, position: 'relative',
          }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search apps..."
              autoFocus
              style={{
                width: '100%', padding: '14px 24px',
                fontSize: 16, fontFamily: 'var(--font-ui)', fontWeight: 500,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, color: 'var(--text-white)', outline: 'none',
                letterSpacing: 0.3,
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(0,255,65,0.3)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
            />
          </div>
        </div>

        {/* Groups */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
          {filteredGroups.map((group) => (
            <div key={group.label}>
              {/* Group header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginBottom: 18, paddingLeft: 4,
              }}>
                <div style={{
                  width: 4, height: 18, borderRadius: 2,
                  background: group.color,
                  boxShadow: `0 0 8px ${group.color}44`,
                }} />
                <span style={{
                  fontFamily: 'var(--font-display)', fontSize: 14,
                  fontWeight: 700, letterSpacing: 3,
                  color: group.color, textTransform: 'uppercase',
                }}>
                  {group.label}
                </span>
              </div>

              {/* Items grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: 12,
              }}>
                {group.items.map((item) => {
                  const isActive = item.end
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to);
                  return (
                    <AppTile
                      key={item.to}
                      item={item}
                      active={isActive}
                      accentColor={group.color}
                      onClick={() => handleNav(item.to)}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {filteredGroups.length === 0 || (filteredGroups.length === 1 && filteredGroups[0].items.length === 0) ? (
            <div style={{
              textAlign: 'center', padding: 40,
              color: 'var(--text-muted)', fontSize: 13,
              fontFamily: 'var(--font-ui)',
            }}>
              No apps found for "{search}"
            </div>
          ) : null}
        </div>

        {/* Keyboard hint */}
        <div style={{
          textAlign: 'center', marginTop: 40,
          fontSize: 10, color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', letterSpacing: 0.5,
        }}>
          <kbd style={{
            padding: '2px 6px', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4,
            fontSize: 9,
          }}>ESC</kbd>
          {' '}to close
        </div>
      </div>
    </div>
  );
}

// ─── App Tile ───────────────────────────────────────

function AppTile({ item, active, accentColor, onClick }: {
  item: NavItem; active: boolean; accentColor: string; onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: '20px 12px',
        borderRadius: 16, cursor: 'pointer',
        background: active
          ? `${accentColor}11`
          : hover
            ? 'rgba(255,255,255,0.04)'
            : 'rgba(255,255,255,0.015)',
        border: active
          ? `1px solid ${accentColor}33`
          : hover
            ? '1px solid rgba(255,255,255,0.06)'
            : '1px solid rgba(255,255,255,0.02)',
        color: active ? accentColor : hover ? 'var(--text-white)' : 'var(--text-secondary)',
        transition: 'all 0.15s ease',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active
          ? `${accentColor}15`
          : 'rgba(255,255,255,0.03)',
        border: active
          ? `1px solid ${accentColor}22`
          : '1px solid rgba(255,255,255,0.04)',
        transition: 'all 0.15s ease',
        boxShadow: active ? `0 0 12px ${accentColor}15` : 'none',
      }}>
        <Icon size={28} strokeWidth={1.5} />
      </div>
      <span style={{
        fontSize: 12, fontFamily: 'var(--font-ui)',
        fontWeight: 600, letterSpacing: 0.3,
        textAlign: 'center', lineHeight: 1.2,
      }}>
        {item.label}
      </span>
    </button>
  );
}
