/**
 * SkillsView — Skills Browser & Manager
 *
 * Inspired by OpenClaw's ClawHub skills system.
 * Browse, install, configure, and manage skills for Jarvis agents.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Search,
  Download,
  Check,
  X,
  ExternalLink,
  Terminal,
  Code2,
  Globe,
  Music,
  Home,
  Calendar,
  MessageCircle,
  Camera,
  FileText,
  RefreshCw,
  Filter,
  Zap,
  Lock,
  AlertCircle,
  Package,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';

interface Skill {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
  installed: boolean;
  enabled: boolean;
  requires?: {
    bins?: string[];
    env?: string[];
    os?: string[];
  };
  source: 'bundled' | 'managed' | 'workspace';
  homepage?: string;
}

// All skills from OpenClaw + Jarvis custom skills
const ALL_SKILLS: Skill[] = [
  // --- Productivity ---
  { id: 'github', name: 'GitHub', description: 'Manage repos, issues, PRs, actions, and code search via gh CLI', emoji: '🐙', category: 'Dev', installed: true, enabled: true, requires: { bins: ['gh'] }, source: 'bundled', homepage: 'https://github.com/cli/cli' },
  { id: 'gh-issues', name: 'GitHub Issues', description: 'Advanced issue management, triage, labeling, bulk operations', emoji: '🎯', category: 'Dev', installed: true, enabled: true, requires: { bins: ['gh'] }, source: 'bundled' },
  { id: 'coding-agent', name: 'Coding Agent', description: 'Autonomous code writing, refactoring, debugging, and testing', emoji: '🤖', category: 'Dev', installed: true, enabled: true, source: 'bundled' },
  { id: 'notion', name: 'Notion', description: 'Create, update, search Notion pages and databases via API', emoji: '📝', category: 'Productivity', installed: false, enabled: false, requires: { env: ['NOTION_API_KEY'] }, source: 'bundled', homepage: 'https://notion.so' },
  { id: 'trello', name: 'Trello', description: 'Manage Trello boards, lists, cards, labels, and members', emoji: '📋', category: 'Productivity', installed: false, enabled: false, requires: { env: ['TRELLO_API_KEY', 'TRELLO_TOKEN'] }, source: 'bundled' },
  { id: 'slack', name: 'Slack', description: 'Send messages, manage channels, search workspace via Slack API', emoji: '💬', category: 'Communication', installed: false, enabled: false, requires: { env: ['SLACK_TOKEN'] }, source: 'bundled' },
  { id: 'discord-skill', name: 'Discord', description: 'Manage Discord servers, send messages, moderate channels', emoji: '🎮', category: 'Communication', installed: false, enabled: false, requires: { env: ['DISCORD_BOT_TOKEN'] }, source: 'bundled' },

  // --- Apple Ecosystem ---
  { id: 'apple-notes', name: 'Apple Notes', description: 'Read, create, and search Apple Notes via AppleScript', emoji: '📒', category: 'Apple', installed: true, enabled: true, requires: { os: ['darwin'] }, source: 'bundled' },
  { id: 'apple-reminders', name: 'Apple Reminders', description: 'Manage reminders, lists, and due dates in Apple Reminders', emoji: '✅', category: 'Apple', installed: true, enabled: true, requires: { os: ['darwin'] }, source: 'bundled' },
  { id: 'things-mac', name: 'Things 3', description: 'Task management with Things 3 for macOS — areas, projects, todos', emoji: '📎', category: 'Apple', installed: false, enabled: false, requires: { os: ['darwin'] }, source: 'bundled' },
  { id: 'imsg', name: 'iMessage', description: 'Send and read iMessages via macOS Messages.app', emoji: '💬', category: 'Apple', installed: true, enabled: true, requires: { os: ['darwin'] }, source: 'bundled' },

  // --- Media ---
  { id: 'spotify-player', name: 'Spotify', description: 'Control Spotify playback, search music, manage playlists', emoji: '🎵', category: 'Media', installed: true, enabled: true, requires: { env: ['SPOTIFY_ACCESS_TOKEN'] }, source: 'bundled', homepage: 'https://spotify.com' },
  { id: 'openai-image-gen', name: 'Image Generation', description: 'Generate images via DALL-E 3 and GPT Image', emoji: '🎨', category: 'Media', installed: false, enabled: false, requires: { env: ['OPENAI_API_KEY'] }, source: 'bundled' },
  { id: 'openai-whisper', name: 'Whisper Transcription', description: 'Transcribe audio files using OpenAI Whisper (local)', emoji: '🎙️', category: 'Media', installed: false, enabled: false, requires: { bins: ['whisper'] }, source: 'bundled' },
  { id: 'openai-whisper-api', name: 'Whisper API', description: 'Transcribe audio using OpenAI Whisper API (cloud)', emoji: '☁️', category: 'Media', installed: false, enabled: false, requires: { env: ['OPENAI_API_KEY'] }, source: 'bundled' },
  { id: 'video-frames', name: 'Video Frames', description: 'Extract and analyze frames from video files', emoji: '🎬', category: 'Media', installed: false, enabled: false, requires: { bins: ['ffmpeg'] }, source: 'bundled' },
  { id: 'camsnap', name: 'Camera Snap', description: 'Capture photos from connected cameras', emoji: '📷', category: 'Media', installed: false, enabled: false, requires: { os: ['darwin'] }, source: 'bundled' },

  // --- Smart Home ---
  { id: 'openhue', name: 'Philips Hue', description: 'Control Philips Hue lights, scenes, and automations', emoji: '💡', category: 'Smart Home', installed: false, enabled: false, requires: { env: ['HUE_BRIDGE_IP'] }, source: 'bundled' },
  { id: 'voice-call', name: 'Voice Call', description: 'Initiate and manage voice calls with TTS/STT', emoji: '📞', category: 'Communication', installed: false, enabled: false, source: 'bundled' },

  // --- Research & Web ---
  { id: 'weather', name: 'Weather', description: 'Get weather forecasts and conditions for any location', emoji: '🌤️', category: 'Utility', installed: true, enabled: true, source: 'bundled' },
  { id: 'xurl', name: 'URL Fetcher', description: 'Fetch and parse web pages, extract text content', emoji: '🔗', category: 'Utility', installed: true, enabled: true, source: 'bundled' },
  { id: 'summarize', name: 'Summarizer', description: 'Summarize long texts, articles, and documents', emoji: '📄', category: 'Utility', installed: true, enabled: true, source: 'bundled' },
  { id: 'blogwatcher', name: 'Blog Watcher', description: 'Monitor RSS feeds and blog posts for updates', emoji: '📡', category: 'Utility', installed: false, enabled: false, source: 'bundled' },

  // --- Knowledge ---
  { id: 'obsidian', name: 'Obsidian', description: 'Read and write Obsidian vault notes, manage links and tags', emoji: '💎', category: 'Knowledge', installed: false, enabled: false, requires: { bins: ['obsidian'] }, source: 'bundled' },
  { id: 'bear-notes', name: 'Bear Notes', description: 'Manage Bear app notes on macOS/iOS', emoji: '🐻', category: 'Knowledge', installed: false, enabled: false, requires: { os: ['darwin'] }, source: 'bundled' },

  // --- System ---
  { id: 'healthcheck', name: 'Health Check', description: 'Monitor system health, services, and infrastructure status', emoji: '🏥', category: 'System', installed: true, enabled: true, source: 'bundled' },
  { id: 'model-usage', name: 'Model Usage', description: 'Track LLM token usage, costs, and model performance', emoji: '📊', category: 'System', installed: true, enabled: true, source: 'bundled' },
  { id: 'session-logs', name: 'Session Logs', description: 'View and manage agent session logs and history', emoji: '📜', category: 'System', installed: true, enabled: true, source: 'bundled' },
  { id: 'tmux', name: 'Tmux', description: 'Control tmux sessions, windows, and panes', emoji: '🖥️', category: 'System', installed: false, enabled: false, requires: { bins: ['tmux'] }, source: 'bundled' },

  // --- Jarvis-specific ---
  { id: 'jarvis-voice', name: 'Voice Interface', description: 'Speech-to-text and text-to-speech with Jarvis personality', emoji: '🎤', category: 'Jarvis', installed: true, enabled: true, source: 'bundled' },
  { id: 'jarvis-agents', name: 'Agent Control', description: 'Manage Jarvis agents, assign tasks, monitor performance', emoji: '🤖', category: 'Jarvis', installed: true, enabled: true, source: 'bundled' },
  { id: 'jarvis-vnc', name: 'VNC Remote', description: 'Remote desktop access to agent Mac Minis via VNC', emoji: '🖥️', category: 'Jarvis', installed: true, enabled: true, source: 'bundled' },
  { id: 'jarvis-whatsapp', name: 'WhatsApp Bridge', description: 'Control Jarvis via WhatsApp — send commands, get updates', emoji: '📱', category: 'Jarvis', installed: true, enabled: true, source: 'bundled' },

  // --- AI/ML ---
  { id: 'gemini', name: 'Gemini', description: 'Use Google Gemini models for specialized tasks', emoji: '♊', category: 'AI', installed: false, enabled: false, requires: { env: ['GOOGLE_API_KEY'] }, source: 'bundled' },
  { id: 'oracle', name: 'Oracle', description: 'Advanced reasoning and decision-making agent', emoji: '🔮', category: 'AI', installed: false, enabled: false, source: 'bundled' },

  // --- Communication (more) ---
  { id: 'himalaya', name: 'Email (IMAP)', description: 'Read, send, reply, forward, and organize emails via IMAP/SMTP', emoji: '📧', category: 'Communication', installed: false, enabled: false, requires: { bins: ['himalaya'] }, source: 'bundled' },
  { id: 'wacli', name: 'WhatsApp CLI', description: 'Send WhatsApp messages and search chat history via wacli', emoji: '📱', category: 'Communication', installed: false, enabled: false, requires: { bins: ['wacli'] }, source: 'bundled' },
  { id: 'xurl-twitter', name: 'X / Twitter', description: 'Post tweets, replies, quotes, search, DMs, and media via X API', emoji: '🐦', category: 'Communication', installed: false, enabled: false, requires: { env: ['X_API_KEY'] }, source: 'bundled' },

  // --- Media (more) ---
  { id: 'nano-banana-pro', name: 'Gemini Image Gen', description: 'Generate or edit images via Google Gemini 3 Pro Image model', emoji: '🖼️', category: 'Media', installed: false, enabled: false, requires: { env: ['GOOGLE_API_KEY'] }, source: 'bundled' },
  { id: 'sag', name: 'ElevenLabs TTS', description: 'High-quality text-to-speech via ElevenLabs API', emoji: '🔊', category: 'Media', installed: false, enabled: false, requires: { env: ['ELEVENLABS_API_KEY'] }, source: 'bundled' },
  { id: 'sherpa-onnx-tts', name: 'Local TTS', description: 'Offline text-to-speech via sherpa-onnx (no cloud needed)', emoji: '🗣️', category: 'Media', installed: false, enabled: false, requires: { bins: ['sherpa-onnx'] }, source: 'bundled' },
  { id: 'songsee', name: 'Audio Visualizer', description: 'Generate spectrograms and audio feature visualizations', emoji: '🎚️', category: 'Media', installed: false, enabled: false, requires: { bins: ['ffmpeg'] }, source: 'bundled' },
  { id: 'gifgrep', name: 'GIF Search', description: 'Search GIF providers, download results, extract stills', emoji: '🎞️', category: 'Media', installed: false, enabled: false, source: 'bundled' },

  // --- Smart Home (more) ---
  { id: 'sonoscli', name: 'Sonos', description: 'Control Sonos speakers — discover, play, volume, grouping', emoji: '🔈', category: 'Smart Home', installed: false, enabled: false, requires: { bins: ['sonoscli'] }, source: 'bundled' },
  { id: 'blucli', name: 'BluOS', description: 'Control BluOS audio systems — playback, grouping, volume', emoji: '🎶', category: 'Smart Home', installed: false, enabled: false, requires: { bins: ['blu'] }, source: 'bundled' },
  { id: 'eightctl', name: 'Eight Sleep', description: 'Control Eight Sleep pod — temperature, alarms, schedules', emoji: '🛏️', category: 'Smart Home', installed: false, enabled: false, requires: { bins: ['eightctl'] }, source: 'bundled' },

  // --- Productivity (more) ---
  { id: 'gog', name: 'Google Workspace', description: 'Gmail, Calendar, Drive, Contacts, Sheets, and Docs via gog CLI', emoji: '📊', category: 'Productivity', installed: false, enabled: false, requires: { bins: ['gog'] }, source: 'bundled' },
  { id: 'goplaces', name: 'Google Places', description: 'Search places, get details, reviews via Google Places API', emoji: '📍', category: 'Utility', installed: false, enabled: false, requires: { env: ['GOOGLE_PLACES_KEY'] }, source: 'bundled' },
  { id: 'nano-pdf', name: 'PDF Editor', description: 'Edit PDFs with natural-language instructions', emoji: '📑', category: 'Utility', installed: false, enabled: false, requires: { bins: ['nano-pdf'] }, source: 'bundled' },

  // --- Dev (more) ---
  { id: 'skill-creator', name: 'Skill Creator', description: 'Create or update agent skills with scripts and assets', emoji: '🔧', category: 'Dev', installed: false, enabled: false, source: 'bundled' },
  { id: 'mcporter', name: 'MCP Client', description: 'List, configure, and call MCP servers/tools directly', emoji: '🔌', category: 'Dev', installed: false, enabled: false, source: 'bundled' },
  { id: 'peekaboo', name: 'macOS UI Control', description: 'Capture and automate macOS UI elements with Peekaboo', emoji: '👁️', category: 'Dev', installed: false, enabled: false, requires: { os: ['darwin'], bins: ['peekaboo'] }, source: 'bundled' },

  // --- Knowledge (more) ---
  { id: 'canvas', name: 'Canvas', description: 'Display rich HTML content on connected Jarvis nodes', emoji: '🎨', category: 'Knowledge', installed: false, enabled: false, source: 'bundled' },

  // --- Security ---
  { id: '1password', name: '1Password', description: 'Secure credential access and management via 1Password CLI', emoji: '🔐', category: 'Security', installed: false, enabled: false, requires: { bins: ['op'] }, source: 'bundled' },

  // --- Food / Orders ---
  { id: 'ordercli', name: 'Food Orders', description: 'Check past orders and active delivery status (Foodora)', emoji: '🍕', category: 'Utility', installed: false, enabled: false, requires: { bins: ['ordercli'] }, source: 'bundled' },
];

const CATEGORIES = ['All', 'Jarvis', 'Dev', 'Productivity', 'Communication', 'Apple', 'Media', 'Smart Home', 'Utility', 'Knowledge', 'System', 'AI', 'Security'];

const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
  All: Sparkles,
  Jarvis: Zap,
  Dev: Code2,
  Productivity: FileText,
  Communication: MessageCircle,
  Apple: Terminal,
  Media: Music,
  'Smart Home': Home,
  Utility: Globe,
  Knowledge: FileText,
  System: Terminal,
  AI: Sparkles,
  Security: Lock,
};

export function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>(ALL_SKILLS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showInstalled, setShowInstalled] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSkillsStatus = useCallback(async () => {
    try {
      const result = await gateway.request('skills.list', {}) as { skills: Skill[] };
      if (result?.skills?.length) {
        // Merge gateway status with our catalog
        setSkills((prev) => prev.map((s) => {
          const remote = result.skills.find((r) => r.id === s.id);
          if (remote) return { ...s, installed: remote.installed, enabled: remote.enabled };
          return s;
        }));
      }
    } catch { /* gateway might not have skills.list yet */ }
  }, []);

  const toggleSkill = async (skillId: string) => {
    setSkills((prev) => prev.map((s) =>
      s.id === skillId ? { ...s, enabled: !s.enabled } : s
    ));
    try {
      await gateway.request('skills.toggle', { skillId });
    } catch { /* */ }
  };

  // Load skills status from gateway
  useEffect(() => {
    void loadSkillsStatus();
  }, [loadSkillsStatus]);

  const installSkill = async (skillId: string) => {
    setLoading(true);
    setSkills((prev) => prev.map((s) =>
      s.id === skillId ? { ...s, installed: true, enabled: true } : s
    ));
    try {
      await gateway.request('skills.install', { skillId });
    } catch { /* */ }
    finally { setLoading(false); }
  };

  const filtered = skills.filter((s) => {
    if (showInstalled && !s.installed) return false;
    if (selectedCategory !== 'All' && s.category !== selectedCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.id.includes(q);
    }
    return true;
  });

  const installedCount = skills.filter((s) => s.installed).length;
  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border-primary)',
        background: 'linear-gradient(180deg, #0d1117 0%, #0a0e14 100%)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={18} color="var(--amber)" />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: 'var(--amber)' }}>
              SKILLS
            </span>
            <span style={{
              fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-muted)',
              padding: '2px 8px', background: 'var(--bg-tertiary)', borderRadius: 4, border: '1px solid var(--border-dim)',
            }}>
              {skills.length} AVAILABLE
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--green-bright)' }}>
              <Package size={10} style={{ marginRight: 3 }} />{installedCount} INSTALLED
            </span>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--cyan-bright)' }}>
              <Zap size={10} style={{ marginRight: 3 }} />{enabledCount} ACTIVE
            </span>
          </div>
        </div>

        {/* Search + Filter */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', background: 'var(--bg-tertiary)',
            borderRadius: 6, border: '1px solid var(--border-dim)',
          }}>
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search skills..."
              style={{
                all: 'unset', flex: 1, fontSize: 12, fontFamily: 'var(--font-ui)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <button
            onClick={() => setShowInstalled(!showInstalled)}
            aria-label={showInstalled ? 'Show all skills' : 'Show installed skills only'}
            aria-pressed={showInstalled}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '6px 10px', fontSize: 9, fontFamily: 'var(--font-display)',
              letterSpacing: 1, borderRadius: 4, cursor: 'pointer',
              background: showInstalled ? 'rgba(0,255,65,0.1)' : 'var(--bg-tertiary)',
              border: `1px solid ${showInstalled ? 'var(--green-primary)' : 'var(--border-dim)'}`,
              color: showInstalled ? 'var(--green-bright)' : 'var(--text-muted)',
            }}
          >
            <Filter size={10} /> {showInstalled ? 'INSTALLED' : 'ALL'}
          </button>
        </div>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: 4, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {CATEGORIES.map((cat) => {
            const count = cat === 'All' ? skills.length : skills.filter((s) => s.category === cat).length;
            if (count === 0 && cat !== 'All') return null;
            const Icon = CATEGORY_ICONS[cat] || Sparkles;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', fontSize: 9, fontFamily: 'var(--font-display)',
                  letterSpacing: 0.5, borderRadius: 4, cursor: 'pointer',
                  whiteSpace: 'nowrap', flexShrink: 0,
                  background: selectedCategory === cat ? 'rgba(251,191,36,0.1)' : 'transparent',
                  border: `1px solid ${selectedCategory === cat ? 'var(--amber)' : 'transparent'}`,
                  color: selectedCategory === cat ? 'var(--amber)' : 'var(--text-muted)',
                }}
              >
                <Icon size={10} /> {cat}
                <span style={{ fontSize: 8, opacity: 0.6 }}>({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Skills grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {filtered.map((skill) => (
            <div
              key={skill.id}
              onClick={() => setSelectedSkill(skill)}
              style={{
                padding: 16, borderRadius: 10, cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--bg-secondary), var(--bg-tertiary))',
                border: `1px solid ${skill.enabled ? 'var(--amber)44' : 'var(--border-dim)'}`,
                transition: 'all 0.15s',
                position: 'relative', overflow: 'hidden',
              }}
            >
              {/* Enabled indicator */}
              {skill.enabled && (
                <div style={{
                  position: 'absolute', top: 0, right: 0,
                  width: 0, height: 0,
                  borderLeft: '20px solid transparent',
                  borderTop: '20px solid var(--amber)',
                  opacity: 0.4,
                }} />
              )}

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                {/* Emoji */}
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                }}>
                  {skill.emoji}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{
                      fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-ui)',
                      color: 'var(--text-white)',
                    }}>
                      {skill.name}
                    </span>
                    {skill.installed && (
                      <span style={{
                        fontSize: 8, padding: '2px 6px', borderRadius: 4,
                        background: skill.enabled ? 'rgba(0,255,65,0.1)' : 'var(--bg-tertiary)',
                        color: skill.enabled ? 'var(--green-bright)' : 'var(--text-secondary)',
                        border: `1px solid ${skill.enabled ? 'rgba(0,255,65,0.2)' : 'var(--border-dim)'}`,
                        fontFamily: 'var(--font-display)', letterSpacing: 0.5, fontWeight: 600,
                      }}>
                        {skill.enabled ? 'ACTIVE' : 'INSTALLED'}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)',
                    lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {skill.description}
                  </div>

                  {/* Requirements */}
                  {skill.requires && (
                    <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                      {skill.requires.bins?.map((bin) => (
                        <span key={bin} style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 4,
                          background: 'rgba(0,255,255,0.06)', border: '1px solid rgba(0,255,255,0.15)',
                          color: 'var(--cyan-bright)', fontFamily: 'var(--font-mono)',
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                        }}>
                          <Terminal size={8} />{bin}
                        </span>
                      ))}
                      {skill.requires.env?.map((env) => (
                        <span key={env} style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 4,
                          background: 'rgba(255,170,0,0.06)', border: '1px solid rgba(255,170,0,0.15)',
                          color: 'var(--amber)', fontFamily: 'var(--font-mono)',
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                        }}>
                          <Lock size={8} />{env}
                        </span>
                      ))}
                      {skill.requires.os?.map((os) => (
                        <span key={os} style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 4,
                          background: 'rgba(191,90,242,0.06)', border: '1px solid rgba(191,90,242,0.15)',
                          color: 'var(--purple)', fontFamily: 'var(--font-mono)',
                        }}>
                          {os}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <Search size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontSize: 12, fontFamily: 'var(--font-ui)' }}>No skills matching your search</div>
          </div>
        )}
      </div>

      {/* Skill Detail Modal */}
      {selectedSkill && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setSelectedSkill(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 480, maxHeight: '80vh', overflowY: 'auto',
            background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
            border: '1px solid var(--amber)44', borderRadius: 12, padding: 24,
            boxShadow: '0 0 30px rgba(251,191,36,0.08), 0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 10, flexShrink: 0,
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              }}>
                {selectedSkill.emoji}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--amber)', marginBottom: 2 }}>
                  {selectedSkill.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', lineHeight: 1.5 }}>
                  {selectedSkill.description}
                </div>
              </div>
              <button onClick={() => setSelectedSkill(null)} aria-label="Close skill details" style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            </div>

            {/* Info grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <InfoBox label="Category" value={selectedSkill.category} />
              <InfoBox label="Source" value={selectedSkill.source} />
              <InfoBox label="Status" value={selectedSkill.installed ? (selectedSkill.enabled ? 'Active' : 'Installed') : 'Not installed'} color={selectedSkill.enabled ? 'var(--green-bright)' : 'var(--text-muted)'} />
              <InfoBox label="ID" value={selectedSkill.id} mono />
            </div>

            {/* Requirements */}
            {selectedSkill.requires && (
              <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-dim)' }}>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--amber)', marginBottom: 8 }}>
                  REQUIREMENTS
                </div>
                {selectedSkill.requires.bins?.length && (
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)', marginBottom: 4 }}>
                    <Terminal size={10} style={{ marginRight: 4 }} /> Binaries: {selectedSkill.requires.bins.map((b) => (
                      <code key={b} style={{ padding: '1px 4px', background: 'var(--bg-tertiary)', borderRadius: 3, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cyan-bright)' }}>{b}</code>
                    ))}
                  </div>
                )}
                {selectedSkill.requires.env?.length && (
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)', marginBottom: 4 }}>
                    <Lock size={10} style={{ marginRight: 4 }} /> Environment: {selectedSkill.requires.env.join(', ')}
                  </div>
                )}
                {selectedSkill.requires.os?.length && (
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
                    <Globe size={10} style={{ marginRight: 4 }} /> Platform: {selectedSkill.requires.os.join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              {!selectedSkill.installed ? (
                <button onClick={() => { installSkill(selectedSkill.id); setSelectedSkill({ ...selectedSkill, installed: true, enabled: true }); }} style={{
                  flex: 1, padding: '10px 0', fontSize: 11, fontFamily: 'var(--font-display)',
                  fontWeight: 700, letterSpacing: 2, borderRadius: 6, cursor: 'pointer',
                  background: 'linear-gradient(135deg, var(--amber), #d97706)',
                  border: 'none', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <Download size={14} /> INSTALL
                </button>
              ) : (
                <button onClick={() => { toggleSkill(selectedSkill.id); setSelectedSkill({ ...selectedSkill, enabled: !selectedSkill.enabled }); }} style={{
                  flex: 1, padding: '10px 0', fontSize: 11, fontFamily: 'var(--font-display)',
                  fontWeight: 700, letterSpacing: 2, borderRadius: 6, cursor: 'pointer',
                  background: selectedSkill.enabled ? 'rgba(255,85,85,0.15)' : 'rgba(0,255,65,0.15)',
                  border: `1px solid ${selectedSkill.enabled ? '#ff555544' : 'var(--green-primary)44'}`,
                  color: selectedSkill.enabled ? 'var(--red-bright)' : 'var(--green-bright)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  {selectedSkill.enabled ? <><X size={14} /> DISABLE</> : <><Check size={14} /> ENABLE</>}
                </button>
              )}
              {selectedSkill.homepage && (
                <button onClick={() => window.open(selectedSkill.homepage, '_blank')} style={{
                  padding: '10px 16px', fontSize: 11, fontFamily: 'var(--font-display)',
                  letterSpacing: 1, borderRadius: 6, cursor: 'pointer',
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                  color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <ExternalLink size={12} /> DOCS
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoBox({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-dim)' }}>
      <div style={{ fontSize: 8, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)', color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
