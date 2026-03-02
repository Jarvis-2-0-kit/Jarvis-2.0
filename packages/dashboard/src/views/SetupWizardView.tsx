/**
 * SetupWizardView — Agent Onboarding & Deployment Wizard
 *
 * 3-step wizard:
 * 1. Master Status — shows master node info and connectivity
 * 2. Add Agent — form to register a new agent with auto-generated tokens
 * 3. Verify & Launch — start local agents or test remote connections
 *
 * Plus a persistent Agent Registry panel at the bottom.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  Server,
  Plus,
  Rocket,
  CheckCircle2,
  XCircle,
  Copy,
  Download,
  Play,
  Square,
  Trash2,
  Wifi,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Monitor,
  Globe,
} from 'lucide-react';

// --- Types ---

interface MasterInfo {
  hostname: string;
  ip: string;
  natsPort: number;
  redisPort: number;
  gatewayPort: number;
  gatewayUrl: string;
  nasPath: string;
  nasMounted: boolean;
  natsConnected: boolean;
}

interface RegistryEntry {
  agentId: string;
  role: string;
  hostname: string;
  ip: string;
  machineId: string;
  natsToken: string;
  authToken: string;
  isLocal: boolean;
  deployedAt: number;
  lastSeen: number | null;
  config: Record<string, unknown>;
}

interface NetworkMachine {
  ip: string;
  hostname: string;
}

// --- Main Component ---

export function SetupWizardView() {
  const connected = useGatewayStore((s) => s.connected);
  const agents = useGatewayStore((s) => s.agents);
  const [step, setStep] = useState(1);

  // Step 1 state
  const [masterInfo, setMasterInfo] = useState<MasterInfo | null>(null);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(false);

  // Step 2 state
  const [newAgentId, setNewAgentId] = useState('');
  const [newRole, setNewRole] = useState<'orchestrator' | 'dev' | 'marketing'>('dev');
  const [machineType, setMachineType] = useState<'local' | 'remote'>('local');
  const [remoteIp, setRemoteIp] = useState('');
  const [remoteHostname, setRemoteHostname] = useState('');
  const [addResult, setAddResult] = useState<{ agentId: string; envSnippet: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // Step 3 state
  const [starting, setStarting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ reachable: boolean; latencyMs: number } | null>(null);
  const [agentOnline, setAgentOnline] = useState(false);

  // Network scan
  const [networkMachines, setNetworkMachines] = useState<NetworkMachine[]>([]);
  const [scanning, setScanning] = useState(false);

  // Registry action states
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  const navigate = useNavigate();

  // Fetch master info & registry
  const fetchMasterInfo = useCallback(async () => {
    if (!connected) return;
    setLoadingMaster(true);
    try {
      const info = await gateway.request<MasterInfo>('setup.master.info');
      setMasterInfo(info);
    } catch { /* ignore */ }
    try {
      const reg = await gateway.request<RegistryEntry[]>('setup.agents.registry');
      setRegistry(reg || []);
    } catch { /* ignore */ }
    setLoadingMaster(false);
  }, [connected]);

  useEffect(() => {
    void fetchMasterInfo();
  }, [fetchMasterInfo]);

  // Watch for agent coming online (step 3)
  useEffect(() => {
    if (addResult && step === 3) {
      const agentState = agents.get(addResult.agentId);
      if (agentState && agentState.status !== 'offline') {
        setAgentOnline(true);
      }
    }
  }, [agents, addResult, step]);

  // Listen for setup events
  useEffect(() => {
    const unsub1 = gateway.on('setup.agent.added', () => void fetchMasterInfo());
    const unsub2 = gateway.on('setup.agent.removed', () => void fetchMasterInfo());
    const unsub3 = gateway.on('setup.agent.started', () => void fetchMasterInfo());
    const unsub4 = gateway.on('setup.agent.stopped', () => void fetchMasterInfo());
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [fetchMasterInfo]);

  // --- Handlers ---

  const handleAddAgent = async () => {
    if (!newAgentId.trim()) { setAddError('Agent ID is required'); return; }
    setAdding(true);
    setAddError('');
    try {
      const result = await gateway.request<{ agentId: string; envSnippet: string }>('setup.agents.add', {
        agentId: newAgentId.trim(),
        role: newRole,
        hostname: machineType === 'remote' ? remoteHostname : undefined,
        ip: machineType === 'remote' ? remoteIp : undefined,
      });
      setAddResult(result);
      setAgentOnline(false);
      setTestResult(null);
      await fetchMasterInfo();
      setStep(3);
    } catch (err) {
      setAddError((err as Error).message);
    }
    setAdding(false);
  };

  const handleStartAgent = async () => {
    if (!addResult) return;
    setStarting(true);
    try {
      await gateway.request('setup.agents.start', { agentId: addResult.agentId });
    } catch { /* ignore — will see status via events */ }
    setStarting(false);
  };

  const handleTestAgent = async () => {
    if (!addResult) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await gateway.request<{ reachable: boolean; latencyMs: number }>('setup.agents.test', { agentId: addResult.agentId });
      setTestResult(result);
    } catch { setTestResult({ reachable: false, latencyMs: 0 }); }
    setTesting(false);
  };

  const handleNetworkScan = async () => {
    setScanning(true);
    try {
      const machines = await gateway.request<NetworkMachine[]>('setup.network.scan');
      setNetworkMachines(machines || []);
    } catch { /* ignore */ }
    setScanning(false);
  };

  const handleCopyEnv = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  const handleDownloadEnv = (agentId: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agentId}.env`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Registry actions
  const handleRegistryStart = async (agentId: string) => {
    setActionLoading((p) => ({ ...p, [agentId]: 'starting' }));
    try { await gateway.request('setup.agents.start', { agentId }); } catch { /* */ }
    setActionLoading((p) => { const n = { ...p }; delete n[agentId]; return n; });
  };

  const handleRegistryStop = async (agentId: string) => {
    setActionLoading((p) => ({ ...p, [agentId]: 'stopping' }));
    try { await gateway.request('setup.agents.stop', { agentId }); } catch { /* */ }
    setActionLoading((p) => { const n = { ...p }; delete n[agentId]; return n; });
  };

  const handleRegistryRemove = async (agentId: string) => {
    setActionLoading((p) => ({ ...p, [agentId]: 'removing' }));
    try {
      await gateway.request('setup.agents.remove', { agentId });
      await fetchMasterInfo();
    } catch { /* */ }
    setActionLoading((p) => { const n = { ...p }; delete n[agentId]; return n; });
  };

  const handleRegistryCopyEnv = async (agentId: string) => {
    try {
      const result = await gateway.request<{ env: string }>('setup.agents.env', { agentId });
      if (result?.env) void navigator.clipboard.writeText(result.env);
    } catch { /* */ }
  };

  const handleRegistryTest = async (agentId: string) => {
    setActionLoading((p) => ({ ...p, [agentId]: 'testing' }));
    try { await gateway.request('setup.agents.test', { agentId }); } catch { /* */ }
    setActionLoading((p) => { const n = { ...p }; delete n[agentId]; return n; });
  };

  // --- Styles ---

  const panelStyle: React.CSSProperties = {
    background: 'rgba(0,255,65,0.02)',
    border: '1px solid var(--border-primary)',
    borderRadius: 12,
    padding: 24,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontFamily: 'var(--font-display)',
    letterSpacing: 2,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    fontSize: 13,
    fontFamily: 'var(--font-mono)',
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid var(--border-primary)',
    borderRadius: 8,
    color: 'var(--text-white)',
    outline: 'none',
  };

  const btnPrimary: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 20px',
    fontSize: 12,
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    letterSpacing: 2,
    color: '#000',
    background: 'var(--green-bright)',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    textTransform: 'uppercase',
  };

  const btnSecondary: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    fontSize: 11,
    fontFamily: 'var(--font-display)',
    fontWeight: 600,
    letterSpacing: 1,
    color: 'var(--text-secondary)',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border-primary)',
    borderRadius: 6,
    cursor: 'pointer',
  };

  const statusDot = (ok: boolean): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: ok ? '#00ff41' : '#ff3333',
    boxShadow: ok ? '0 0 8px rgba(0,255,65,0.5)' : '0 0 8px rgba(255,51,51,0.5)',
    display: 'inline-block',
  });

  // --- Render ---

  if (!connected) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-display)', letterSpacing: 2 }}>
        WAITING FOR CONNECTION...
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{
            fontSize: 20,
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            letterSpacing: 4,
            color: 'var(--green-bright)',
            textShadow: 'var(--glow-green)',
            margin: 0,
          }}>
            SETUP WIZARD
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', margin: '4px 0 0' }}>
            Agent onboarding, deployment & lifecycle management
          </p>
        </div>
        <button onClick={() => void fetchMasterInfo()} style={btnSecondary} title="Refresh">
          <RefreshCw size={14} />
          REFRESH
        </button>
      </div>

      {/* Step Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 28 }}>
        {[
          { num: 1, label: 'Master Status', icon: Server },
          { num: 2, label: 'Add Agent', icon: Plus },
          { num: 3, label: 'Verify & Launch', icon: Rocket },
        ].map(({ num, label, icon: Icon }, i) => (
          <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setStep(num)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                fontSize: 11,
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                letterSpacing: 1.5,
                color: step === num ? '#000' : step > num ? 'var(--green-bright)' : 'var(--text-muted)',
                background: step === num ? 'var(--green-bright)' : step > num ? 'rgba(0,255,65,0.08)' : 'rgba(255,255,255,0.03)',
                border: step === num ? 'none' : step > num ? '1px solid rgba(0,255,65,0.2)' : '1px solid var(--border-primary)',
                borderRadius: 8,
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              <Icon size={14} />
              {label}
            </button>
            {i < 2 && <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
          </div>
        ))}
      </div>

      {/* Step Content */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Master Info */}
          <div style={panelStyle}>
            <div style={{ ...labelStyle, marginBottom: 16 }}>MASTER NODE</div>
            {loadingMaster && !masterInfo ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading...</div>
            ) : masterInfo ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                <InfoItem label="Hostname" value={masterInfo.hostname} />
                <InfoItem label="IP Address" value={masterInfo.ip} />
                <InfoItem label="Gateway Port" value={String(masterInfo.gatewayPort)} />
                <InfoItem label="Gateway URL" value={masterInfo.gatewayUrl} />
                <InfoItem label="NAS Path" value={masterInfo.nasPath} />
                <div>
                  <div style={labelStyle}>STATUS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    <StatusLine label="Gateway" ok={connected} />
                    <StatusLine label="NATS" ok={masterInfo.natsConnected} />
                    <StatusLine label="NAS" ok={masterInfo.nasMounted} />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--red-bright)', fontSize: 12 }}>Failed to load master info</div>
            )}
          </div>

          {/* Existing Agents Quick View */}
          <div style={panelStyle}>
            <div style={{ ...labelStyle, marginBottom: 12 }}>
              ACTIVE AGENTS ({agents.size})
            </div>
            {agents.size === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
                No agents online. Use Step 2 to add and deploy agents.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {Array.from(agents.values()).map((agent) => {
                  const isOnline = agent.status !== 'offline';
                  return (
                    <div key={agent.identity.agentId} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 16px',
                      background: 'rgba(0,0,0,0.2)',
                      border: `1px solid ${isOnline ? 'rgba(0,255,65,0.15)' : 'var(--border-primary)'}`,
                      borderRadius: 8,
                    }}>
                      <span style={statusDot(isOnline)} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-white)' }}>
                          {agent.identity.agentId.toUpperCase()}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
                          {agent.identity.role} / {agent.status}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setStep(2)} style={btnPrimary}>
              NEXT: ADD AGENT
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={panelStyle}>
            <div style={{ ...labelStyle, marginBottom: 16 }}>NEW AGENT</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <div style={labelStyle}>AGENT ID</div>
                <input
                  value={newAgentId}
                  onChange={(e) => setNewAgentId(e.target.value)}
                  placeholder="e.g. agent-alpha"
                  style={inputStyle}
                />
              </div>
              <div>
                <div style={labelStyle}>ROLE</div>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as typeof newRole)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="orchestrator">Orchestrator</option>
                  <option value="dev">Developer</option>
                  <option value="marketing">Marketing</option>
                </select>
              </div>
            </div>

            {/* Machine Type */}
            <div style={{ marginBottom: 16 }}>
              <div style={labelStyle}>MACHINE</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                <button
                  onClick={() => setMachineType('local')}
                  style={{
                    ...btnSecondary,
                    color: machineType === 'local' ? 'var(--green-bright)' : 'var(--text-muted)',
                    borderColor: machineType === 'local' ? 'rgba(0,255,65,0.3)' : 'var(--border-primary)',
                    background: machineType === 'local' ? 'rgba(0,255,65,0.06)' : 'rgba(255,255,255,0.04)',
                  }}
                >
                  <Monitor size={14} />
                  LOCAL
                </button>
                <button
                  onClick={() => setMachineType('remote')}
                  style={{
                    ...btnSecondary,
                    color: machineType === 'remote' ? 'var(--cyan-bright)' : 'var(--text-muted)',
                    borderColor: machineType === 'remote' ? 'rgba(0,200,255,0.3)' : 'var(--border-primary)',
                    background: machineType === 'remote' ? 'rgba(0,200,255,0.06)' : 'rgba(255,255,255,0.04)',
                  }}
                >
                  <Globe size={14} />
                  REMOTE
                </button>
              </div>
            </div>

            {/* Remote fields */}
            {machineType === 'remote' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={labelStyle}>IP ADDRESS</div>
                  <input
                    value={remoteIp}
                    onChange={(e) => setRemoteIp(e.target.value)}
                    placeholder="e.g. 192.168.1.100"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={labelStyle}>HOSTNAME</div>
                    <button onClick={() => void handleNetworkScan()} style={{ ...btnSecondary, padding: '4px 8px', fontSize: 9 }} disabled={scanning}>
                      <Wifi size={10} />
                      {scanning ? 'SCANNING...' : 'SCAN NETWORK'}
                    </button>
                  </div>
                  <input
                    value={remoteHostname}
                    onChange={(e) => setRemoteHostname(e.target.value)}
                    placeholder="e.g. mac-mini-alpha"
                    style={inputStyle}
                  />
                </div>
                {networkMachines.length > 0 && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={labelStyle}>DISCOVERED MACHINES</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                      {networkMachines.map((m) => (
                        <button
                          key={m.ip}
                          onClick={() => { setRemoteIp(m.ip); setRemoteHostname(m.hostname); }}
                          style={{
                            ...btnSecondary,
                            padding: '6px 12px',
                            fontSize: 11,
                          }}
                        >
                          {m.hostname} ({m.ip})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {addError && (
              <div style={{ color: 'var(--red-bright)', fontSize: 12, fontFamily: 'var(--font-ui)', marginBottom: 12 }}>
                {addError}
              </div>
            )}

            <button onClick={() => void handleAddAgent()} style={btnPrimary} disabled={adding}>
              {adding ? 'REGISTERING...' : 'REGISTER AGENT'}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(1)} style={btnSecondary}>
              <ChevronLeft size={14} />
              BACK
            </button>
          </div>
        </div>
      )}

      {step === 3 && addResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Generated .env */}
          <div style={panelStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={labelStyle}>
                GENERATED .ENV FOR: {addResult.agentId.toUpperCase()}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleCopyEnv(addResult.envSnippet)} style={btnSecondary}>
                  <Copy size={12} />
                  COPY
                </button>
                <button onClick={() => handleDownloadEnv(addResult.agentId, addResult.envSnippet)} style={btnSecondary}>
                  <Download size={12} />
                  DOWNLOAD .ENV
                </button>
              </div>
            </div>
            <pre style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid var(--border-dim)',
              borderRadius: 8,
              padding: 16,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--green-primary)',
              overflow: 'auto',
              maxHeight: 300,
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {addResult.envSnippet}
            </pre>
          </div>

          {/* Launch / Test */}
          <div style={panelStyle}>
            <div style={{ ...labelStyle, marginBottom: 16 }}>VERIFY & LAUNCH</div>

            {/* Status indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <span style={statusDot(agentOnline)} />
              <span style={{
                fontSize: 13,
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                letterSpacing: 1,
                color: agentOnline ? 'var(--green-bright)' : 'var(--text-muted)',
              }}>
                {agentOnline ? 'AGENT ONLINE' : 'AGENT OFFLINE'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              {/* For local: show start button */}
              {(machineType === 'local' || registry.find((e) => e.agentId === addResult.agentId)?.isLocal) && (
                <button
                  onClick={() => void handleStartAgent()}
                  disabled={starting || agentOnline}
                  style={{
                    ...btnPrimary,
                    opacity: starting || agentOnline ? 0.5 : 1,
                  }}
                >
                  <Play size={14} />
                  {starting ? 'STARTING...' : agentOnline ? 'RUNNING' : 'START AGENT'}
                </button>
              )}

              {/* Test connection */}
              <button
                onClick={() => void handleTestAgent()}
                disabled={testing}
                style={btnSecondary}
              >
                <Wifi size={14} />
                {testing ? 'TESTING...' : 'TEST CONNECTION'}
              </button>
            </div>

            {/* Test result */}
            {testResult && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 12,
                padding: '8px 14px',
                background: testResult.reachable ? 'rgba(0,255,65,0.06)' : 'rgba(255,51,51,0.06)',
                border: `1px solid ${testResult.reachable ? 'rgba(0,255,65,0.2)' : 'rgba(255,51,51,0.2)'}`,
                borderRadius: 8,
                fontSize: 12,
                fontFamily: 'var(--font-ui)',
                color: testResult.reachable ? 'var(--green-bright)' : 'var(--red-bright)',
              }}>
                {testResult.reachable ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                {testResult.reachable
                  ? `Reachable (${testResult.latencyMs}ms)`
                  : 'Not reachable — make sure the agent is running'}
              </div>
            )}

            {/* Agent online success */}
            {agentOnline && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 12,
                padding: '10px 14px',
                background: 'rgba(0,255,65,0.06)',
                border: '1px solid rgba(0,255,65,0.2)',
                borderRadius: 8,
                fontSize: 13,
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                letterSpacing: 1,
                color: 'var(--green-bright)',
              }}>
                <CheckCircle2 size={16} />
                Agent is online and connected!
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => { setStep(2); setAddResult(null); setAddError(''); setNewAgentId(''); }} style={btnSecondary}>
              <ChevronLeft size={14} />
              ADD ANOTHER
            </button>
            <button onClick={() => navigate('/agents')} style={btnPrimary}>
              DONE — GO TO AGENTS
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {step === 3 && !addResult && (
        <div style={{ ...panelStyle, textAlign: 'center', padding: 40 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-ui)', marginBottom: 16 }}>
            No agent was added yet. Go to Step 2 to register an agent first.
          </div>
          <button onClick={() => setStep(2)} style={btnSecondary}>
            <ChevronLeft size={14} />
            GO TO STEP 2
          </button>
        </div>
      )}

      {/* Agent Registry Panel */}
      <div style={{ ...panelStyle, marginTop: 32 }}>
        <div style={{ ...labelStyle, marginBottom: 16 }}>
          AGENT REGISTRY ({registry.length})
        </div>
        {registry.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
            No agents registered. Use the wizard above to add agents.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                  {['Agent ID', 'Role', 'Machine', 'Type', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left',
                      padding: '8px 12px',
                      fontSize: 9,
                      fontFamily: 'var(--font-display)',
                      letterSpacing: 2,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {registry.map((entry) => {
                  const agentState = agents.get(entry.agentId);
                  const isOnline = agentState && agentState.status !== 'offline';
                  const loading = actionLoading[entry.agentId];

                  return (
                    <tr key={entry.agentId} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-white)' }}>
                        {entry.agentId.toUpperCase()}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                        {entry.role}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {entry.hostname} ({entry.ip})
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px',
                          fontSize: 9,
                          fontFamily: 'var(--font-display)',
                          letterSpacing: 1,
                          borderRadius: 4,
                          color: entry.isLocal ? 'var(--cyan-bright)' : 'var(--amber)',
                          background: entry.isLocal ? 'rgba(0,200,255,0.08)' : 'rgba(255,170,0,0.08)',
                          border: `1px solid ${entry.isLocal ? 'rgba(0,200,255,0.2)' : 'rgba(255,170,0,0.2)'}`,
                        }}>
                          {entry.isLocal ? 'LOCAL' : 'REMOTE'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={statusDot(!!isOnline)} />
                          <span style={{ color: isOnline ? 'var(--green-bright)' : 'var(--text-muted)', fontSize: 11 }}>
                            {agentState?.status?.toUpperCase() || 'UNKNOWN'}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {entry.isLocal && !isOnline && (
                            <button
                              onClick={() => void handleRegistryStart(entry.agentId)}
                              disabled={!!loading}
                              style={{ ...btnSecondary, padding: '4px 8px', fontSize: 9, color: 'var(--green-bright)' }}
                              title="Start"
                            >
                              <Play size={10} />
                            </button>
                          )}
                          {entry.isLocal && isOnline && (
                            <button
                              onClick={() => void handleRegistryStop(entry.agentId)}
                              disabled={!!loading}
                              style={{ ...btnSecondary, padding: '4px 8px', fontSize: 9, color: 'var(--red-bright)' }}
                              title="Stop"
                            >
                              <Square size={10} />
                            </button>
                          )}
                          <button
                            onClick={() => void handleRegistryTest(entry.agentId)}
                            disabled={!!loading}
                            style={{ ...btnSecondary, padding: '4px 8px', fontSize: 9 }}
                            title="Test Connection"
                          >
                            <Wifi size={10} />
                          </button>
                          <button
                            onClick={() => void handleRegistryCopyEnv(entry.agentId)}
                            style={{ ...btnSecondary, padding: '4px 8px', fontSize: 9 }}
                            title="Copy .env"
                          >
                            <Copy size={10} />
                          </button>
                          <button
                            onClick={() => void handleRegistryRemove(entry.agentId)}
                            disabled={!!loading}
                            style={{ ...btnSecondary, padding: '4px 8px', fontSize: 9, color: 'var(--red-bright)' }}
                            title="Remove"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Helper Components ---

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{
        fontSize: 10,
        fontFamily: 'var(--font-display)',
        letterSpacing: 2,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-white)',
      }}>
        {value}
      </div>
    </div>
  );
}

function StatusLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: ok ? '#00ff41' : '#ff3333',
        boxShadow: ok ? '0 0 8px rgba(0,255,65,0.5)' : '0 0 8px rgba(255,51,51,0.5)',
        display: 'inline-block',
      }} />
      <span style={{
        fontSize: 12,
        fontFamily: 'var(--font-ui)',
        color: ok ? 'var(--green-bright)' : 'var(--red-bright)',
      }}>
        {label}: {ok ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  );
}
