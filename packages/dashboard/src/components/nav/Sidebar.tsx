import { NavLink } from 'react-router-dom';
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
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/overview', icon: Activity, label: 'Overview' },
  { to: '/voice', icon: AudioWaveform, label: 'Voice' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/sessions', icon: ScrollText, label: 'Sessions' },
  { to: '/tasks', icon: ListTodo, label: 'Tasks' },
  { to: '/workflows', icon: GitBranch, label: 'Workflows' },
  { to: '/timeline', icon: GitCommitHorizontal, label: 'Timeline' },
  { to: '/usage', icon: Coins, label: 'Usage' },
  { to: '/logs', icon: FileText, label: 'Logs' },
  { to: '/channels', icon: Radio, label: 'Channels' },
  { to: '/whatsapp', icon: MessageCircle, label: 'WhatsApp' },
  { to: '/telegram', icon: Send, label: 'Telegram' },
  { to: '/discord', icon: Hash, label: 'Discord' },
  { to: '/integrations', icon: Puzzle, label: 'Integrate' },
  { to: '/notifications', icon: Bell, label: 'Notify' },
  { to: '/api-keys', icon: Key, label: 'Keys' },
  { to: '/scheduler', icon: Clock, label: 'Scheduler' },
  { to: '/memory', icon: Brain, label: 'Memory' },
  { to: '/skills', icon: Sparkles, label: 'Skills' },
  { to: '/providers', icon: Cpu, label: 'Models' },
  { to: '/plugins', icon: Package, label: 'Plugins' },
  { to: '/files', icon: HardDrive, label: 'Files' },
  { to: '/environment', icon: Variable, label: 'Env Vars' },
  { to: '/config', icon: Settings, label: 'Config' },
  { to: '/debug', icon: Bug, label: 'Debug' },
];

export function Sidebar() {
  return (
    <nav style={{
      width: 56,
      minWidth: 56,
      height: '100%',
      background: 'linear-gradient(180deg, #0a0e14 0%, #080b10 100%)',
      borderRight: '1px solid var(--border-primary)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 6,
      paddingBottom: 6,
      gap: 1,
      zIndex: 10,
      flexShrink: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
    }}>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 40,
            flexShrink: 0,
            borderRadius: 6,
            textDecoration: 'none',
            color: isActive ? 'var(--green-bright)' : 'var(--text-muted)',
            background: isActive ? 'rgba(0,255,65,0.08)' : 'transparent',
            border: isActive ? '1px solid var(--border-primary)' : '1px solid transparent',
            transition: 'all 0.15s ease',
            cursor: 'pointer',
            position: 'relative',
          })}
          title={item.label}
        >
          <item.icon size={18} strokeWidth={1.5} />
          <span style={{
            fontSize: 7,
            fontFamily: 'var(--font-display)',
            letterSpacing: 0.5,
            marginTop: 2,
            textTransform: 'uppercase',
          }}>
            {item.label}
          </span>
        </NavLink>
      ))}
    </nav>
  );
}
