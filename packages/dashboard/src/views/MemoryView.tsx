/**
 * MemoryView — Long-term Memory Browser & Knowledge Base
 *
 * Inspired by OpenClaw's memory system.
 * Browse MEMORY.md, daily notes, knowledge entries, and search across all memory.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Search,
  Calendar,
  Database,
  Plus,
  Trash2,
  RefreshCw,
  Save,
  BookOpen,
  ChevronRight,
  Clock,
  HardDrive,
  Edit3,
  X,
  Check,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';
import { formatBytes } from '../utils/formatters.js';

/* ─── types ─── */

interface MemoryStatus {
  coreMemory: { file: string; lines: number; sizeBytes: number };
  dailyNotes: { count: number; directory: string };
  knowledgeEntries: { count: number; directory: string };
  backend: string;
  searchType: string;
}

interface MemoryFile {
  name: string;
  type: 'core' | 'daily';
  sizeBytes: number;
  modifiedAt: string;
}

interface SearchResult {
  source: string;
  line?: number;
  text: string;
  content?: string;
  type: 'core' | 'daily' | 'entry';
  tags?: string[];
}

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
}

/* ─── constants ─── */

const TABS = ['Overview', 'Core Memory', 'Daily Notes', 'Knowledge Base', 'Search'] as const;
type Tab = (typeof TABS)[number];

/* ─── styles ─── */

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  padding: 16,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-dim)',
  borderRadius: 6,
  padding: 12,
};

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 11,
  fontFamily: 'var(--font-ui)',
  fontWeight: 600,
  letterSpacing: 0.5,
  border: '1px solid var(--border-primary)',
  borderRadius: 4,
  background: 'var(--bg-tertiary)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const btnPrimary: React.CSSProperties = {
  ...btnStyle,
  background: 'rgba(0,255,65,0.1)',
  border: '1px solid var(--green-primary)',
  color: 'var(--green-bright)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 4,
  color: 'var(--text-primary)',
  outline: 'none',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 9,
  fontFamily: 'var(--font-ui)',
  fontWeight: 600,
  letterSpacing: 0.5,
  borderRadius: 3,
  background: 'rgba(0,200,255,0.1)',
  border: '1px solid rgba(0,200,255,0.2)',
  color: 'var(--cyan-bright)',
};

/* ─── Component ─── */

export function MemoryView() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [loading, setLoading] = useState(false);

  // Core memory
  const [coreContent, setCoreContent] = useState('');
  const [coreEditing, setCoreEditing] = useState(false);
  const [coreDraft, setCoreDraft] = useState('');

  // Daily notes
  const [selectedDaily, setSelectedDaily] = useState<string | null>(null);
  const [dailyContent, setDailyContent] = useState('');

  // Knowledge entries
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);

  // Save memory
  const [saveContent, setSaveContent] = useState('');
  const [saveCategory, setSaveCategory] = useState<'core' | 'daily'>('daily');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, f, e] = await Promise.all([
        gateway.request('memory.status', {}) as Promise<MemoryStatus>,
        gateway.request('memory.list', {}) as Promise<{ files: MemoryFile[] }>,
        gateway.request('memory.entries', {}) as Promise<{ entries: KnowledgeEntry[]; total: number }>,
      ]);
      setStatus(s);
      setFiles(f.files);
      setEntries(e.entries);
    } catch (err) {
      console.error('Failed to load memory', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadCoreMemory = useCallback(async () => {
    try {
      const result = await gateway.request('memory.read', { file: 'MEMORY.md' }) as { content?: string; error?: string };
      if (result.content) {
        setCoreContent(result.content);
        setCoreDraft(result.content);
      }
    } catch (err) {
      console.error('Failed to load core memory', err);
    }
  }, []);

  useEffect(() => {
    if (tab === 'Core Memory') loadCoreMemory();
  }, [tab, loadCoreMemory]);

  const loadDaily = useCallback(async (name: string) => {
    setSelectedDaily(name);
    try {
      const result = await gateway.request('memory.read', { file: name }) as { content?: string; error?: string };
      setDailyContent(result.content ?? result.error ?? '');
    } catch (err) {
      setDailyContent(`Error: ${err}`);
    }
  }, []);

  const doSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const result = await gateway.request('memory.search', { query: searchQuery, maxResults: 50 }) as { results: SearchResult[]; total: number };
      setSearchResults(result.results);
      setSearchTotal(result.total);
    } catch (err) {
      console.error('Search failed', err);
    }
    setLoading(false);
  }, [searchQuery]);

  const saveMem = useCallback(async () => {
    if (!saveContent.trim()) return;
    try {
      await gateway.request('memory.save', { content: saveContent, category: saveCategory });
      setSaveContent('');
      refresh();
    } catch (err) {
      console.error('Save failed', err);
    }
  }, [saveContent, saveCategory, refresh]);

  const saveEntry = useCallback(async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
      await gateway.request('memory.entry.save', {
        title: newTitle,
        content: newContent,
        tags: newTags.split(',').map(t => t.trim()).filter(Boolean),
        source: 'dashboard',
      });
      setNewTitle('');
      setNewContent('');
      setNewTags('');
      setShowNewEntry(false);
      refresh();
    } catch (err) {
      console.error('Save entry failed', err);
    }
  }, [newTitle, newContent, newTags, refresh]);

  const deleteEntry = useCallback(async (id: string) => {
    try {
      await gateway.request('memory.entry.delete', { id });
      refresh();
    } catch (err) {
      console.error('Delete entry failed', err);
    }
  }, [refresh]);

  const dailyFiles = files.filter(f => f.type === 'daily');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid var(--border-primary)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Brain size={20} color="var(--cyan-bright)" />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: 2,
            color: 'var(--cyan-bright)',
            textShadow: 'var(--glow-cyan)',
          }}>
            MEMORY
          </span>
          {status && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
              {status.coreMemory.lines} lines / {dailyFiles.length} daily / {entries.length} entries
            </span>
          )}
        </div>
        <button onClick={refresh} style={btnStyle} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} /> REFRESH
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        padding: '0 20px',
        borderBottom: '1px solid var(--border-primary)',
        flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 16px',
              fontSize: 11,
              fontFamily: 'var(--font-ui)',
              fontWeight: 600,
              letterSpacing: 0.5,
              color: tab === t ? 'var(--cyan-bright)' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--cyan-bright)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

        {/* ─── Overview Tab ─── */}
        {tab === 'Overview' && status && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <StatCard icon={<BookOpen size={16} />} label="Core Memory" value={`${status.coreMemory.lines} lines`} sub={formatBytes(status.coreMemory.sizeBytes)} color="var(--green-bright)" />
              <StatCard icon={<Calendar size={16} />} label="Daily Notes" value={`${status.dailyNotes.count} files`} sub="knowledge/memory/" color="var(--cyan-bright)" />
              <StatCard icon={<Database size={16} />} label="Knowledge Entries" value={`${status.knowledgeEntries.count} entries`} sub="knowledge/entries/" color="var(--yellow, #f0c040)" />
              <StatCard icon={<HardDrive size={16} />} label="Backend" value={status.backend} sub={status.searchType} color="var(--text-secondary)" />
            </div>

            {/* Quick Save */}
            <div style={panelStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Plus size={14} color="var(--green-bright)" />
                <span style={{ fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 1, color: 'var(--green-bright)' }}>
                  QUICK SAVE TO MEMORY
                </span>
              </div>
              <textarea
                value={saveContent}
                onChange={e => setSaveContent(e.target.value)}
                placeholder="Type something to remember..."
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={saveCategory}
                  onChange={e => setSaveCategory(e.target.value as 'core' | 'daily')}
                  style={{ ...inputStyle, width: 160 }}
                >
                  <option value="daily">Daily Note</option>
                  <option value="core">Core Memory (MEMORY.md)</option>
                </select>
                <button onClick={saveMem} style={btnPrimary} disabled={!saveContent.trim()}>
                  <Save size={12} /> SAVE
                </button>
              </div>
            </div>

            {/* Quick Search */}
            <div style={panelStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Search size={14} color="var(--cyan-bright)" />
                <span style={{ fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 1, color: 'var(--cyan-bright)' }}>
                  QUICK SEARCH
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="Search across all memory..."
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={doSearch} style={btnPrimary} disabled={!searchQuery.trim()}>
                  <Search size={12} /> SEARCH
                </button>
              </div>
              {searchResults.length > 0 && (
                <div style={{ marginTop: 12, maxHeight: 200, overflow: 'auto' }}>
                  {searchResults.slice(0, 10).map((r, i) => (
                    <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-dim)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ ...tagStyle, background: r.type === 'core' ? 'rgba(0,255,65,0.1)' : r.type === 'entry' ? 'rgba(240,192,64,0.1)' : 'rgba(0,200,255,0.1)', color: r.type === 'core' ? 'var(--green-bright)' : r.type === 'entry' ? '#f0c040' : 'var(--cyan-bright)', border: 'none', flexShrink: 0 }}>
                        {r.type}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, minWidth: 80 }}>{r.source}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{r.text}</span>
                    </div>
                  ))}
                  {searchTotal > 10 && (
                    <div style={{ padding: '8px 0', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
                      Showing 10 of {searchTotal} results &mdash; <button onClick={() => setTab('Search')} style={{ background: 'none', border: 'none', color: 'var(--cyan-bright)', cursor: 'pointer', fontSize: 10 }}>View all</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Recent Files */}
            <div style={panelStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Clock size={14} color="var(--text-secondary)" />
                <span style={{ fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 1, color: 'var(--text-secondary)' }}>
                  RECENT FILES
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {files.slice(0, 8).map(f => (
                  <div
                    key={f.name}
                    onClick={() => {
                      if (f.type === 'core') { setTab('Core Memory'); }
                      else { setTab('Daily Notes'); loadDaily(f.name); }
                    }}
                    style={{
                      ...cardStyle,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {f.type === 'core' ? <BookOpen size={12} color="var(--green-bright)" /> : <Calendar size={12} color="var(--cyan-bright)" />}
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{f.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{formatBytes(f.sizeBytes)}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{new Date(f.modifiedAt).toLocaleDateString()}</span>
                      <ChevronRight size={12} color="var(--text-muted)" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── Core Memory Tab ─── */}
        {tab === 'Core Memory' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <BookOpen size={16} color="var(--green-bright)" />
                <span style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 1, color: 'var(--green-bright)' }}>MEMORY.md</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Long-term core memory</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {coreEditing ? (
                  <>
                    <button onClick={() => { setCoreEditing(false); setCoreDraft(coreContent); }} style={btnStyle}><X size={12} /> CANCEL</button>
                    <button onClick={async () => {
                      // Save full overwrite — write the whole draft as new content
                      try {
                        await gateway.request('memory.save', { content: coreDraft, category: 'core' });
                        setCoreContent(coreDraft);
                        setCoreEditing(false);
                        refresh();
                      } catch (err) { console.error(err); }
                    }} style={btnPrimary}><Check size={12} /> SAVE</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setCoreEditing(true)} style={btnStyle}><Edit3 size={12} /> EDIT</button>
                    <button onClick={loadCoreMemory} style={btnStyle}><RefreshCw size={12} /> RELOAD</button>
                  </>
                )}
              </div>
            </div>
            {coreEditing ? (
              <textarea
                value={coreDraft}
                onChange={e => setCoreDraft(e.target.value)}
                style={{
                  ...inputStyle,
                  flex: 1,
                  resize: 'none',
                  lineHeight: 1.6,
                  fontSize: 12,
                }}
              />
            ) : (
              <pre style={{
                ...panelStyle,
                flex: 1,
                overflow: 'auto',
                margin: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.6,
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
              }}>
                {coreContent || 'Loading...'}
              </pre>
            )}
          </div>
        )}

        {/* ─── Daily Notes Tab ─── */}
        {tab === 'Daily Notes' && (
          <div style={{ display: 'flex', gap: 16, height: '100%' }}>
            {/* File list sidebar */}
            <div style={{ width: 220, flexShrink: 0, overflow: 'auto', ...panelStyle, padding: 8 }}>
              <div style={{ padding: '8px 8px 12px', fontSize: 11, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 1, color: 'var(--cyan-bright)' }}>
                DAILY NOTES ({dailyFiles.length})
              </div>
              {dailyFiles.map(f => (
                <div
                  key={f.name}
                  onClick={() => loadDaily(f.name)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: selectedDaily === f.name ? 'rgba(0,200,255,0.08)' : 'transparent',
                    border: selectedDaily === f.name ? '1px solid var(--border-primary)' : '1px solid transparent',
                    marginBottom: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={11} color={selectedDaily === f.name ? 'var(--cyan-bright)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: selectedDaily === f.name ? 'var(--cyan-bright)' : 'var(--text-primary)' }}>
                      {f.name.replace('.md', '')}
                    </span>
                  </div>
                  <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{formatBytes(f.sizeBytes)}</span>
                </div>
              ))}
              {dailyFiles.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                  No daily notes yet.
                </div>
              )}
            </div>

            {/* Content viewer */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selectedDaily ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 1, color: 'var(--cyan-bright)' }}>
                      {selectedDaily}
                    </span>
                    <button onClick={async () => {
                      if (confirm(`Delete ${selectedDaily}?`)) {
                        await gateway.request('memory.delete', { file: selectedDaily });
                        setSelectedDaily(null);
                        setDailyContent('');
                        refresh();
                      }
                    }} style={{ ...btnStyle, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)' }}>
                      <Trash2 size={12} /> DELETE
                    </button>
                  </div>
                  <pre style={{
                    ...panelStyle,
                    flex: 1,
                    overflow: 'auto',
                    margin: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: 'var(--text-primary)',
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                  }}>
                    {dailyContent || 'Loading...'}
                  </pre>
                </>
              ) : (
                <div style={{ ...panelStyle, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                  <Calendar size={32} color="var(--text-muted)" />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Select a daily note to view</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Knowledge Base Tab ─── */}
        {tab === 'Knowledge Base' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Database size={16} color="#f0c040" />
                <span style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 1, color: '#f0c040' }}>
                  KNOWLEDGE ENTRIES ({entries.length})
                </span>
              </div>
              <button onClick={() => setShowNewEntry(!showNewEntry)} style={btnPrimary}>
                <Plus size={12} /> NEW ENTRY
              </button>
            </div>

            {/* New entry form */}
            {showNewEntry && (
              <div style={{ ...panelStyle, borderColor: 'var(--green-primary)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    placeholder="Entry title..."
                    style={inputStyle}
                  />
                  <textarea
                    value={newContent}
                    onChange={e => setNewContent(e.target.value)}
                    placeholder="Content (Markdown supported)..."
                    rows={4}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      value={newTags}
                      onChange={e => setNewTags(e.target.value)}
                      placeholder="Tags (comma-separated): jarvis, config, important..."
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button onClick={() => { setShowNewEntry(false); setNewTitle(''); setNewContent(''); setNewTags(''); }} style={btnStyle}>
                      <X size={12} /> CANCEL
                    </button>
                    <button onClick={saveEntry} style={btnPrimary} disabled={!newTitle.trim() || !newContent.trim()}>
                      <Save size={12} /> SAVE
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Entries list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entries.map(entry => (
                <div key={entry.id} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', marginBottom: 4 }}>
                        {entry.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                        {entry.content.length > 300 ? entry.content.slice(0, 300) + '...' : entry.content}
                      </div>
                    </div>
                    <button onClick={() => deleteEntry(entry.id)} style={{ ...btnStyle, padding: '4px 8px', color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.2)' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {entry.tags.map(t => (
                        <span key={t} style={tagStyle}>{t}</span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        source: {entry.source}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        {new Date(entry.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {entries.length === 0 && (
                <div style={{ ...panelStyle, textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>
                  <Database size={24} style={{ marginBottom: 8 }} /><br />
                  No knowledge entries yet. Click "NEW ENTRY" to add one.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Search Tab ─── */}
        {tab === 'Search' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                placeholder="Search across MEMORY.md, daily notes, and knowledge entries..."
                style={{ ...inputStyle, flex: 1, fontSize: 13, padding: '10px 14px' }}
                autoFocus
              />
              <button onClick={doSearch} style={btnPrimary} disabled={!searchQuery.trim() || loading}>
                <Search size={14} /> SEARCH
              </button>
            </div>

            {searchTotal > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
                Found {searchTotal} result{searchTotal !== 1 ? 's' : ''} for "{searchQuery}"
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {searchResults.map((r, i) => (
                <div key={i} style={{
                  ...cardStyle,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                }}>
                  <span style={{
                    ...tagStyle,
                    flexShrink: 0,
                    background: r.type === 'core' ? 'rgba(0,255,65,0.1)' : r.type === 'entry' ? 'rgba(240,192,64,0.1)' : 'rgba(0,200,255,0.1)',
                    color: r.type === 'core' ? 'var(--green-bright)' : r.type === 'entry' ? '#f0c040' : 'var(--cyan-bright)',
                    border: 'none',
                  }}>
                    {r.type}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {r.source}{r.line ? `:${r.line}` : ''}
                      </span>
                      {r.tags && r.tags.map(t => <span key={t} style={{ ...tagStyle, fontSize: 8 }}>{t}</span>)}
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      {highlightMatch(r.text, searchQuery)}
                    </div>
                    {r.content && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                        {r.content}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {searchResults.length === 0 && searchQuery && !loading && (
                <div style={{ ...panelStyle, textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>
                  <Search size={24} style={{ marginBottom: 8 }} /><br />
                  No results found. Try different keywords.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Helper Components ─── */

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div style={{
      ...cardStyle,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
      <span style={{ fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 800, color, letterSpacing: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{sub}</span>
    </div>
  );
}

/* ─── Helpers ─── */

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: 'rgba(0,200,255,0.2)', borderRadius: 2, padding: '0 2px' }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}
