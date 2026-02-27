import { useEffect, useState, useCallback } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  Variable,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  Shield,
  Copy,
  Edit3,
  Check,
  X,
  Server,
  Bot,
  Database,
  Globe,
  Lock,
} from 'lucide-react';

interface EnvVar {
  key: string;
  value: string;
  source: 'runtime' | 'config' | 'default';
  sensitive: boolean;
  category: string;
}

const CATEGORY_CONFIG: Record<string, { color: string; Icon: typeof Server }> = {
  gateway: { color: 'var(--green-bright)', Icon: Server },
  agent: { color: 'var(--cyan-bright)', Icon: Bot },
  database: { color: 'var(--amber)', Icon: Database },
  network: { color: 'var(--purple)', Icon: Globe },
  security: { color: 'var(--red-bright)', Icon: Lock },
  other: { color: 'var(--text-secondary)', Icon: Variable },
};

function categorizeVar(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('nats') || k.includes('redis') || k.includes('nas') || k.includes('db')) return 'database';
  if (k.includes('agent') || k.includes('model') || k.includes('llm')) return 'agent';
  if (k.includes('host') || k.includes('port') || k.includes('url') || k.includes('thunderbolt')) return 'network';
  if (k.includes('token') || k.includes('key') || k.includes('secret') || k.includes('password') || k.includes('auth')) return 'security';
  if (k.includes('jarvis') || k.includes('gateway') || k.includes('tick')) return 'gateway';
  return 'other';
}

function isSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes('token') || k.includes('key') || k.includes('secret') || k.includes('password') || k.includes('api_key');
}

export function EnvironmentView() {
  const connected = useGatewayStore((s) => s.connected);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const fetchEnvVars = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const data = await gateway.request<Record<string, string>>('environment.list');
      const vars: EnvVar[] = Object.entries(data || {}).map(([key, value]) => ({
        key,
        value: String(value),
        source: 'runtime' as const,
        sensitive: isSensitive(key),
        category: categorizeVar(key),
      }));
      vars.sort((a, b) => a.key.localeCompare(b.key));
      setEnvVars(vars);
    } catch {
      // Try fallback - get env from health
      try {
        const health = await gateway.request<{ env?: Record<string, string> }>('health.detailed');
        if (health?.env) {
          const vars: EnvVar[] = Object.entries(health.env).map(([key, value]) => ({
            key,
            value: String(value),
            source: 'runtime' as const,
            sensitive: isSensitive(key),
            category: categorizeVar(key),
          }));
          vars.sort((a, b) => a.key.localeCompare(b.key));
          setEnvVars(vars);
        }
      } catch {
        // Generate from known env vars
        const knownVars = [
          'JARVIS_PORT', 'JARVIS_HOST', 'JARVIS_AUTH_TOKEN', 'JARVIS_NAS_MOUNT',
          'NATS_URL', 'NATS_URL_THUNDERBOLT', 'THUNDERBOLT_ENABLED',
          'REDIS_URL', 'AGENT_ID', 'AGENT_ROLE', 'MACHINE_ID',
          'DEFAULT_MODEL',
        ];
        setEnvVars(knownVars.map((key) => ({
          key,
          value: '(not available)',
          source: 'default' as const,
          sensitive: isSensitive(key),
          category: categorizeVar(key),
        })));
      }
    } finally {
      setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    void fetchEnvVars();
  }, [fetchEnvVars]);

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copyValue = (env: EnvVar) => {
    const isRevealed = revealedKeys.has(env.key);
    const text = env.sensitive && !isRevealed ? maskValue(env.value) : env.value;
    void navigator.clipboard.writeText(text);
  };

  const startEdit = (env: EnvVar) => {
    setEditingKey(env.key);
    setEditValue(env.value);
  };

  const saveEdit = async () => {
    if (!editingKey) return;
    try {
      await gateway.request('environment.set', { key: editingKey, value: editValue });
      setEnvVars((prev) =>
        prev.map((v) => (v.key === editingKey ? { ...v, value: editValue } : v))
      );
      setEditingKey(null);
      setEditValue('');
    } catch {
      /* save failed */
    }
  };

  const addVar = async () => {
    if (!newKey.trim()) return;
    try {
      await gateway.request('environment.set', { key: newKey.trim(), value: newValue });
    } catch { /* ok */ }
    const env: EnvVar = {
      key: newKey.trim(),
      value: newValue,
      source: 'config',
      sensitive: isSensitive(newKey),
      category: categorizeVar(newKey),
    };
    setEnvVars((prev) => [...prev, env].sort((a, b) => a.key.localeCompare(b.key)));
    setNewKey('');
    setNewValue('');
    setShowAdd(false);
  };

  const deleteVar = async (key: string) => {
    try {
      await gateway.request('environment.delete', { key });
    } catch { /* ok */ }
    setEnvVars((prev) => prev.filter((v) => v.key !== key));
  };

  const maskValue = (value: string) => {
    if (value.length <= 8) return '********';
    return value.slice(0, 4) + '****' + value.slice(-4);
  };

  // Filter
  const filtered = envVars.filter((v) => {
    if (categoryFilter !== 'all' && v.category !== categoryFilter) return false;
    if (search && !v.key.toLowerCase().includes(search.toLowerCase()) && !v.value.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Stats
  const categoryCounts = envVars.reduce<Record<string, number>>((acc, v) => {
    acc[v.category] = (acc[v.category] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 16,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Variable size={18} color="var(--cyan-bright)" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 14,
          letterSpacing: 2,
          color: 'var(--cyan-bright)',
          margin: 0,
        }}>
          ENVIRONMENT VARIABLES
        </h1>
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          padding: '2px 8px',
          background: 'var(--bg-tertiary)',
          borderRadius: 4,
        }}>
          {envVars.length} vars
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowAdd(true)}
            style={{ fontSize: 9, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Plus size={10} /> ADD
          </button>
          <button
            onClick={() => void fetchEnvVars()}
            style={{ fontSize: 9, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={10} /> REFRESH
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {Object.entries(categoryCounts).map(([cat, count]) => {
          const cfg = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.other;
          return (
            <div
              key={cat}
              onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                background: categoryFilter === cat ? `${cfg.color}15` : 'var(--bg-secondary)',
                border: `1px solid ${categoryFilter === cat ? `${cfg.color}44` : 'var(--border-dim)'}`,
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <cfg.Icon size={10} color={cfg.color} />
              <span style={{ fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, color: cfg.color, textTransform: 'uppercase' }}>
                {cat}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 12, position: 'relative' }}>
        <Search size={12} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: 9 }} />
        <input
          type="text"
          placeholder="Search variables..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', paddingLeft: 28, fontSize: 11 }}
        />
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{
          padding: 12,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--cyan-dim)',
          borderRadius: 6,
          marginBottom: 12,
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            letterSpacing: 2,
            color: 'var(--cyan-bright)',
            marginBottom: 8,
          }}>
            ADD VARIABLE
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="VARIABLE_NAME"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase())}
              style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
            <input
              type="text"
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              style={{ flex: 2, fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
            <button onClick={() => void addVar()} className="primary" style={{ fontSize: 9, padding: '4px 10px' }}>
              <Check size={10} />
            </button>
            <button onClick={() => setShowAdd(false)} style={{ fontSize: 9, padding: '4px 10px' }}>
              <X size={10} />
            </button>
          </div>
        </div>
      )}

      {/* Security notice */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'rgba(255,170,0,0.05)',
        border: '1px solid rgba(255,170,0,0.15)',
        borderRadius: 4,
        marginBottom: 12,
      }}>
        <Shield size={12} color="var(--amber)" />
        <span style={{ fontSize: 9, color: 'var(--amber)', fontFamily: 'var(--font-ui)', letterSpacing: 0.5 }}>
          Sensitive values are masked. Click the eye icon to reveal. Changes apply to the running gateway process.
        </span>
      </div>

      {/* Variable list */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          Loading environment variables...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filtered.map((env) => {
            const cfg = CATEGORY_CONFIG[env.category] || CATEGORY_CONFIG.other;
            const isRevealed = revealedKeys.has(env.key);
            const isEditing = editingKey === env.key;
            const displayValue = env.sensitive && !isRevealed ? maskValue(env.value) : env.value;

            return (
              <div
                key={env.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  background: isEditing ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                  border: `1px solid ${isEditing ? 'var(--cyan-dim)' : 'var(--border-dim)'}`,
                  borderRadius: 4,
                  transition: 'all 0.15s',
                }}
              >
                {/* Category icon */}
                <cfg.Icon size={12} color={cfg.color} style={{ flexShrink: 0 }} />

                {/* Key */}
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-white)',
                  minWidth: 240,
                  flexShrink: 0,
                }}>
                  {env.key}
                </span>

                {/* Separator */}
                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>=</span>

                {/* Value */}
                {isEditing ? (
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveEdit();
                      if (e.key === 'Escape') setEditingKey(null);
                    }}
                    autoFocus
                    style={{
                      flex: 1,
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      padding: '2px 6px',
                    }}
                  />
                ) : (
                  <span style={{
                    flex: 1,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: env.sensitive && !isRevealed ? 'var(--text-muted)' : 'var(--green-bright)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {displayValue}
                  </span>
                )}

                {/* Source badge */}
                <span style={{
                  fontSize: 7,
                  padding: '1px 4px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-dim)',
                  borderRadius: 2,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-display)',
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  flexShrink: 0,
                }}>
                  {env.source}
                </span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  {env.sensitive && (
                    <button
                      onClick={() => toggleReveal(env.key)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        color: isRevealed ? 'var(--amber)' : 'var(--text-muted)',
                      }}
                    >
                      {isRevealed ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  )}
                  <button
                    onClick={() => copyValue(env)}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      padding: 3,
                      borderRadius: 3,
                      display: 'flex',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <Copy size={11} />
                  </button>
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => void saveEdit()}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          padding: 3,
                          borderRadius: 3,
                          display: 'flex',
                          color: 'var(--green-bright)',
                        }}
                      >
                        <Check size={11} />
                      </button>
                      <button
                        onClick={() => setEditingKey(null)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          padding: 3,
                          borderRadius: 3,
                          display: 'flex',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <X size={11} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => startEdit(env)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <Edit3 size={11} />
                    </button>
                  )}
                  {env.source !== 'runtime' && (
                    <button
                      onClick={() => void deleteVar(env.key)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        color: 'var(--red-dim)',
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
              {search ? 'No variables match your search' : 'No environment variables found'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
