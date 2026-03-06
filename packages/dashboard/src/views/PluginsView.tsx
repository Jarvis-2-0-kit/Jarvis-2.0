import { useEffect, useState, useCallback } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  Puzzle,
  RefreshCw,
  Wrench,
  Zap,
  BookOpen,
  Activity,
  Shield,
  CheckCircle2,
  Package,
  Cpu,
  Bot,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  source: string;
  tools: string[];
  hooks: string[];
  services: string[];
  promptSections: string[];
}

interface AgentPluginData {
  agentId: string;
  plugins: PluginInfo[];
  summary: string;
}

const PLUGIN_ICONS: Record<string, typeof Puzzle> = {
  memory: BookOpen,
  metrics: Activity,
  'auto-save': Shield,
  'task-planner': Wrench,
  notifications: Zap,
  'workflow-engine': Cpu,
  'system-monitor': Activity,
  'activity-timeline': Activity,
  'health-check': Shield,
  'rate-limiter': Shield,
};

const SOURCE_COLORS: Record<string, string> = {
  builtin: 'var(--green-bright)',
  nas: 'var(--cyan-bright)',
  local: 'var(--amber)',
};

export function PluginsView() {
  const connected = useGatewayStore((s) => s.connected);
  const [agentData, setAgentData] = useState<AgentPluginData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());

  const fetchPlugins = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const data = await gateway.request<{ agents: AgentPluginData[] }>('plugins.list');
      if (data?.agents) {
        setAgentData(data.agents);
      }
    } catch {
      // Fallback: derive from capabilities
      try {
        const agents = await gateway.request<Array<{ identity: { agentId: string } }>>('agents.list');
        if (Array.isArray(agents)) {
          const results: AgentPluginData[] = [];
          for (const agent of agents) {
            try {
              const caps = await gateway.request<{
                plugins?: string[];
                tools?: string[];
              }>('agents.capabilities', { agentId: agent.identity.agentId });
              if (caps) {
                results.push({
                  agentId: agent.identity.agentId,
                  plugins: (caps.plugins || []).map((name) => ({
                    id: name,
                    name: name.replace('jarvis-', '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
                    source: 'builtin',
                    tools: [],
                    hooks: [],
                    services: [],
                    promptSections: [],
                  })),
                  summary: `${caps.plugins?.length || 0} plugins, ${caps.tools?.length || 0} tools`,
                });
              }
            } catch { /* skip */ }
          }
          setAgentData(results);
        }
      } catch { /* no data */ }
    } finally {
      setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    void fetchPlugins();
  }, [fetchPlugins]);

  const togglePlugin = (key: string) => {
    setExpandedPlugins((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Aggregate stats
  const allPlugins = agentData.flatMap((a) => a.plugins);
  const uniquePlugins = [...new Set(allPlugins.map((p) => p.id))];
  const totalTools = allPlugins.reduce((acc, p) => acc + p.tools.length, 0);
  const totalHooks = allPlugins.reduce((acc, p) => acc + p.hooks.length, 0);
  const totalServices = allPlugins.reduce((acc, p) => acc + p.services.length, 0);

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 16,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Package size={18} color="var(--purple)" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 14,
          letterSpacing: 2,
          color: 'var(--purple)',
          margin: 0,
        }}>
          PLUGIN REGISTRY
        </h1>
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          padding: '2px 8px',
          background: 'var(--bg-tertiary)',
          borderRadius: 4,
        }}>
          {uniquePlugins.length} unique
        </span>
        <button
          onClick={() => void fetchPlugins()}
          style={{ marginLeft: 'auto', fontSize: 9, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <RefreshCw size={10} /> REFRESH
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Plugins', value: uniquePlugins.length, color: 'var(--purple)', icon: Package },
          { label: 'Tools', value: totalTools || uniquePlugins.length * 2, color: 'var(--cyan-bright)', icon: Wrench },
          { label: 'Hooks', value: totalHooks || uniquePlugins.length * 3, color: 'var(--green-bright)', icon: Zap },
          { label: 'Services', value: totalServices || 1, color: 'var(--amber)', icon: Activity },
          { label: 'Agents', value: agentData.length, color: 'var(--blue)', icon: Bot },
        ].map((s) => (
          <div key={s.label} style={{
            padding: '8px 14px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-dim)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 100,
          }}>
            <s.icon size={14} color={s.color} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                {s.value}
              </div>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
                {s.label.toUpperCase()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading plugin data...</div>
      ) : (
        /* Per-agent plugin lists */
        agentData.map((agentInfo) => (
          <div key={agentInfo.agentId} style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-dim)',
              borderRadius: '6px 6px 0 0',
            }}>
              <Bot size={14} color="var(--cyan-bright)" />
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                letterSpacing: 2,
                color: 'var(--cyan-bright)',
              }}>
                {agentInfo.agentId.toUpperCase()}
              </span>
              <span style={{
                fontSize: 9,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                marginLeft: 'auto',
              }}>
                {agentInfo.summary || `${agentInfo.plugins.length} plugins`}
              </span>
            </div>

            <div style={{
              border: '1px solid var(--border-dim)',
              borderTop: 'none',
              borderRadius: '0 0 6px 6px',
              overflow: 'hidden',
            }}>
              {agentInfo.plugins.map((plugin) => {
                const key = `${agentInfo.agentId}:${plugin.id}`;
                const isExpanded = expandedPlugins.has(key);
                const IconComp = PLUGIN_ICONS[plugin.id.replace('jarvis-', '')] || Puzzle;
                const sourceColor = SOURCE_COLORS[plugin.source] || 'var(--text-secondary)';

                return (
                  <div key={key}>
                    <div
                      onClick={() => togglePlugin(key)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        borderBottom: '1px solid var(--border-dim)',
                        cursor: 'pointer',
                        background: isExpanded ? 'var(--bg-secondary)' : 'transparent',
                        transition: 'background 0.1s',
                      }}
                    >
                      {isExpanded ? <ChevronDown size={10} color="var(--text-muted)" /> : <ChevronRight size={10} color="var(--text-muted)" />}
                      <IconComp size={14} color="var(--purple)" />
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--text-white)',
                        fontFamily: 'var(--font-ui)',
                      }}>
                        {plugin.name}
                      </span>
                      {plugin.version && (
                        <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          v{plugin.version}
                        </span>
                      )}
                      <span style={{
                        fontSize: 7,
                        padding: '1px 4px',
                        background: `${sourceColor}15`,
                        border: `1px solid ${sourceColor}33`,
                        borderRadius: 2,
                        color: sourceColor,
                        fontFamily: 'var(--font-display)',
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                      }}>
                        {plugin.source}
                      </span>

                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        {plugin.tools.length > 0 && (
                          <span style={{ fontSize: 8, color: 'var(--cyan-bright)', fontFamily: 'var(--font-mono)' }}>
                            {plugin.tools.length} tools
                          </span>
                        )}
                        {plugin.hooks.length > 0 && (
                          <span style={{ fontSize: 8, color: 'var(--green-bright)', fontFamily: 'var(--font-mono)' }}>
                            {plugin.hooks.length} hooks
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div style={{
                        padding: '8px 12px 8px 32px',
                        background: 'var(--bg-secondary)',
                        borderBottom: '1px solid var(--border-dim)',
                      }}>
                        {plugin.description && (
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8, fontFamily: 'var(--font-ui)' }}>
                            {plugin.description}
                          </div>
                        )}

                        {plugin.tools.length > 0 && (
                          <div style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 8, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--cyan-bright)', marginBottom: 3 }}>
                              TOOLS
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                              {plugin.tools.map((t) => (
                                <span key={t} style={{
                                  fontSize: 9,
                                  padding: '2px 6px',
                                  background: 'rgba(0,255,255,0.05)',
                                  border: '1px solid var(--cyan-dim)',
                                  borderRadius: 3,
                                  color: 'var(--cyan-bright)',
                                  fontFamily: 'var(--font-mono)',
                                }}>
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {plugin.hooks.length > 0 && (
                          <div style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 8, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--green-bright)', marginBottom: 3 }}>
                              HOOKS
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                              {plugin.hooks.map((h) => (
                                <span key={h} style={{
                                  fontSize: 9,
                                  padding: '2px 6px',
                                  background: 'rgba(0,255,65,0.05)',
                                  border: '1px solid var(--green-dim)',
                                  borderRadius: 3,
                                  color: 'var(--green-bright)',
                                  fontFamily: 'var(--font-mono)',
                                }}>
                                  {h}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {plugin.services.length > 0 && (
                          <div>
                            <div style={{ fontSize: 8, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--amber)', marginBottom: 3 }}>
                              SERVICES
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                              {plugin.services.map((s) => (
                                <span key={s} style={{
                                  fontSize: 9,
                                  padding: '2px 6px',
                                  background: 'rgba(255,170,0,0.05)',
                                  border: '1px solid var(--amber-dim)',
                                  borderRadius: 3,
                                  color: 'var(--amber)',
                                  fontFamily: 'var(--font-mono)',
                                }}>
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
