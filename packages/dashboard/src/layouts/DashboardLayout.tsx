import { useState, useEffect, useCallback } from 'react';
import { AgentPanel } from '../components/agents/AgentPanel.js';
import { ConsoleViewer } from '../components/console/ConsoleViewer.js';
import { VNCGrid } from '../components/vnc/VNCGrid.js';
import { ChatPanel } from '../components/chat/ChatPanel.js';
import { TaskList } from '../components/tasks/TaskList.js';
import { MetricsPanel } from '../components/metrics/MetricsPanel.js';
import { SettingsPanel } from '../components/settings/SettingsPanel.js';
import styles from './DashboardLayout.module.css';

export function DashboardLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ESC key handler
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setSettingsOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className={styles.root}>
      {/* Settings button */}
      <div style={{
        position: 'absolute',
        top: 6,
        right: 8,
        zIndex: 20,
      }}>
        <button
          onClick={() => setSettingsOpen(true)}
          style={{
            fontSize: 10,
            padding: '3px 10px',
            border: '1px solid var(--border-dim)',
            color: 'var(--text-muted)',
            letterSpacing: 1,
          }}
        >
          SETTINGS
        </button>
      </div>

      {/* Settings Modal */}
      <SettingsPanel visible={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Main 3-Panel Layout */}
      <main className={styles.main}>
        {/* Left Panel - Agents + Console */}
        <section className={styles.leftPanel}>
          <div className={styles.leftTop}>
            <AgentPanel />
          </div>
          <div className={styles.leftBottom}>
            <ConsoleViewer />
          </div>
        </section>

        {/* Center Panel - VNC */}
        <section className={styles.centerPanel}>
          <VNCGrid />
        </section>

        {/* Right Panel - Chat + Tasks + Metrics */}
        <section className={styles.rightPanel}>
          <div className={styles.rightChat}>
            <ChatPanel />
          </div>
          <div className={styles.rightTasks}>
            <TaskList />
          </div>
          <div className={styles.rightMetrics}>
            <MetricsPanel />
          </div>
        </section>
      </main>
    </div>
  );
}
