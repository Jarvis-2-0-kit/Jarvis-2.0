import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useGatewayStore } from './store/gateway-store.js';
import { DashboardLayout } from './layouts/DashboardLayout.js';
import { Sidebar } from './components/nav/Sidebar.js';
import { ToastContainer } from './components/toast/ToastContainer.js';
import { useGatewayToasts } from './hooks/useGatewayToasts.js';
import { OverviewView } from './views/OverviewView.js';
import { SessionsView } from './views/SessionsView.js';
import { TasksView } from './views/TasksView.js';
import { UsageView } from './views/UsageView.js';
import { LogsView } from './views/LogsView.js';
import { ConfigView } from './views/ConfigView.js';
import { DebugView } from './views/DebugView.js';
import { IntegrationsView } from './views/IntegrationsView.js';
import { WorkflowsView } from './views/WorkflowsView.js';
import { NotificationsView } from './views/NotificationsView.js';
import { ApiKeysView } from './views/ApiKeysView.js';
import { SchedulerView } from './views/SchedulerView.js';
import { EnvironmentView } from './views/EnvironmentView.js';
import { TimelineView } from './views/TimelineView.js';
import { AgentsView } from './views/AgentsView.js';
import { PluginsView } from './views/PluginsView.js';
import { VoiceView } from './views/VoiceView.js';
import { FileManagerView } from './views/FileManagerView.js';
import { WhatsAppView } from './views/WhatsAppView.js';
import { TelegramView } from './views/TelegramView.js';
import { DiscordView } from './views/DiscordView.js';
import { ChannelsView } from './views/ChannelsView.js';
import { SkillsView } from './views/SkillsView.js';
import { ProvidersView } from './views/ProvidersView.js';
import { MemoryView } from './views/MemoryView.js';
import { CommandPalette } from './components/command-palette/CommandPalette.js';

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
            <Routes>
              <Route path="/" element={<DashboardLayout />} />
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
              <Route path="/skills" element={<SkillsView />} />
              <Route path="/providers" element={<ProvidersView />} />
              <Route path="/memory" element={<MemoryView />} />
              <Route path="/config" element={<ConfigView />} />
              <Route path="/debug" element={<DebugView />} />
            </Routes>
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

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
