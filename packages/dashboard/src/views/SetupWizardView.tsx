/**
 * SetupWizardView — Automated SSH + Remote Agent Deployment Wizard
 *
 * 4-step wizard with 2 slots (Smith/Dev, Johny/Marketing):
 * 1. Master Check — verify NATS/Redis/Gateway
 * 2. Configure Agents — form with IP, SSH user, SSH password per slot
 * 3. Deploy — automated: keygen → deploy key → test SSH → git clone → pnpm install → .env → start
 * 4. Verify — confirm both agents online + VNC
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  Server,
  Shield,
  Rocket,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronLeft,
  Wifi,
  RefreshCw,
  Settings,
  Loader,
  Eye,
  EyeOff,
  Zap,
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

interface WizardStatus {
  setupComplete: boolean;
  sshKeyExists: boolean;
  smith: { agentId: string; role: string; slot: string; online: boolean; status: string };
  johny: { agentId: string; role: string; slot: string; online: boolean; status: string };
}

interface SlotConfig {
  ip: string;
  sshUser: string;
  sshPassword: string;
}

interface NetworkMachine {
  ip: string;
  hostname: string;
}

type DeployStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface DeployStep {
  id: string;
  label: string;
  status: DeployStepStatus;
  message: string;
}

const DEPLOY_STEPS: { id: string; label: string }[] = [
  { id: 'ssh.generateKey', label: 'Generate SSH Key' },
  { id: 'ssh.deployKey', label: 'Deploy SSH Key' },
  { id: 'ssh.testPasswordless', label: 'Test Passwordless SSH' },
  { id: 'remote.install', label: 'Install Repository' },
  { id: 'remote.deployEnv', label: 'Deploy .env Config' },
  { id: 'remote.startServices', label: 'Start Services' },
];

function makeDeploySteps(): DeployStep[] {
  return DEPLOY_STEPS.map((s) => ({ ...s, status: 'pending' as const, message: '' }));
}

// --- Main Component ---

export function SetupWizardView() {
  const connected = useGatewayStore((s) => s.connected);
  const agents = useGatewayStore((s) => s.agents);
  const [step, setStep] = useState(1);

  // Step 1 state
  const [masterInfo, setMasterInfo] = useState<MasterInfo | null>(null);
  const [wizardStatus, setWizardStatus] = useState<WizardStatus | null>(null);
  const [loadingMaster, setLoadingMaster] = useState(false);

  // Step 2 state
  const [smithConfig, setSmithConfig] = useState<SlotConfig>({ ip: '', sshUser: '', sshPassword: '' });
  const [johnyConfig, setJohnyConfig] = useState<SlotConfig>({ ip: '', sshUser: '', sshPassword: '' });
  const [networkMachines, setNetworkMachines] = useState<NetworkMachine[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showSmithPass, setShowSmithPass] = useState(false);
  const [showJohnyPass, setShowJohnyPass] = useState(false);

  // Step 3 state
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState('');
  const [smithSteps, setSmithSteps] = useState<DeployStep[]>(makeDeploySteps());
  const [johnySteps, setJohnySteps] = useState<DeployStep[]>(makeDeploySteps());
  const [keygenStep, setKeygenStep] = useState<DeployStep>({ id: 'ssh.generateKey', label: 'Generate SSH Key (shared)', status: 'pending', message: '' });
  const deployAbortRef = useRef(false);

  const navigate = useNavigate();

  // --- Fetch master info & wizard status ---
  const fetchStatus = useCallback(async () => {
    if (!connected) return;
    setLoadingMaster(true);
    try {
      const info = await gateway.request<MasterInfo>('setup.master.info');
      setMasterInfo(info);
    } catch { /* ignore */ }
    try {
      const status = await gateway.request<WizardStatus>('setup.wizard.status');
      setWizardStatus(status);
    } catch { /* ignore */ }
    setLoadingMaster(false);
  }, [connected]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Listen for progress events
  useEffect(() => {
    const unsub = gateway.on('setup.progress', (payload) => {
      const p = payload as { step: string; status: DeployStepStatus; message: string; slot: string | null };

      // Shared keygen step
      if (p.step === 'ssh.generateKey' && !p.slot) {
        setKeygenStep((prev) => ({ ...prev, status: p.status, message: p.message }));
        return;
      }

      const updateSteps = (prev: DeployStep[]): DeployStep[] =>
        prev.map((s) => s.id === p.step ? { ...s, status: p.status, message: p.message } : s);

      if (p.slot === 'smith') setSmithSteps(updateSteps);
      else if (p.slot === 'johny') setJohnySteps(updateSteps);
    });
    return () => unsub();
  }, []);

  // --- Handlers ---

  const handleNetworkScan = async () => {
    setScanning(true);
    try {
      const machines = await gateway.request<NetworkMachine[]>('setup.network.scan');
      setNetworkMachines(machines || []);
    } catch { /* ignore */ }
    setScanning(false);
  };

  const updateSlotStep = (slot: 'smith' | 'johny', stepId: string, status: DeployStepStatus, message: string) => {
    const updater = (prev: DeployStep[]): DeployStep[] =>
      prev.map((s) => s.id === stepId ? { ...s, status, message } : s);
    if (slot === 'smith') setSmithSteps(updater);
    else setJohnySteps(updater);
  };

  const deploySlot = async (
    slot: 'smith' | 'johny',
    config: SlotConfig,
    agentId: string,
    role: string,
  ) => {
    if (deployAbortRef.current) return;

    // Step: Deploy SSH Key
    updateSlotStep(slot, 'ssh.deployKey', 'running', `Deploying key to ${config.sshUser}@${config.ip}...`);
    try {
      await gateway.request('setup.ssh.deployKey', {
        ip: config.ip, sshUser: config.sshUser, sshPassword: config.sshPassword, slot,
      });
      updateSlotStep(slot, 'ssh.deployKey', 'done', 'SSH key deployed');
    } catch (err) {
      updateSlotStep(slot, 'ssh.deployKey', 'failed', (err as Error).message);
      throw err;
    }

    if (deployAbortRef.current) return;

    // Step: Test Passwordless SSH
    updateSlotStep(slot, 'ssh.testPasswordless', 'running', 'Testing passwordless SSH...');
    try {
      await gateway.request('setup.ssh.testPasswordless', {
        ip: config.ip, sshUser: config.sshUser, slot,
      });
      updateSlotStep(slot, 'ssh.testPasswordless', 'done', 'Passwordless SSH works');
    } catch (err) {
      updateSlotStep(slot, 'ssh.testPasswordless', 'failed', (err as Error).message);
      throw err;
    }

    if (deployAbortRef.current) return;

    // Step: Install Repository
    updateSlotStep(slot, 'remote.install', 'running', 'Installing repository...');
    try {
      await gateway.request('setup.remote.install', {
        ip: config.ip, sshUser: config.sshUser, slot,
      });
      updateSlotStep(slot, 'remote.install', 'done', 'Repository installed');
    } catch (err) {
      updateSlotStep(slot, 'remote.install', 'failed', (err as Error).message);
      throw err;
    }

    if (deployAbortRef.current) return;

    // Step: Deploy .env
    updateSlotStep(slot, 'remote.deployEnv', 'running', 'Deploying .env config...');
    try {
      await gateway.request('setup.remote.deployEnv', {
        ip: config.ip, sshUser: config.sshUser, slot, agentId, role,
      });
      updateSlotStep(slot, 'remote.deployEnv', 'done', '.env deployed');
    } catch (err) {
      updateSlotStep(slot, 'remote.deployEnv', 'failed', (err as Error).message);
      throw err;
    }

    if (deployAbortRef.current) return;

    // Step: Start Services
    updateSlotStep(slot, 'remote.startServices', 'running', 'Starting services...');
    try {
      await gateway.request('setup.remote.startServices', {
        ip: config.ip, sshUser: config.sshUser, slot, agentId,
      });
      updateSlotStep(slot, 'remote.startServices', 'done', 'Services started');
    } catch (err) {
      updateSlotStep(slot, 'remote.startServices', 'failed', (err as Error).message);
      throw err;
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployError('');
    deployAbortRef.current = false;
    setSmithSteps(makeDeploySteps());
    setJohnySteps(makeDeploySteps());
    setKeygenStep({ id: 'ssh.generateKey', label: 'Generate SSH Key (shared)', status: 'pending', message: '' });

    try {
      // 1. Shared keygen
      setKeygenStep((p) => ({ ...p, status: 'running', message: 'Generating SSH key...' }));
      await gateway.request('setup.ssh.generateKey');
      setKeygenStep((p) => ({ ...p, status: 'done', message: 'SSH key ready' }));

      // 2. Deploy Smith (agent-smith / dev)
      if (smithConfig.ip && smithConfig.sshUser && smithConfig.sshPassword) {
        await deploySlot('smith', smithConfig, 'agent-smith', 'dev');
      } else {
        setSmithSteps((prev) => prev.map((s) => s.id === 'ssh.generateKey' ? s : { ...s, status: 'skipped', message: 'No config provided' }));
      }

      // 3. Deploy Johny (agent-johny / marketing)
      if (johnyConfig.ip && johnyConfig.sshUser && johnyConfig.sshPassword) {
        await deploySlot('johny', johnyConfig, 'agent-johny', 'marketing');
      } else {
        setJohnySteps((prev) => prev.map((s) => s.id === 'ssh.generateKey' ? s : { ...s, status: 'skipped', message: 'No config provided' }));
      }

      // Move to verify step
      setStep(4);
      // Refresh status
      void fetchStatus();
    } catch (err) {
      setDeployError((err as Error).message);
    }
    setDeploying(false);
  };

  // --- Styles (reused from original) ---

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

  const stepIndicatorSteps = [
    { num: 1, label: 'Master Check', icon: Server },
    { num: 2, label: 'Configure Agents', icon: Settings },
    { num: 3, label: 'Deploy', icon: Rocket },
    { num: 4, label: 'Verify', icon: Shield },
  ];

  // Can only navigate forward if fields are filled
  const canProceedToStep3 = (smithConfig.ip && smithConfig.sshUser && smithConfig.sshPassword) ||
    (johnyConfig.ip && johnyConfig.sshUser && johnyConfig.sshPassword);

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
            Automated SSH configuration &amp; remote agent deployment
          </p>
        </div>
        <button onClick={() => void fetchStatus()} style={btnSecondary} title="Refresh">
          <RefreshCw size={14} />
          REFRESH
        </button>
      </div>

      {/* Step Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 28 }}>
        {stepIndicatorSteps.map(({ num, label, icon: Icon }, i) => (
          <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => { if (!deploying) setStep(num); }}
              disabled={deploying}
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
                cursor: deploying ? 'default' : 'pointer',
                textTransform: 'uppercase',
                opacity: deploying && step !== num ? 0.5 : 1,
              }}
            >
              <Icon size={14} />
              {label}
            </button>
            {i < stepIndicatorSteps.length - 1 && <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
          </div>
        ))}
      </div>

      {/* ========== STEP 1: Master Check ========== */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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

          {/* Agents quick view */}
          <div style={panelStyle}>
            <div style={{ ...labelStyle, marginBottom: 12 }}>
              AGENTS STATUS
            </div>
            {wizardStatus ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <AgentStatusCard
                  label="SMITH"
                  agentId={wizardStatus.smith.agentId}
                  role={wizardStatus.smith.role}
                  online={wizardStatus.smith.online}
                  status={wizardStatus.smith.status}
                  color="var(--green-bright)"
                />
                <AgentStatusCard
                  label="JOHNY"
                  agentId={wizardStatus.johny.agentId}
                  role={wizardStatus.johny.role}
                  online={wizardStatus.johny.online}
                  status={wizardStatus.johny.status}
                  color="var(--cyan-bright)"
                />
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
                No agents configured yet.
              </div>
            )}

            {wizardStatus && (
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={statusDot(wizardStatus.sshKeyExists)} />
                <span style={{ fontSize: 12, fontFamily: 'var(--font-ui)', color: wizardStatus.sshKeyExists ? 'var(--green-bright)' : 'var(--text-muted)' }}>
                  SSH Key: {wizardStatus.sshKeyExists ? 'Exists' : 'Not generated'}
                </span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setStep(2)} style={btnPrimary}>
              NEXT: CONFIGURE AGENTS
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ========== STEP 2: Configure Agents ========== */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Two-column layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Smith slot */}
            <div style={{
              ...panelStyle,
              borderColor: 'rgba(0,255,65,0.25)',
              background: 'rgba(0,255,65,0.02)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green-bright)', boxShadow: '0 0 8px rgba(0,255,65,0.5)', display: 'inline-block' }} />
                <span style={{ ...labelStyle, margin: 0, color: 'var(--green-bright)' }}>SMITH</span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}>
                  Agent: <strong style={{ color: 'var(--text-white)' }}>agent-smith</strong> / Role: <strong style={{ color: 'var(--text-white)' }}>dev</strong>
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={labelStyle}>IP ADDRESS</div>
                  <input
                    value={smithConfig.ip}
                    onChange={(e) => setSmithConfig((p) => ({ ...p, ip: e.target.value }))}
                    placeholder="e.g. 192.168.1.37"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={labelStyle}>SSH USER</div>
                  <input
                    value={smithConfig.sshUser}
                    onChange={(e) => setSmithConfig((p) => ({ ...p, sshUser: e.target.value }))}
                    placeholder="e.g. agent_smith"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={labelStyle}>SSH PASSWORD</div>
                    <button
                      onClick={() => setShowSmithPass(!showSmithPass)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                    >
                      {showSmithPass ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <input
                    type={showSmithPass ? 'text' : 'password'}
                    value={smithConfig.sshPassword}
                    onChange={(e) => setSmithConfig((p) => ({ ...p, sshPassword: e.target.value }))}
                    placeholder="One-time use for key deploy"
                    style={inputStyle}
                  />
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', marginTop: 4 }}>
                    Used once via sshpass — never stored
                  </div>
                </div>
              </div>
            </div>

            {/* Johny slot */}
            <div style={{
              ...panelStyle,
              borderColor: 'rgba(0,200,255,0.25)',
              background: 'rgba(0,200,255,0.02)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--cyan-bright)', boxShadow: '0 0 8px rgba(0,200,255,0.5)', display: 'inline-block' }} />
                <span style={{ ...labelStyle, margin: 0, color: 'var(--cyan-bright)' }}>JOHNY</span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}>
                  Agent: <strong style={{ color: 'var(--text-white)' }}>agent-johny</strong> / Role: <strong style={{ color: 'var(--text-white)' }}>marketing</strong>
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={labelStyle}>IP ADDRESS</div>
                  <input
                    value={johnyConfig.ip}
                    onChange={(e) => setJohnyConfig((p) => ({ ...p, ip: e.target.value }))}
                    placeholder="e.g. 192.168.1.32"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={labelStyle}>SSH USER</div>
                  <input
                    value={johnyConfig.sshUser}
                    onChange={(e) => setJohnyConfig((p) => ({ ...p, sshUser: e.target.value }))}
                    placeholder="e.g. agent_johny"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={labelStyle}>SSH PASSWORD</div>
                    <button
                      onClick={() => setShowJohnyPass(!showJohnyPass)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                    >
                      {showJohnyPass ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <input
                    type={showJohnyPass ? 'text' : 'password'}
                    value={johnyConfig.sshPassword}
                    onChange={(e) => setJohnyConfig((p) => ({ ...p, sshPassword: e.target.value }))}
                    placeholder="One-time use for key deploy"
                    style={inputStyle}
                  />
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', marginTop: 4 }}>
                    Used once via sshpass — never stored
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Network scan */}
          <div style={panelStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={labelStyle}>NETWORK SCAN</div>
              <button onClick={() => void handleNetworkScan()} style={btnSecondary} disabled={scanning}>
                <Wifi size={12} />
                {scanning ? 'SCANNING...' : 'SCAN NETWORK'}
              </button>
            </div>
            {networkMachines.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {networkMachines.map((m) => (
                  <div key={m.ip} style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => setSmithConfig((p) => ({ ...p, ip: m.ip }))}
                      style={{ ...btnSecondary, padding: '4px 8px', fontSize: 10 }}
                      title="Set as Smith IP"
                    >
                      S
                    </button>
                    <button
                      onClick={() => setJohnyConfig((p) => ({ ...p, ip: m.ip }))}
                      style={{ ...btnSecondary, padding: '4px 8px', fontSize: 10 }}
                      title="Set as Johny IP"
                    >
                      J
                    </button>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', padding: '4px 8px', display: 'flex', alignItems: 'center' }}>
                      {m.hostname} ({m.ip})
                    </span>
                  </div>
                ))}
              </div>
            )}
            {networkMachines.length === 0 && !scanning && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
                Click "Scan Network" to discover machines on your local network.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(1)} style={btnSecondary}>
              <ChevronLeft size={14} />
              BACK
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!canProceedToStep3}
              style={{
                ...btnPrimary,
                opacity: canProceedToStep3 ? 1 : 0.4,
                cursor: canProceedToStep3 ? 'pointer' : 'not-allowed',
              }}
            >
              NEXT: DEPLOY
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ========== STEP 3: Deploy ========== */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Shared keygen step */}
          <div style={panelStyle}>
            <div style={{ ...labelStyle, marginBottom: 12 }}>SSH KEY GENERATION (SHARED)</div>
            <DeployStepRow step={keygenStep} />
          </div>

          {/* Two-column deploy progress */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Smith deploy */}
            <div style={{
              ...panelStyle,
              borderColor: 'rgba(0,255,65,0.25)',
              background: 'rgba(0,255,65,0.02)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green-bright)', boxShadow: '0 0 8px rgba(0,255,65,0.5)', display: 'inline-block' }} />
                <span style={{ ...labelStyle, margin: 0, color: 'var(--green-bright)' }}>
                  SMITH — agent-smith
                </span>
                {smithConfig.ip && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    ({smithConfig.sshUser}@{smithConfig.ip})
                  </span>
                )}
              </div>
              {!smithConfig.ip ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
                  Not configured — will be skipped
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {smithSteps.filter((s) => s.id !== 'ssh.generateKey').map((s) => (
                    <DeployStepRow key={s.id} step={s} />
                  ))}
                </div>
              )}
            </div>

            {/* Johny deploy */}
            <div style={{
              ...panelStyle,
              borderColor: 'rgba(0,200,255,0.25)',
              background: 'rgba(0,200,255,0.02)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--cyan-bright)', boxShadow: '0 0 8px rgba(0,200,255,0.5)', display: 'inline-block' }} />
                <span style={{ ...labelStyle, margin: 0, color: 'var(--cyan-bright)' }}>
                  JOHNY — agent-johny
                </span>
                {johnyConfig.ip && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    ({johnyConfig.sshUser}@{johnyConfig.ip})
                  </span>
                )}
              </div>
              {!johnyConfig.ip ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
                  Not configured — will be skipped
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {johnySteps.filter((s) => s.id !== 'ssh.generateKey').map((s) => (
                    <DeployStepRow key={s.id} step={s} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {deployError && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(255,51,51,0.06)',
              border: '1px solid rgba(255,51,51,0.2)',
              borderRadius: 8,
              fontSize: 12,
              fontFamily: 'var(--font-ui)',
              color: 'var(--red-bright)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <XCircle size={14} />
              {deployError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => { if (!deploying) setStep(2); }} style={btnSecondary} disabled={deploying}>
              <ChevronLeft size={14} />
              BACK
            </button>
            <div style={{ display: 'flex', gap: 12 }}>
              {deploying && (
                <button
                  onClick={() => { deployAbortRef.current = true; }}
                  style={{ ...btnSecondary, color: 'var(--red-bright)', borderColor: 'rgba(255,51,51,0.3)' }}
                >
                  ABORT
                </button>
              )}
              <button
                onClick={() => void handleDeploy()}
                disabled={deploying || !canProceedToStep3}
                style={{
                  ...btnPrimary,
                  opacity: deploying ? 0.6 : 1,
                  cursor: deploying ? 'wait' : 'pointer',
                }}
              >
                {deploying ? (
                  <>
                    <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    DEPLOYING...
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    START DEPLOY
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== STEP 4: Verify ========== */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={panelStyle}>
            <div style={{ ...labelStyle, marginBottom: 16 }}>DEPLOYMENT VERIFICATION</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Smith verification */}
              <VerifyCard
                label="SMITH"
                agentId="agent-smith"
                role="dev"
                color="var(--green-bright)"
                agents={agents}
                wizardStatus={wizardStatus}
                slotKey="smith"
              />
              {/* Johny verification */}
              <VerifyCard
                label="JOHNY"
                agentId="agent-johny"
                role="marketing"
                color="var(--cyan-bright)"
                agents={agents}
                wizardStatus={wizardStatus}
                slotKey="johny"
              />
            </div>
          </div>

          {/* Overall status */}
          <div style={panelStyle}>
            <div style={{ ...labelStyle, marginBottom: 12 }}>OVERALL STATUS</div>
            {(() => {
              const smithOnline = agents.get('agent-smith')?.status !== 'offline' && agents.has('agent-smith');
              const johnyOnline = agents.get('agent-johny')?.status !== 'offline' && agents.has('agent-johny');
              const allOnline = smithOnline && johnyOnline;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={statusDot(smithOnline)} />
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-ui)', color: smithOnline ? 'var(--green-bright)' : 'var(--text-muted)' }}>
                      Smith (agent-smith): {smithOnline ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={statusDot(johnyOnline)} />
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-ui)', color: johnyOnline ? 'var(--green-bright)' : 'var(--text-muted)' }}>
                      Johny (agent-johny): {johnyOnline ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>

                  {allOnline && (
                    <div style={{
                      marginTop: 8,
                      padding: '12px 16px',
                      background: 'rgba(0,255,65,0.06)',
                      border: '1px solid rgba(0,255,65,0.2)',
                      borderRadius: 8,
                      fontSize: 13,
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      letterSpacing: 1,
                      color: 'var(--green-bright)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <CheckCircle2 size={16} />
                      All agents online! Setup complete.
                    </div>
                  )}

                  {!allOnline && (
                    <div style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-ui)',
                    }}>
                      Agents may take 10-30 seconds to come online after deployment. Click Refresh to check status.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(3)} style={btnSecondary}>
              <ChevronLeft size={14} />
              BACK TO DEPLOY
            </button>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => void fetchStatus()} style={btnSecondary}>
                <RefreshCw size={14} />
                REFRESH STATUS
              </button>
              <button onClick={() => navigate('/')} style={btnPrimary}>
                DONE — GO TO DASHBOARD
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
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

function AgentStatusCard({ label, agentId, role, online, status, color }: {
  label: string; agentId: string; role: string; online: boolean; status: string; color: string;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 18px',
      background: 'rgba(0,0,0,0.2)',
      border: `1px solid ${online ? `${color}33` : 'var(--border-primary)'}`,
      borderRadius: 8,
      flex: 1,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: online ? '#00ff41' : '#ff3333',
        boxShadow: online ? '0 0 8px rgba(0,255,65,0.5)' : '0 0 8px rgba(255,51,51,0.5)',
        display: 'inline-block',
      }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: 1.5, color }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-white)', fontFamily: 'var(--font-ui)' }}>
          {agentId} / {role}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
          {status.toUpperCase()}
        </div>
      </div>
    </div>
  );
}

function DeployStepRow({ step }: { step: DeployStep }) {
  const iconMap: Record<DeployStepStatus, React.ReactNode> = {
    pending: <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-primary)', display: 'inline-block' }} />,
    running: <Loader size={14} style={{ color: 'var(--cyan-bright)', animation: 'spin 1s linear infinite' }} />,
    done: <CheckCircle2 size={14} style={{ color: 'var(--green-bright)' }} />,
    failed: <XCircle size={14} style={{ color: 'var(--red-bright)' }} />,
    skipped: <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--border-primary)', display: 'inline-block', opacity: 0.5 }} />,
  };

  const colorMap: Record<DeployStepStatus, string> = {
    pending: 'var(--text-muted)',
    running: 'var(--cyan-bright)',
    done: 'var(--green-bright)',
    failed: 'var(--red-bright)',
    skipped: 'var(--text-muted)',
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 12px',
      background: step.status === 'running' ? 'rgba(0,200,255,0.04)' : step.status === 'failed' ? 'rgba(255,51,51,0.04)' : 'transparent',
      borderRadius: 6,
      transition: 'background 0.2s',
    }}>
      {iconMap[step.status]}
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 12,
          fontFamily: 'var(--font-ui)',
          fontWeight: 600,
          color: colorMap[step.status],
        }}>
          {step.label}
        </div>
        {step.message && (
          <div style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            marginTop: 2,
          }}>
            {step.message}
          </div>
        )}
      </div>
    </div>
  );
}

function VerifyCard({ label, agentId, role, color, agents, wizardStatus, slotKey }: {
  label: string;
  agentId: string;
  role: string;
  color: string;
  agents: Map<string, { identity: { agentId: string; role: string; machineId: string; hostname: string }; status: string }>;
  wizardStatus: WizardStatus | null;
  slotKey: 'smith' | 'johny';
}) {
  const agentState = agents.get(agentId);
  const online = agentState ? agentState.status !== 'offline' : false;
  const statusFromWizard = wizardStatus?.[slotKey];

  return (
    <div style={{
      padding: 20,
      background: 'rgba(0,0,0,0.2)',
      border: `1px solid ${online ? `${color}33` : 'var(--border-primary)'}`,
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: color,
          boxShadow: `0 0 8px ${color}80`,
          display: 'inline-block',
        }} />
        <span style={{
          fontSize: 12,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          letterSpacing: 1.5,
          color,
        }}>
          {label}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--font-ui)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Agent ID</span>
          <span style={{ color: 'var(--text-white)', fontFamily: 'var(--font-mono)' }}>{agentId}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--font-ui)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Role</span>
          <span style={{ color: 'var(--text-white)' }}>{role}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--font-ui)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Status</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: online ? '#00ff41' : '#ff3333',
              boxShadow: online ? '0 0 6px rgba(0,255,65,0.5)' : 'none',
              display: 'inline-block',
            }} />
            <span style={{ color: online ? 'var(--green-bright)' : 'var(--red-bright)' }}>
              {agentState?.status?.toUpperCase() ?? statusFromWizard?.status?.toUpperCase() ?? 'UNKNOWN'}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
