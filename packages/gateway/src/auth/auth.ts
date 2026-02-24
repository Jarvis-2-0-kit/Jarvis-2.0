import { createLogger, sha256 } from '@jarvis/shared';

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

  /** Verify dashboard token */
  verifyDashboardToken(token: string): boolean {
    if (!this.config.dashboardToken) {
      log.warn('No dashboard token configured - accepting all connections');
      return true;
    }
    return token === this.config.dashboardToken;
  }

  /** Verify machine token for agent */
  verifyMachineToken(agentId: string, token: string): boolean {
    const storedHash = this.config.machineTokens.get(agentId);
    if (!storedHash) {
      log.warn(`No machine token registered for ${agentId}`);
      return false;
    }
    return sha256(token) === storedHash;
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
