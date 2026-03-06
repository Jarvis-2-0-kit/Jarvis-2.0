/**
 * Gateway utility functions — extracted from server.ts
 */

/** Mask a secret string: show first 4 + last 4 chars */
export function maskSecret(value: string): string {
  if (value.length <= 12) return '****';
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
}

/** Check if an env var key looks like a secret */
export function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return /(?:KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL|PASS|AUTH|PRIVATE|DSN|DATABASE|CONNECTION)/.test(upper);
}

/** Strip HTML tags for basic sanitization */
export function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

/** Format duration in seconds to human-readable string */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
