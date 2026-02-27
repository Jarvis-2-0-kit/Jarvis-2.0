import { useEffect, useState, useCallback, useRef } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  Activity,
  Server,
  Database,
  HardDrive,
  Users,
  Cpu,
  Wifi,
  MemoryStick,
  Network,
  Gauge,
  Thermometer,
  RefreshCw,
  Monitor,
} from 'lucide-react';
import { formatUptime, formatUptimeShort, formatBytes, formatBytesRate } from '../utils/formatters.js';

interface DetailedHealth {
  status: string;
  version: string;
  uptime: number;
  infrastructure: {
    nats: boolean;
    redis: boolean;
    nas: { mounted: boolean; path: string };
  };
  agents: Array<{
    id: string;
    role: string;
    status: string;
    alive: boolean;
    activeTask: string | null;
    lastHeartbeat?: number;
  }>;
  dashboard: { connectedClients: number };
}

interface SystemMetrics {
  cpu: {
    cores: number;
    model: string;
    speed: number;
    load: number[];
    usage: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  };
  disk: Array<{
    filesystem: string;
    size: string;
    used: string;
    available: string;
    usedPercent: number;
    mount: string;
  }>;
  network: Record<string, { rx: number; tx: number; ip: string }>;
  os: {
    hostname: string;
    platform: string;
    uptime: number;
    arch: string;
  };
  timestamp: number;
}

interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  user: string;
}

export function OverviewView() {
  const connected = useGatewayStore((s) => s.connected);
  const health = useGatewayStore((s) => s.health);
  const agents = useGatewayStore((s) => s.agents);
  const [detailedHealth, setDetailedHealth] = useState<DetailedHealth | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastPoll, setLastPoll] = useState(0);
  const prevNetRef = useRef<Record<string, { rx: number; tx: number }> | null>(null);
  const [netRates, setNetRates] = useState<Record<string, { rxRate: number; txRate: number }>>({});

  const cancelledRef = useRef(false);

  const fetchAll = useCallback(async () => {
    try {
      setRefreshing(true);
      const [healthData, metricsData, procData] = await Promise.all([
        gateway.request<DetailedHealth>('health.detailed').catch(() => null),
        gateway.request<SystemMetrics>('system.metrics').catch(() => null),
        gateway.request<ProcessInfo[]>('system.processes').catch(() => []),
      ]);
      // Avoid state updates if component has been unmounted (effect cleaned up)
      if (cancelledRef.current) return;
      if (healthData) setDetailedHealth(healthData);
      if (metricsData) {
        // Calculate network rates
        if (prevNetRef.current && metricsData.network) {
          const rates: Record<string, { rxRate: number; txRate: number }> = {};
          for (const [iface, data] of Object.entries(metricsData.network)) {
            const prev = prevNetRef.current[iface];
            if (prev && data.rx > prev.rx) {
              rates[iface] = {
                rxRate: (data.rx - prev.rx) / 10, // per second (10s interval)
                txRate: (data.tx - prev.tx) / 10,
              };
            }
          }
          setNetRates(rates);
        }
        prevNetRef.current = Object.fromEntries(
          Object.entries(metricsData.network).map(([k, v]) => [k, { rx: v.rx, tx: v.tx }])
        );
        setMetrics(metricsData);
      }
      if (procData) setProcesses(procData);
      setLastPoll(Date.now());
    } catch {
      // ignore
    } finally {
      if (!cancelledRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    if (connected) {
      void fetchAll();
      const interval = setInterval(() => void fetchAll(), 10000);
      return () => {
        cancelledRef.current = true;
        clearInterval(interval);
      };
    }
    return () => { cancelledRef.current = true; };
  }, [connected, fetchAll]);

  const h = detailedHealth ?? health;

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 20,
      background: 'var(--bg-primary)',
    }}>
      {/* Page Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Activity size={20} color="var(--cyan-bright)" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          letterSpacing: 3,
          color: 'var(--cyan-bright)',
          textShadow: 'var(--glow-cyan)',
          margin: 0,
        }}>
          SYSTEM OVERVIEW
        </h1>
        <span style={{
          fontSize: 9,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
        }}>
          {lastPoll > 0 ? `polled ${Math.floor((Date.now() - lastPoll) / 1000)}s ago` : ''}
        </span>
        <button
          onClick={() => void fetchAll()}
          aria-label="Refresh system overview"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            padding: '4px 12px',
            opacity: refreshing ? 0.5 : 1,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 4,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-display)',
            letterSpacing: 1,
          }}
        >
          <RefreshCw size={10} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          {refreshing ? 'REFRESHING...' : 'REFRESH'}
        </button>
      </div>

      {/* Infrastructure Status */}
      <SectionTitle icon={<Server size={14} />} label="INFRASTRUCTURE" color="var(--green-bright)" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatusCard
          icon={<Server size={16} />}
          title="GATEWAY"
          status={connected ? 'online' : 'offline'}
          items={[
            { label: 'Version', value: h?.version ?? '-' },
            { label: 'Uptime', value: h ? formatUptime(h.uptime) : '-' },
            { label: 'Status', value: h?.status ?? 'unknown' },
            { label: 'Clients', value: String(h?.dashboard?.connectedClients ?? 0) },
          ]}
        />

        <StatusCard
          icon={<Wifi size={16} />}
          title="NATS"
          status={h?.infrastructure?.nats ? 'online' : 'offline'}
          items={[
            { label: 'Connected', value: h?.infrastructure?.nats ? 'Yes' : 'No' },
            { label: 'URL', value: 'nats://127.0.0.1:4222' },
          ]}
        />

        <StatusCard
          icon={<Database size={16} />}
          title="REDIS"
          status={h?.infrastructure?.redis ? 'online' : 'offline'}
          items={[
            { label: 'Connected', value: h?.infrastructure?.redis ? 'Yes' : 'No' },
            { label: 'URL', value: 'redis://127.0.0.1:6379' },
          ]}
        />

        <StatusCard
          icon={<HardDrive size={16} />}
          title="NAS STORAGE"
          status={h?.infrastructure?.nas?.mounted ? 'online' : 'offline'}
          items={[
            { label: 'Mounted', value: h?.infrastructure?.nas?.mounted ? 'Yes' : 'No' },
            { label: 'Path', value: h?.infrastructure?.nas?.path ? '...' + h.infrastructure.nas.path.slice(-25) : '-' },
          ]}
        />
      </div>

      {/* System Metrics */}
      {metrics && (
        <>
          <SectionTitle icon={<Gauge size={14} />} label="SYSTEM METRICS" color="var(--amber)" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 20 }}>
            {/* CPU Card */}
            <MetricCard
              icon={<Cpu size={16} />}
              title="CPU"
              color={metrics.cpu.usage > 80 ? 'var(--red-bright)' : metrics.cpu.usage > 50 ? 'var(--amber)' : 'var(--green-bright)'}
              mainValue={`${metrics.cpu.usage.toFixed(1)}%`}
              mainLabel="USAGE"
              bar={metrics.cpu.usage}
              items={[
                { label: 'Cores', value: String(metrics.cpu.cores) },
                { label: 'Model', value: metrics.cpu.model.split(' ').slice(0, 3).join(' ') },
                { label: 'Load 1m', value: metrics.cpu.load[0].toFixed(2) },
                { label: 'Load 5m', value: metrics.cpu.load[1].toFixed(2) },
                { label: 'Load 15m', value: metrics.cpu.load[2].toFixed(2) },
              ]}
            />

            {/* Memory Card */}
            <MetricCard
              icon={<MemoryStick size={16} />}
              title="MEMORY"
              color={metrics.memory.usedPercent > 90 ? 'var(--red-bright)' : metrics.memory.usedPercent > 70 ? 'var(--amber)' : 'var(--green-bright)'}
              mainValue={`${metrics.memory.usedPercent.toFixed(1)}%`}
              mainLabel="USED"
              bar={metrics.memory.usedPercent}
              items={[
                { label: 'Total', value: formatBytes(metrics.memory.total) },
                { label: 'Used', value: formatBytes(metrics.memory.used) },
                { label: 'Free', value: formatBytes(metrics.memory.free) },
              ]}
            />

            {/* Disk Card */}
            {metrics.disk.length > 0 && (
              <MetricCard
                icon={<HardDrive size={16} />}
                title="DISK /"
                color={metrics.disk[0].usedPercent > 90 ? 'var(--red-bright)' : metrics.disk[0].usedPercent > 70 ? 'var(--amber)' : 'var(--green-bright)'}
                mainValue={`${metrics.disk[0].usedPercent}%`}
                mainLabel="USED"
                bar={metrics.disk[0].usedPercent}
                items={[
                  { label: 'Size', value: metrics.disk[0].size },
                  { label: 'Used', value: metrics.disk[0].used },
                  { label: 'Available', value: metrics.disk[0].available },
                  { label: 'Mount', value: metrics.disk[0].mount },
                ]}
              />
            )}

            {/* Network Card */}
            <div style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 6,
              padding: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Network size={16} style={{ color: 'var(--cyan-bright)' }} />
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 11,
                  letterSpacing: 2,
                  color: 'var(--text-white)',
                }}>NETWORK</span>
              </div>
              {Object.entries(metrics.network).map(([iface, data]) => (
                <div key={iface} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'var(--cyan-bright)' }}>{iface}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{data.ip}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 10, fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    <span style={{ color: 'var(--green-bright)' }}>
                      ↓ {netRates[iface] ? formatBytesRate(netRates[iface].rxRate) : formatBytes(data.rx)}
                    </span>
                    <span style={{ color: 'var(--amber)' }}>
                      ↑ {netRates[iface] ? formatBytesRate(netRates[iface].txRate) : formatBytes(data.tx)}
                    </span>
                  </div>
                </div>
              ))}
              {Object.keys(metrics.network).length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                  No active interfaces
                </div>
              )}
            </div>

            {/* OS Info Card */}
            <StatusCard
              icon={<Monitor size={16} />}
              title="HOST OS"
              status="online"
              items={[
                { label: 'Hostname', value: metrics.os.hostname },
                { label: 'Platform', value: metrics.os.platform },
                { label: 'Arch', value: metrics.os.arch },
                { label: 'OS Uptime', value: formatUptime(metrics.os.uptime) },
              ]}
            />
          </div>
        </>
      )}

      {/* Agents Section */}
      <SectionTitle icon={<Users size={14} />} label="AGENTS" color="var(--green-bright)" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 20 }}>
        {(detailedHealth?.agents ?? health?.agents ?? []).map((agent) => (
          <AgentCard key={agent.id} agent={agent} storeAgent={agents.get(agent.id)} />
        ))}

        {(!detailedHealth?.agents && !health?.agents) && (
          <div style={{
            padding: 20,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
          }}>
            No agents registered. Waiting for agents to connect...
          </div>
        )}
      </div>

      {/* Top Processes */}
      {processes.length > 0 && (
        <>
          <SectionTitle icon={<Thermometer size={14} />} label="TOP PROCESSES" color="var(--red-bright)" />
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 20,
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '60px 1fr 80px 80px 100px',
              gap: 8,
              fontSize: 9,
              fontFamily: 'var(--font-display)',
              letterSpacing: 1,
              color: 'var(--text-muted)',
              padding: '0 0 6px 0',
              borderBottom: '1px solid var(--border-primary)',
              marginBottom: 4,
            }}>
              <span>PID</span>
              <span>NAME</span>
              <span style={{ textAlign: 'right' }}>CPU %</span>
              <span style={{ textAlign: 'right' }}>MEM %</span>
              <span>USER</span>
            </div>
            {processes.slice(0, 12).map((p, i) => (
              <div key={`${p.pid}-${i}`} style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr 80px 80px 100px',
                gap: 8,
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                padding: '3px 0',
                borderBottom: i < processes.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
              }}>
                <span style={{ color: 'var(--text-muted)' }}>{p.pid}</span>
                <span style={{
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{p.name}</span>
                <span style={{
                  textAlign: 'right',
                  color: p.cpu > 50 ? 'var(--red-bright)' : p.cpu > 20 ? 'var(--amber)' : 'var(--green-bright)',
                }}>
                  {p.cpu.toFixed(1)}%
                  <span style={{ display: 'inline-block', width: 30, height: 3, background: 'var(--bg-primary)', borderRadius: 2, marginLeft: 4, verticalAlign: 'middle' }}>
                    <span style={{ display: 'block', width: `${Math.min(100, p.cpu)}%`, height: '100%', background: p.cpu > 50 ? 'var(--red-bright)' : p.cpu > 20 ? 'var(--amber)' : 'var(--green-bright)', borderRadius: 2 }} />
                  </span>
                </span>
                <span style={{
                  textAlign: 'right',
                  color: p.mem > 10 ? 'var(--amber)' : 'var(--text-secondary)',
                }}>
                  {p.mem.toFixed(1)}%
                </span>
                <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.user}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Quick Stats Summary */}
      <SectionTitle icon={<Cpu size={14} />} label="QUICK STATS" color="var(--cyan-bright)" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
        <StatBox label="Agents Online" value={String(detailedHealth?.agents?.filter(a => a.alive).length ?? 0)} color="var(--green-bright)" />
        <StatBox label="Agents Offline" value={String(detailedHealth?.agents?.filter(a => !a.alive).length ?? 0)} color="var(--red-bright)" />
        <StatBox label="Clients" value={String(h?.dashboard?.connectedClients ?? 0)} color="var(--cyan-bright)" />
        <StatBox label="Infra OK" value={`${[h?.infrastructure?.nats, h?.infrastructure?.redis, h?.infrastructure?.nas?.mounted].filter(Boolean).length}/3`} color="var(--amber)" />
        {metrics && (
          <>
            <StatBox label="CPU Usage" value={`${metrics.cpu.usage.toFixed(0)}%`} color={metrics.cpu.usage > 80 ? 'var(--red-bright)' : 'var(--green-bright)'} />
            <StatBox label="Memory" value={`${metrics.memory.usedPercent.toFixed(0)}%`} color={metrics.memory.usedPercent > 90 ? 'var(--red-bright)' : 'var(--amber)'} />
            <StatBox label="CPU Cores" value={String(metrics.cpu.cores)} color="var(--cyan-bright)" />
            <StatBox label="OS Uptime" value={formatUptimeShort(metrics.os.uptime)} color="var(--green-bright)" />
          </>
        )}
      </div>
    </div>
  );
}

/* === Sub-components === */

function SectionTitle({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ color }}>{icon}</span>
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 13,
        letterSpacing: 2,
        color,
        margin: 0,
      }}>
        {label}
      </h2>
      <div style={{ flex: 1, height: 1, background: `${color}22`, marginLeft: 8 }} />
    </div>
  );
}

function StatusCard({ icon, title, status, items }: {
  icon: React.ReactNode;
  title: string;
  status: 'online' | 'offline';
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 6,
      padding: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: status === 'online' ? 'var(--green-bright)' : 'var(--red-bright)' }}>
          {icon}
        </span>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          letterSpacing: 2,
          color: 'var(--text-white)',
        }}>
          {title}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 9,
          padding: '2px 8px',
          borderRadius: 3,
          background: status === 'online' ? 'rgba(0,255,65,0.1)' : 'rgba(255,51,51,0.1)',
          border: `1px solid ${status === 'online' ? 'var(--green-dim)' : 'var(--red-dim)'}`,
          color: status === 'online' ? 'var(--green-bright)' : 'var(--red-bright)',
          fontFamily: 'var(--font-display)',
          letterSpacing: 1,
        }}>
          {status === 'online' ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      {items.map((item) => (
        <div key={item.label} style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '3px 0',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
        }}>
          <span style={{ color: 'var(--text-muted)' }}>{item.label}</span>
          <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function MetricCard({ icon, title, color, mainValue, mainLabel, bar, items }: {
  icon: React.ReactNode;
  title: string;
  color: string;
  mainValue: string;
  mainLabel: string;
  bar: number;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 6,
      padding: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ color }}>{icon}</span>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          letterSpacing: 2,
          color: 'var(--text-white)',
        }}>
          {title}
        </span>
      </div>

      {/* Big value + bar */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <span style={{
          fontSize: 28,
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          color,
          lineHeight: 1,
        }}>
          {mainValue}
        </span>
        <span style={{
          fontSize: 9,
          fontFamily: 'var(--font-display)',
          color: 'var(--text-muted)',
          letterSpacing: 1,
        }}>
          {mainLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 4,
        background: 'var(--bg-primary)',
        borderRadius: 2,
        marginBottom: 10,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(100, bar)}%`,
          height: '100%',
          background: color,
          borderRadius: 2,
          transition: 'width 0.5s ease',
          boxShadow: `0 0 6px ${color}44`,
        }} />
      </div>

      {/* Detail items */}
      {items.map((item) => (
        <div key={item.label} style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '2px 0',
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
        }}>
          <span style={{ color: 'var(--text-muted)' }}>{item.label}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  jarvis: 'JARVIS',
  'agent-smith': 'SMITH',
  'agent-johny': 'JOHNY',
};

function AgentCard({ agent, storeAgent }: {
  agent: { id: string; role: string; status: string; alive: boolean; activeTask: string | null; lastHeartbeat?: number };
  storeAgent?: { identity: { agentId: string; role: string; machineId: string; hostname: string }; status: string; completedTasks: number; failedTasks: number; lastHeartbeat: number };
}) {
  const heartbeatAgo = agent.lastHeartbeat
    ? Math.floor((Date.now() - agent.lastHeartbeat) / 1000)
    : storeAgent?.lastHeartbeat
      ? Math.floor((Date.now() - storeAgent.lastHeartbeat) / 1000)
      : null;

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: `1px solid ${agent.alive ? 'var(--border-primary)' : 'rgba(255,51,51,0.2)'}`,
      borderRadius: 6,
      padding: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: agent.alive ? 'var(--green-bright)' : 'var(--red-bright)',
          boxShadow: agent.alive ? 'var(--glow-green)' : 'var(--glow-red)',
        }} />
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          letterSpacing: 2,
          color: 'var(--text-white)',
        }}>
          {AGENT_DISPLAY_NAMES[agent.id] ?? agent.id.toUpperCase()}
        </span>
        <span style={{
          fontSize: 9,
          padding: '1px 6px',
          borderRadius: 3,
          background: 'rgba(0,255,255,0.08)',
          border: '1px solid var(--border-cyan)',
          color: 'var(--cyan-bright)',
          fontFamily: 'var(--font-mono)',
        }}>
          {agent.role}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 9,
          padding: '1px 6px',
          borderRadius: 3,
          background: agent.status === 'idle' ? 'rgba(0,255,65,0.08)' : agent.status === 'busy' ? 'rgba(255,170,0,0.08)' : 'rgba(255,51,51,0.08)',
          border: `1px solid ${agent.status === 'idle' ? 'var(--green-dim)' : agent.status === 'busy' ? 'rgba(255,170,0,0.3)' : 'var(--red-dim)'}`,
          color: agent.status === 'idle' ? 'var(--green-bright)' : agent.status === 'busy' ? 'var(--amber)' : 'var(--red-bright)',
          fontFamily: 'var(--font-display)',
          letterSpacing: 1,
        }}>
          {agent.status.toUpperCase()}
        </span>
      </div>

      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
        {storeAgent && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>Machine</span>
              <span style={{ color: 'var(--text-secondary)' }}>{storeAgent.identity.machineId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>Hostname</span>
              <span style={{ color: 'var(--text-secondary)' }}>{storeAgent.identity.hostname}</span>
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ color: 'var(--text-muted)' }}>Heartbeat</span>
          <span style={{ color: heartbeatAgo !== null && heartbeatAgo < 60 ? 'var(--green-bright)' : 'var(--text-muted)' }}>
            {heartbeatAgo !== null ? `${heartbeatAgo}s ago` : 'never'}
          </span>
        </div>
        {storeAgent && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span style={{ color: 'var(--text-muted)' }}>Tasks</span>
            <span>
              <span style={{ color: 'var(--green-bright)' }}>{storeAgent.completedTasks}</span>
              <span style={{ color: 'var(--text-muted)' }}> / </span>
              <span style={{ color: 'var(--red-bright)' }}>{storeAgent.failedTasks}</span>
              <span style={{ color: 'var(--text-muted)' }}> (ok/fail)</span>
            </span>
          </div>
        )}
        {agent.activeTask && (
          <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(255,170,0,0.05)', borderRadius: 4, border: '1px solid rgba(255,170,0,0.2)' }}>
            <span style={{ color: 'var(--amber)', fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1 }}>ACTIVE TASK</span>
            <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 2 }}>{agent.activeTask}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 6,
      padding: '12px 14px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', color, fontWeight: 700 }}>
        {value}
      </div>
      <div style={{ fontSize: 9, fontFamily: 'var(--font-display)', color: 'var(--text-muted)', letterSpacing: 1, marginTop: 4 }}>
        {label.toUpperCase()}
      </div>
    </div>
  );
}

