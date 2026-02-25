import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('security:audit');

export type AuditEventType =
  | 'auth.success'
  | 'auth.failure'
  | 'auth.blocked'
  | 'exec.command'
  | 'file.read'
  | 'file.write'
  | 'ssh.connect'
  | 'ssh.command'
  | 'imessage.send'
  | 'imessage.confirm'
  | 'imessage.reject'
  | 'nats.connect'
  | 'rate_limit.exceeded'
  | 'security.blocked_path'
  | 'security.blocked_command';

export interface AuditEvent {
  timestamp: string;
  type: AuditEventType;
  source: string;
  details: Record<string, unknown>;
  ip?: string;
  agentId?: string;
}

export interface AuditLoggerConfig {
  logFilePath?: string;
  /** Callback to publish audit events (e.g., to NATS) */
  onEvent?: (event: AuditEvent) => void;
}

/** Failed auth tracker for IP blocking */
interface FailedAuthTracker {
  count: number;
  firstAttempt: number;
  blocked: boolean;
  blockedUntil: number;
}

const FAILED_AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const FAILED_AUTH_MAX = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

class AuditLogger {
  private logFilePath: string | null;
  private onEvent?: (event: AuditEvent) => void;
  private failedAuth = new Map<string, FailedAuthTracker>();

  constructor(config: AuditLoggerConfig = {}) {
    this.logFilePath = config.logFilePath ?? null;
    this.onEvent = config.onEvent;

    if (this.logFilePath) {
      const dir = dirname(this.logFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /** Log an audit event */
  logEvent(type: AuditEventType, source: string, details: Record<string, unknown>, ip?: string, agentId?: string): void {
    const event: AuditEvent = {
      timestamp: new Date().toISOString(),
      type,
      source,
      details,
      ip,
      agentId,
    };

    // Write to file
    if (this.logFilePath) {
      try {
        appendFileSync(this.logFilePath, JSON.stringify(event) + '\n');
      } catch (err) {
        log.error(`Failed to write audit log: ${(err as Error).message}`);
      }
    }

    // Console log for critical events
    if (type.startsWith('auth.failure') || type.startsWith('auth.blocked') || type.startsWith('security.')) {
      log.warn(`SECURITY: ${type} from ${ip || source}`, details);
    }

    // Callback (e.g., NATS publish)
    this.onEvent?.(event);
  }

  /** Track failed auth attempt. Returns true if the IP should be blocked. */
  trackFailedAuth(ip: string): boolean {
    const now = Date.now();
    let tracker = this.failedAuth.get(ip);

    if (!tracker || (now - tracker.firstAttempt > FAILED_AUTH_WINDOW_MS)) {
      tracker = { count: 0, firstAttempt: now, blocked: false, blockedUntil: 0 };
      this.failedAuth.set(ip, tracker);
    }

    tracker.count++;

    if (tracker.count >= FAILED_AUTH_MAX) {
      tracker.blocked = true;
      tracker.blockedUntil = now + BLOCK_DURATION_MS;
      this.logEvent('auth.blocked', 'auth', {
        reason: `${FAILED_AUTH_MAX} failed attempts in ${FAILED_AUTH_WINDOW_MS / 1000}s`,
        totalAttempts: tracker.count,
      }, ip);
      log.error(`CRITICAL: IP ${ip} blocked after ${tracker.count} failed auth attempts`);
      return true;
    }

    return false;
  }

  /** Check if an IP is currently blocked */
  isBlocked(ip: string): boolean {
    const tracker = this.failedAuth.get(ip);
    if (!tracker?.blocked) return false;

    if (Date.now() > tracker.blockedUntil) {
      // Block expired
      this.failedAuth.delete(ip);
      return false;
    }
    return true;
  }

  /** Clear failed auth tracking for an IP (on successful auth) */
  clearFailedAuth(ip: string): void {
    this.failedAuth.delete(ip);
  }
}

// Singleton instance
let auditInstance: AuditLogger | null = null;

export function initAuditLogger(config: AuditLoggerConfig = {}): AuditLogger {
  auditInstance = new AuditLogger(config);
  return auditInstance;
}

export function getAuditLogger(): AuditLogger {
  if (!auditInstance) {
    auditInstance = new AuditLogger();
  }
  return auditInstance;
}

export { AuditLogger };
