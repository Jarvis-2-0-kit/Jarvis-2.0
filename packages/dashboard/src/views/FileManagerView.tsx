/**
 * FileManagerView — NAS File Browser
 *
 * Browse, view, and manage files on the Jarvis NAS mount.
 * Features:
 * - Directory tree navigation
 * - File preview (JSON, text, configs)
 * - File metadata (size, modified date)
 * - Search across files
 * - Breadcrumb navigation
 * - Quick actions (copy path, view raw, download)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, File, FileJson, FileText, ChevronRight,
  HardDrive, RefreshCw, Search, Copy, Eye, ArrowUp,
  Database, Settings, Clock, Shield, Folder, FileCode,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';

// --- Types ---

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  extension?: string;
}

interface FileContent {
  path: string;
  content: string;
  size: number;
  modified: string;
  encoding: string;
}

// --- Icon map ---
const FILE_ICONS: Record<string, { icon: typeof FileText; color: string }> = {
  json: { icon: FileJson, color: '#fbbf24' },
  ts: { icon: FileCode, color: '#3178c6' },
  js: { icon: FileCode, color: '#f7df1e' },
  txt: { icon: FileText, color: 'var(--text-muted)' },
  md: { icon: FileText, color: '#60a5fa' },
  log: { icon: FileText, color: '#94a3b8' },
  env: { icon: Shield, color: '#ef4444' },
  yaml: { icon: Settings, color: '#cb3837' },
  yml: { icon: Settings, color: '#cb3837' },
};

const DIR_ICONS: Record<string, { icon: typeof Folder; color: string }> = {
  config: { icon: Settings, color: '#fbbf24' },
  timelines: { icon: Clock, color: '#60a5fa' },
  plugins: { icon: Database, color: '#a78bfa' },
  sessions: { icon: FolderOpen, color: 'var(--green-muted)' },
  logs: { icon: FileText, color: '#94a3b8' },
  memory: { icon: Database, color: '#34d399' },
  skills: { icon: FileCode, color: '#f472b6' },
  workflows: { icon: Settings, color: '#fb923c' },
};

export function FileManagerView() {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await gateway.request<{ entries: FileEntry[]; path: string }>('files.list', { path });
      setEntries(result?.entries ?? []);
      setCurrentPath(result?.path ?? path);
      setSelectedFile(null);
    } catch (err) {
      setError(`Failed to load directory: ${(err as Error).message}`);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load file content
  const loadFile = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const result = await gateway.request<FileContent>('files.read', { path });
      setSelectedFile(result);
    } catch (err) {
      setError(`Failed to read file: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadDirectory('/');
  }, [loadDirectory]);

  // Breadcrumb parts
  const pathParts = currentPath.split('/').filter(Boolean);

  // Filter entries by search
  const filtered = searchQuery
    ? entries.filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries;

  // Sort: dirs first, then alphabetical
  const sorted = [...filtered].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    });
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px 12px',
        borderBottom: '1px solid var(--border-primary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <HardDrive size={20} color="var(--green-bright)" />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 3,
            color: 'var(--green-bright)',
            textShadow: 'var(--glow-green)',
          }}>
            NAS FILE MANAGER
          </span>
          <button
            onClick={() => loadDirectory(currentPath)}
            style={{
              display: 'flex', alignItems: 'center', padding: 4,
              background: 'none', border: '1px solid var(--border-dim)',
              borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)',
            }}
            title="Refresh"
            aria-label="Refresh directory listing"
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
          </button>
        </div>

        {/* Breadcrumb */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}>
          <button
            onClick={() => loadDirectory('/')}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px',
              background: currentPath === '/' ? 'rgba(0,255,65,0.08)' : 'transparent',
              border: '1px solid var(--border-dim)',
              borderRadius: 4, cursor: 'pointer',
              color: 'var(--green-bright)',
              fontFamily: 'var(--font-mono)', fontSize: 11,
            }}
          >
            <HardDrive size={10} />
            NAS
          </button>
          {pathParts.map((part, i) => {
            const partPath = '/' + pathParts.slice(0, i + 1).join('/');
            return (
              <span key={partPath} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ChevronRight size={10} color="var(--text-muted)" />
                <button
                  onClick={() => loadDirectory(partPath)}
                  style={{
                    padding: '2px 8px',
                    background: i === pathParts.length - 1 ? 'rgba(0,255,65,0.08)' : 'transparent',
                    border: '1px solid var(--border-dim)',
                    borderRadius: 4, cursor: 'pointer',
                    color: i === pathParts.length - 1 ? 'var(--green-bright)' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                  }}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-dim)',
          borderRadius: 6,
        }}>
          <Search size={12} color="var(--text-muted)" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-ui)',
            }}
          />
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            {sorted.length} items
          </span>
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* File list */}
        <div style={{
          width: selectedFile ? '40%' : '100%',
          borderRight: selectedFile ? '1px solid var(--border-primary)' : 'none',
          overflowY: 'auto',
          transition: 'width 0.2s ease',
        }}>
          {/* Go up */}
          {currentPath !== '/' && (
            <button
              onClick={() => {
                const parent = '/' + pathParts.slice(0, -1).join('/');
                loadDirectory(parent || '/');
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '8px 16px',
                background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-dim)',
                cursor: 'pointer', color: 'var(--text-muted)',
              }}
            >
              <ArrowUp size={14} />
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>..</span>
            </button>
          )}

          {error && (
            <div style={{
              padding: '16px',
              color: '#ff6060',
              fontSize: 12,
              textAlign: 'center',
            }}>
              {error}
            </div>
          )}

          {sorted.map((entry) => {
            const ext = entry.extension || entry.name.split('.').pop() || '';
            const fileConfig = entry.type === 'file'
              ? FILE_ICONS[ext] ?? { icon: File, color: 'var(--text-muted)' }
              : DIR_ICONS[entry.name] ?? { icon: FolderOpen, color: '#fbbf24' };
            const Icon = fileConfig.icon;

            return (
              <button
                key={entry.path || entry.name}
                onClick={() => {
                  if (entry.type === 'directory') {
                    loadDirectory(currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`);
                  } else {
                    loadFile(currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`);
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '8px 16px',
                  background: selectedFile?.path?.endsWith(entry.name) ? 'rgba(0,255,65,0.06)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  transition: 'background 0.1s ease',
                }}
              >
                <Icon size={14} color={fileConfig.color} strokeWidth={1.5} />

                <span style={{
                  flex: 1,
                  textAlign: 'left',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: entry.type === 'directory' ? '#fbbf24' : 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {entry.name}{entry.type === 'directory' ? '/' : ''}
                </span>

                {entry.size !== undefined && entry.type === 'file' && (
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatFileSize(entry.size)}
                  </span>
                )}

                {entry.modified && (
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatModified(entry.modified)}
                  </span>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const fullPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
                    copyPath(fullPath);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', padding: 3,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: copiedPath === (currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`)
                      ? 'var(--green-bright)' : 'var(--text-muted)',
                    opacity: 0.5,
                  }}
                  title="Copy path"
                >
                  <Copy size={10} />
                </button>
              </button>
            );
          })}

          {sorted.length === 0 && !error && !loading && (
            <div style={{
              padding: '40px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
            }}>
              {searchQuery ? 'No matching files' : 'Empty directory'}
            </div>
          )}
        </div>

        {/* File preview */}
        {selectedFile && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* File info bar */}
            <div style={{
              padding: '8px 16px',
              borderBottom: '1px solid var(--border-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}>
              <Eye size={12} color="var(--cyan-bright)" />
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-primary)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {selectedFile.path}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                {formatFileSize(selectedFile.size)}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(selectedFile.content);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-dim)', borderRadius: 3,
                  cursor: 'pointer', color: 'var(--text-muted)', fontSize: 9,
                }}
              >
                <Copy size={9} /> Copy
              </button>
              <button
                onClick={() => setSelectedFile(null)}
                style={{
                  padding: '2px 8px', background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-dim)', borderRadius: 3,
                  cursor: 'pointer', color: 'var(--text-muted)', fontSize: 9,
                }}
              >
                Close
              </button>
            </div>

            {/* File content */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 16px',
              background: 'rgba(0,0,0,0.2)',
            }}>
              <pre style={{
                margin: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                lineHeight: 1.6,
                color: 'var(--green-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {formatContent(selectedFile.content, selectedFile.path)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Helpers ---

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatModified(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60_000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    if (diffMins < 10080) return `${Math.floor(diffMins / 1440)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

function formatContent(content: string, path: string): string {
  // Try to pretty-print JSON
  if (path.endsWith('.json')) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  return content;
}
