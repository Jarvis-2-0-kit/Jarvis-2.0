import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useGatewayStore } from './store/gateway-store.js';
import { DashboardLayout } from './layouts/DashboardLayout.js';
import { Sidebar } from './components/nav/Sidebar.js';
import { ToastContainer } from './components/toast/ToastContainer.js';
import { useGatewayToasts } from './hooks/useGatewayToasts.js';
import { CommandPalette } from './components/command-palette/CommandPalette.js';
import { formatUptime } from './utils/formatters.js';

// Lazy-loaded views — reduces initial bundle size
const OverviewView = lazy(() => import('./views/OverviewView.js').then((m) => ({ default: m.OverviewView })));
const ChatView = lazy(() => import('./views/ChatView.js').then((m) => ({ default: m.ChatView })));
const AgentsView = lazy(() => import('./views/AgentsView.js').then((m) => ({ default: m.AgentsView })));
const SessionsView = lazy(() => import('./views/SessionsView.js').then((m) => ({ default: m.SessionsView })));
const TasksView = lazy(() => import('./views/TasksView.js').then((m) => ({ default: m.TasksView })));
const UsageView = lazy(() => import('./views/UsageView.js').then((m) => ({ default: m.UsageView })));
const LogsView = lazy(() => import('./views/LogsView.js').then((m) => ({ default: m.LogsView })));
const WorkflowsView = lazy(() => import('./views/WorkflowsView.js').then((m) => ({ default: m.WorkflowsView })));
const IntegrationsView = lazy(() => import('./views/IntegrationsView.js').then((m) => ({ default: m.IntegrationsView })));
const NotificationsView = lazy(() => import('./views/NotificationsView.js').then((m) => ({ default: m.NotificationsView })));
const ApiKeysView = lazy(() => import('./views/ApiKeysView.js').then((m) => ({ default: m.ApiKeysView })));
const SchedulerView = lazy(() => import('./views/SchedulerView.js').then((m) => ({ default: m.SchedulerView })));
const EnvironmentView = lazy(() => import('./views/EnvironmentView.js').then((m) => ({ default: m.EnvironmentView })));
const TimelineView = lazy(() => import('./views/TimelineView.js').then((m) => ({ default: m.TimelineView })));
const PluginsView = lazy(() => import('./views/PluginsView.js').then((m) => ({ default: m.PluginsView })));
const VoiceView = lazy(() => import('./views/VoiceView.js').then((m) => ({ default: m.VoiceView })));
const FileManagerView = lazy(() => import('./views/FileManagerView.js').then((m) => ({ default: m.FileManagerView })));
const ChannelsView = lazy(() => import('./views/ChannelsView.js').then((m) => ({ default: m.ChannelsView })));
const WhatsAppView = lazy(() => import('./views/WhatsAppView.js').then((m) => ({ default: m.WhatsAppView })));
const TelegramView = lazy(() => import('./views/TelegramView.js').then((m) => ({ default: m.TelegramView })));
const DiscordView = lazy(() => import('./views/DiscordView.js').then((m) => ({ default: m.DiscordView })));
const SlackView = lazy(() => import('./views/SlackView.js').then((m) => ({ default: m.SlackView })));
const IMessageView = lazy(() => import('./views/IMessageView.js').then((m) => ({ default: m.IMessageView })));
const SkillsView = lazy(() => import('./views/SkillsView.js').then((m) => ({ default: m.SkillsView })));
const ProvidersView = lazy(() => import('./views/ProvidersView.js').then((m) => ({ default: m.ProvidersView })));
const MemoryView = lazy(() => import('./views/MemoryView.js').then((m) => ({ default: m.MemoryView })));
const ApprovalsView = lazy(() => import('./views/ApprovalsView.js').then((m) => ({ default: m.ApprovalsView })));
const InstancesView = lazy(() => import('./views/InstancesView.js').then((m) => ({ default: m.InstancesView })));
const OrchestratorView = lazy(() => import('./views/OrchestratorView.js').then((m) => ({ default: m.OrchestratorView })));
const ConfigView = lazy(() => import('./views/ConfigView.js').then((m) => ({ default: m.ConfigView })));
const DebugView = lazy(() => import('./views/DebugView.js').then((m) => ({ default: m.DebugView })));

export function App() {
  const init = useGatewayStore((s) => s.init);
  useGatewayToasts();

  useEffect(() => {
    init();
  }, [init]);

  return (
    <BrowserRouter>
      <div className="scanline-overlay grid-bg" style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Top header bar - always visible */}
        <AppHeader />

        {/* Main area: sidebar + content */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <Sidebar />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Suspense fallback={<ViewLoader />}>
              <Routes>
                <Route path="/" element={<DashboardLayout />} />
                <Route path="/chat" element={<ChatView />} />
                <Route path="/overview" element={<OverviewView />} />
                <Route path="/agents" element={<AgentsView />} />
                <Route path="/sessions" element={<SessionsView />} />
                <Route path="/tasks" element={<TasksView />} />
                <Route path="/usage" element={<UsageView />} />
                <Route path="/logs" element={<LogsView />} />
                <Route path="/workflows" element={<WorkflowsView />} />
                <Route path="/integrations" element={<IntegrationsView />} />
                <Route path="/notifications" element={<NotificationsView />} />
                <Route path="/api-keys" element={<ApiKeysView />} />
                <Route path="/scheduler" element={<SchedulerView />} />
                <Route path="/environment" element={<EnvironmentView />} />
                <Route path="/timeline" element={<TimelineView />} />
                <Route path="/plugins" element={<PluginsView />} />
                <Route path="/voice" element={<VoiceView />} />
                <Route path="/files" element={<FileManagerView />} />
                <Route path="/channels" element={<ChannelsView />} />
                <Route path="/whatsapp" element={<WhatsAppView />} />
                <Route path="/telegram" element={<TelegramView />} />
                <Route path="/discord" element={<DiscordView />} />
                <Route path="/slack" element={<SlackView />} />
                <Route path="/imessage" element={<IMessageView />} />
                <Route path="/skills" element={<SkillsView />} />
                <Route path="/providers" element={<ProvidersView />} />
                <Route path="/memory" element={<MemoryView />} />
                <Route path="/approvals" element={<ApprovalsView />} />
                <Route path="/instances" element={<InstancesView />} />
                <Route path="/orchestrator" element={<OrchestratorView />} />
                <Route path="/config" element={<ConfigView />} />
                <Route path="/debug" element={<DebugView />} />
              </Routes>
            </Suspense>
          </div>
        </div>

        {/* Toast notifications overlay */}
        <ToastContainer />

        {/* Command palette (Ctrl+K / Cmd+K) */}
        <CommandPalette />
      </div>
    </BrowserRouter>
  );
}

/** Suspense fallback for lazy-loaded views */
function ViewLoader() {
  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-display)',
      letterSpacing: 2, gap: 8,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', border: '2px solid var(--green-dim)',
        borderTopColor: 'var(--green-bright)', animation: 'spin 0.6s linear infinite',
        display: 'inline-block',
      }} />
      LOADING
    </div>
  );
}

/** Shared top header bar */
function AppHeader() {
  const connected = useGatewayStore((s) => s.connected);
  const health = useGatewayStore((s) => s.health);

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 48,
      padding: '0 16px',
      background: 'linear-gradient(180deg, #0d1117 0%, #0a0e14 100%)',
      borderBottom: '1px solid var(--border-primary)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          fontWeight: 800,
          letterSpacing: 4,
          color: 'var(--green-bright)',
          textShadow: 'var(--glow-green-strong)',
        }}>
          JARVIS
        </span>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          fontWeight: 400,
          color: 'var(--cyan-bright)',
          textShadow: 'var(--glow-cyan)',
        }}>
          2.0
        </span>
      </div>

      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 3,
          color: 'var(--green-muted)',
        }}>
          // COMMAND CENTER
        </span>
        <kbd style={{
          fontSize: 8,
          padding: '2px 6px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-dim)',
          borderRadius: 3,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          cursor: 'pointer',
        }}>
          ⌘K
        </kbd>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-ui)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 1,
          color: connected ? 'var(--green-primary)' : 'var(--text-muted)',
        }}>
          <span style={{
            width: 6, height: 6,
            background: connected ? '#00ff41' : '#484f58',
            boxShadow: connected ? 'var(--glow-green)' : 'none',
            borderRadius: '50%',
            display: 'inline-block',
          }} />
          {connected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
        {health && (
          <span style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-ui)',
            letterSpacing: 1,
          }}>
            UP {formatUptime(health.uptime)}
          </span>
        )}
      </div>
    </header>
  );
}

