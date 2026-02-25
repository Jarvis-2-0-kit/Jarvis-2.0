import { timingSafeEqual } from 'node:crypto';
import { createLogger, sha256, generateToken } from '@jarvis/shared';

const log = createLogger('gateway:auth');

export interface AuthConfig {
  /** Dashboard access token */
  dashboardToken: string;
  /** Machine tokens for agent authentication */
  machineTokens: Map<string, string>;
}

export class AuthManager {
  private config: AuthConfig;

  constructor(dashboardToken: string) {
    if (!dashboardToken) {
      const generated = generateToken();
      log.warn('No dashboard token configured - auto-generated a random token');
      log.warn(`Dashboard token: ${generated}`);
      dashboardToken = generated;
    }

    this.config = {
      dashboardToken,
      machineTokens: new Map(),
    };
  }

  /** Register a machine token for an agent */
  registerMachineToken(agentId: string, token: string): void {
    this.config.machineTokens.set(agentId, sha256(token));
    log.info(`Registered machine token for ${agentId}`);
  }

  /** Check whether a dashboard token is configured */
  hasDashboardToken(): boolean {
    return !!this.config.dashboardToken;
  }

  /** Get the effective dashboard token (for local /auth/token endpoint) */
  getDashboardToken(): string {
    return this.config.dashboardToken;
  }

  /** Verify dashboard token (timing-safe) */
  verifyDashboardToken(token: string): boolean {
    const a = Buffer.from(token);
    const b = Buffer.from(this.config.dashboardToken);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  /** Verify machine token for agent (timing-safe) */
  verifyMachineToken(agentId: string, token: string): boolean {
    const storedHash = this.config.machineTokens.get(agentId);
    if (!storedHash) {
      log.warn(`No machine token registered for ${agentId}`);
      return false;
    }
    const a = Buffer.from(sha256(token));
    const b = Buffer.from(storedHash);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  /** Extract token from WebSocket upgrade request */
  static extractToken(url: string): string | null {
    try {
      const parsed = new URL(url, 'http://localhost');
      return parsed.searchParams.get('token');
    } catch {
      return null;
    }
  }
}
