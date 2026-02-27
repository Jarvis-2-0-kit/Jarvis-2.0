/**
 * Shared formatter / utility functions used across dashboard views.
 *
 * Consolidates duplicates that previously lived in individual view files.
 */

// ─── Uptime ───────────────────────────────────────────────────────────

/** Format seconds into a human-readable uptime string, e.g. "2d 5h 12m" */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Compact uptime, e.g. "2d5h" or "3h12m" */
export function formatUptimeShort(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

// ─── Bytes ────────────────────────────────────────────────────────────

/** Format byte count, e.g. "1.5 GB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** Format bytes-per-second rate, e.g. "12.3 KB/s" */
export function formatBytesRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
}

// ─── Relative / ago timestamps ────────────────────────────────────────

/**
 * Relative time string with "just now" for <5 s, then s/m/h/d granularity.
 * Suitable for activity feeds and status displays.
 */
export function formatTimeAgo(ts: number): string {
  if (!ts) return 'never';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

/**
 * Shorter relative time (alias kept for call-sites that used "formatRelative"
 * or "formatRelativeTime"). Same behaviour as formatTimeAgo.
 */
export const formatRelativeTime = formatTimeAgo;
export const formatRelative = formatTimeAgo;

// ─── Clock / calendar timestamps ──────────────────────────────────────

/** Format a timestamp as HH:MM, with "Yesterday" or dd/mm prefix when needed */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${time}`;
}

/** Format a timestamp as HH:MM:SS (24-hour) */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Duration ─────────────────────────────────────────────────────────

/** Format millisecond duration, e.g. "120ms", "3.2s", "5m 12s", "2h 30m" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}
