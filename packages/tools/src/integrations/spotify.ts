/**
 * Spotify Integration Tool
 *
 * Controls Spotify playback, searches tracks, manages playlists.
 * Two modes:
 *   1. AppleScript (macOS) — controls local Spotify.app directly (no API key needed)
 *   2. Web API — uses Spotify Web API with OAuth token for full features
 *
 * If no API token is provided, falls back to AppleScript for local control.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────

export interface SpotifyConfig {
  /** Spotify Web API OAuth access token (optional — enables search, playlists, etc.) */
  readonly accessToken?: string;
  /** Spotify refresh token for auto-renewal */
  readonly refreshToken?: string;
  /** Spotify client ID for token refresh */
  readonly clientId?: string;
  /** Spotify client secret for token refresh */
  readonly clientSecret?: string;
}

type SpotifyAction =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'status'
  | 'search'
  | 'volume'
  | 'shuffle'
  | 'repeat'
  | 'queue'
  | 'devices'
  | 'play_uri';

interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  uri: string;
  duration_ms: number;
}

// ─── AppleScript (macOS local) ───────────────────────────────────────

async function osa(script: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 10_000 });
  return stdout.trim();
}

/** Escape a string for safe interpolation into AppleScript double-quoted strings */
function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Validate that a string is a legitimate Spotify URI or URL */
function isValidSpotifyUri(uri: string): boolean {
  return /^spotify:[a-zA-Z]+:[a-zA-Z0-9]+$/.test(uri) || uri.startsWith('https://open.spotify.com/');
}

const appleScript = {
  async play(uri?: string): Promise<string> {
    if (uri) {
      if (!isValidSpotifyUri(uri)) {
        throw new Error('Invalid Spotify URI format. Expected spotify:type:id or https://open.spotify.com/...');
      }
      const safeUri = escapeAppleScript(uri);
      await osa(`tell application "Spotify" to play track "${safeUri}"`);
      return `Playing: ${uri}`;
    }
    await osa('tell application "Spotify" to play');
    return 'Playback resumed';
  },

  async pause(): Promise<string> {
    await osa('tell application "Spotify" to pause');
    return 'Playback paused';
  },

  async next(): Promise<string> {
    await osa('tell application "Spotify" to next track');
    // small delay for track to change
    await new Promise((r) => setTimeout(r, 300));
    return await appleScript.status();
  },

  async previous(): Promise<string> {
    await osa('tell application "Spotify" to previous track');
    await new Promise((r) => setTimeout(r, 300));
    return await appleScript.status();
  },

  async status(): Promise<string> {
    const script = `
      tell application "Spotify"
        set trackName to name of current track
        set trackArtist to artist of current track
        set trackAlbum to album of current track
        set trackDuration to duration of current track
        set trackPosition to player position
        set playerState to player state as string
        set currentVolume to sound volume
        set isShuffling to shuffling
        set isRepeating to repeating
        return trackName & " | " & trackArtist & " | " & trackAlbum & " | " & (trackDuration / 1000) & " | " & (trackPosition as integer) & " | " & playerState & " | " & currentVolume & " | " & isShuffling & " | " & isRepeating
      end tell
    `;

    try {
      const raw = await osa(script);
      const parts = raw.split(' | ');
      const [name, artist, album, durationSec, positionSec, state, volume, shuffling, repeating] = parts;
      const pos = parseInt(positionSec || '0');
      const dur = parseInt(durationSec || '0');
      const progress = dur > 0 ? Math.round((pos / dur) * 100) : 0;

      return [
        `🎵 ${name} — ${artist}`,
        `💿 Album: ${album}`,
        `⏱  ${formatTime(pos)} / ${formatTime(dur)} (${progress}%)`,
        `▶  State: ${state}`,
        `🔊 Volume: ${volume}%`,
        `🔀 Shuffle: ${shuffling}  🔁 Repeat: ${repeating}`,
      ].join('\n');
    } catch {
      return 'Spotify is not running or no track is playing.';
    }
  },

  async volume(level: number): Promise<string> {
    const clamped = Math.max(0, Math.min(100, level));
    await osa(`tell application "Spotify" to set sound volume to ${clamped}`);
    return `Volume set to ${clamped}%`;
  },

  async shuffle(enabled: boolean): Promise<string> {
    await osa(`tell application "Spotify" to set shuffling to ${enabled}`);
    return `Shuffle: ${enabled ? 'ON' : 'OFF'}`;
  },

  async repeat(enabled: boolean): Promise<string> {
    await osa(`tell application "Spotify" to set repeating to ${enabled}`);
    return `Repeat: ${enabled ? 'ON' : 'OFF'}`;
  },
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Web API ─────────────────────────────────────────────────────────

class SpotifyAPI {
  private token: string;
  private refreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;
  private baseUrl = 'https://api.spotify.com/v1';

  constructor(token: string, refreshToken?: string, clientId?: string, clientSecret?: string) {
    this.token = token;
    this.refreshToken = refreshToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async fetch(endpoint: string, options: RequestInit = {}): Promise<unknown> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      },
    });

    if (res.status === 401 && this.refreshToken && this.clientId && this.clientSecret) {
      await this.refreshAccessToken();
      return this.fetch(endpoint, options); // retry once
    }

    if (res.status === 204) return {};
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spotify API ${res.status}: ${text}`);
    }
    return res.json();
  }

  private async refreshAccessToken(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken!,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) throw new Error('Failed to refresh Spotify token');
    const data = (await res.json()) as { access_token: string };
    this.token = data.access_token;
  }

  async search(query: string, type: string = 'track', limit: number = 10): Promise<string> {
    const data = (await this.fetch(`/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`)) as Record<string, unknown>;

    const tracks = data['tracks'] as { items: Array<{ name: string; artists: Array<{ name: string }>; album: { name: string }; uri: string; duration_ms: number }> } | undefined;
    if (!tracks?.items?.length) return `No results for "${query}"`;

    const results = tracks.items.map((t, i) => {
      const dur = formatTime(Math.floor(t.duration_ms / 1000));
      return `${i + 1}. ${t.name} — ${t.artists.map((a) => a.name).join(', ')} [${t.album.name}] (${dur})\n   URI: ${t.uri}`;
    });

    return `Search results for "${query}":\n\n${results.join('\n')}`;
  }

  async getDevices(): Promise<string> {
    const data = (await this.fetch('/me/player/devices')) as { devices: Array<{ id: string; name: string; type: string; is_active: boolean; volume_percent: number }> };
    if (!data.devices?.length) return 'No Spotify devices found.';

    const devs = data.devices.map((d) => {
      const active = d.is_active ? ' ✅ ACTIVE' : '';
      return `• ${d.name} (${d.type}) — Vol: ${d.volume_percent}%${active}\n  ID: ${d.id}`;
    });

    return `Spotify Devices:\n\n${devs.join('\n')}`;
  }

  async addToQueue(uri: string): Promise<string> {
    await this.fetch(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' });
    return `Added to queue: ${uri}`;
  }

  async playUri(uri: string, deviceId?: string): Promise<string> {
    const body: Record<string, unknown> = {};
    if (uri.includes(':track:')) {
      body['uris'] = [uri];
    } else {
      body['context_uri'] = uri;
    }
    const deviceParam = deviceId ? `?device_id=${deviceId}` : '';
    await this.fetch(`/me/player/play${deviceParam}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return `Playing: ${uri}`;
  }

  async getStatus(): Promise<string> {
    const data = (await this.fetch('/me/player')) as Record<string, unknown> | undefined;
    if (!data || !data['item']) return 'No active playback.';

    const item = data['item'] as { name: string; artists: Array<{ name: string }>; album: { name: string }; duration_ms: number };
    const progressMs = data['progress_ms'] as number;
    const isPlaying = data['is_playing'] as boolean;
    const device = data['device'] as { name: string; volume_percent: number };
    const shuffleState = data['shuffle_state'];
    const repeatState = data['repeat_state'];

    const pos = Math.floor(progressMs / 1000);
    const dur = Math.floor(item.duration_ms / 1000);

    return [
      `🎵 ${item.name} — ${item.artists.map((a) => a.name).join(', ')}`,
      `💿 Album: ${item.album.name}`,
      `⏱  ${formatTime(pos)} / ${formatTime(dur)}`,
      `▶  ${isPlaying ? 'Playing' : 'Paused'} on ${device.name} (Vol: ${device.volume_percent}%)`,
      `🔀 Shuffle: ${shuffleState}  🔁 Repeat: ${repeatState}`,
    ].join('\n');
  }
}

// ─── Tool class ──────────────────────────────────────────────────────

export class SpotifyTool implements AgentTool {
  private config: SpotifyConfig;
  private api?: SpotifyAPI;

  definition = {
    name: 'spotify',
    description: 'Control Spotify playback, search tracks, manage queue. Actions: play, pause, next, previous, status, search, volume, shuffle, repeat, queue, devices, play_uri. Works locally on macOS via AppleScript; extended features (search, queue, devices) require API token.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['play', 'pause', 'next', 'previous', 'status', 'search', 'volume', 'shuffle', 'repeat', 'queue', 'devices', 'play_uri'],
          description: 'Action to perform',
        },
        query: {
          type: 'string',
          description: 'Search query (for search action)',
        },
        uri: {
          type: 'string',
          description: 'Spotify URI like spotify:track:... (for play_uri, queue actions)',
        },
        volume: {
          type: 'number',
          description: 'Volume level 0-100 (for volume action)',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable/disable (for shuffle, repeat actions)',
        },
        device_id: {
          type: 'string',
          description: 'Target device ID (for play_uri action)',
        },
        limit: {
          type: 'number',
          description: 'Max search results (default: 10)',
        },
      },
      required: ['action'],
    },
  };

  constructor(config: SpotifyConfig = {}) {
    this.config = config;
    if (config.accessToken) {
      this.api = new SpotifyAPI(config.accessToken, config.refreshToken, config.clientId, config.clientSecret);
    }
  }

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as SpotifyAction;

    try {
      switch (action) {
        // ── Playback control (AppleScript or API) ──
        case 'play': {
          if (this.api) {
            return createToolResult(await this.api.getStatus().catch(() => 'Resuming playback...'));
          }
          return createToolResult(await appleScript.play());
        }

        case 'pause': {
          if (process.platform === 'darwin') {
            return createToolResult(await appleScript.pause());
          }
          return createErrorResult('Pause requires macOS or API token.');
        }

        case 'next': {
          if (process.platform === 'darwin') {
            return createToolResult(await appleScript.next());
          }
          return createErrorResult('Next requires macOS or API token.');
        }

        case 'previous': {
          if (process.platform === 'darwin') {
            return createToolResult(await appleScript.previous());
          }
          return createErrorResult('Previous requires macOS or API token.');
        }

        case 'status': {
          if (this.api) {
            return createToolResult(await this.api.getStatus());
          }
          if (process.platform === 'darwin') {
            return createToolResult(await appleScript.status());
          }
          return createErrorResult('Status requires macOS or API token.');
        }

        case 'volume': {
          const level = params['volume'] as number;
          if (level === undefined) {
            return createErrorResult('volume action requires "volume" parameter (0-100).');
          }
          if (process.platform === 'darwin') {
            return createToolResult(await appleScript.volume(level));
          }
          return createErrorResult('Volume requires macOS or API token.');
        }

        case 'shuffle': {
          const enabled = params['enabled'] as boolean;
          if (enabled === undefined) {
            return createErrorResult('shuffle action requires "enabled" parameter (true/false).');
          }
          if (process.platform === 'darwin') {
            return createToolResult(await appleScript.shuffle(enabled));
          }
          return createErrorResult('Shuffle requires macOS or API token.');
        }

        case 'repeat': {
          const enabled = params['enabled'] as boolean;
          if (enabled === undefined) {
            return createErrorResult('repeat action requires "enabled" parameter (true/false).');
          }
          if (process.platform === 'darwin') {
            return createToolResult(await appleScript.repeat(enabled));
          }
          return createErrorResult('Repeat requires macOS or API token.');
        }

        // ── API-only features ──
        case 'search': {
          if (!this.api) {
            return createErrorResult('Search requires Spotify API token (SPOTIFY_ACCESS_TOKEN). Set it in .env.');
          }
          const query = params['query'] as string;
          if (!query) {
            return createErrorResult('search action requires "query" parameter.');
          }
          const limit = (params['limit'] as number) || 10;
          return createToolResult(await this.api.search(query, 'track', limit));
        }

        case 'queue': {
          if (!this.api) {
            return createErrorResult('Queue requires Spotify API token.');
          }
          const uri = params['uri'] as string;
          if (!uri) {
            return createErrorResult('queue action requires "uri" parameter.');
          }
          return createToolResult(await this.api.addToQueue(uri));
        }

        case 'devices': {
          if (!this.api) {
            return createErrorResult('Devices requires Spotify API token.');
          }
          return createToolResult(await this.api.getDevices());
        }

        case 'play_uri': {
          const uri = params['uri'] as string;
          if (!uri) {
            return createErrorResult('play_uri action requires "uri" parameter.');
          }
          if (this.api) {
            return createToolResult(await this.api.playUri(uri, params['device_id'] as string));
          }
          if (process.platform === 'darwin') {
            return createToolResult(await appleScript.play(uri));
          }
          return createErrorResult('play_uri requires macOS or API token.');
        }

        default:
          return createErrorResult(`Unknown action: ${action}. Use: play, pause, next, previous, status, search, volume, shuffle, repeat, queue, devices, play_uri`);
      }
    } catch (err) {
      return createErrorResult(`Spotify error: ${(err as Error).message}`);
    }
  }
}
