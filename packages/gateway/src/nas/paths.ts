import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NAS_DIRS, DEFAULT_NAS_MOUNT, createLogger } from '@jarvis/shared';

const log = createLogger('gateway:nas');

export class NasPaths {
  constructor(private readonly mountPath: string = process.env['JARVIS_NAS_MOUNT'] ?? DEFAULT_NAS_MOUNT) {}

  /** Check if NAS is mounted and accessible */
  isMounted(): boolean {
    try {
      return existsSync(this.mountPath) && statSync(this.mountPath).isDirectory();
    } catch {
      return false;
    }
  }

  /** Ensure all required NAS directories exist */
  ensureDirectories(): void {
    if (!this.isMounted()) {
      log.warn(`NAS not mounted at ${this.mountPath} - using local fallback`);
    }

    const basePath = this.isMounted() ? this.mountPath : join(process.cwd(), '.jarvis-data');

    for (const dir of Object.values(NAS_DIRS)) {
      const fullPath = join(basePath, dir);
      if (!existsSync(fullPath)) {
        mkdirSync(fullPath, { recursive: true });
        log.info(`Created directory: ${fullPath}`);
      }
    }
  }

  /** Get resolved path for a NAS directory */
  resolve(dir: keyof typeof NAS_DIRS, ...segments: string[]): string {
    const basePath = this.isMounted() ? this.mountPath : join(process.cwd(), '.jarvis-data');
    return join(basePath, NAS_DIRS[dir], ...segments);
  }

  /** Get sessions directory for an agent */
  sessionsDir(agentId: string): string {
    return this.resolve('sessions', agentId);
  }

  /** Get workspace projects directory */
  projectsDir(): string {
    return this.resolve('projects');
  }

  /** Get artifacts directory */
  artifactsDir(): string {
    return this.resolve('artifacts');
  }

  /** Get knowledge base directory */
  knowledgeDir(): string {
    return this.resolve('knowledge');
  }

  /** Get logs directory */
  logsDir(): string {
    return this.resolve('logs');
  }

  /** Get config file path */
  configPath(): string {
    return this.resolve('config', 'jarvis.yaml');
  }

  /** Health check - returns disk info or null */
  healthCheck(): { mounted: boolean; path: string } {
    return {
      mounted: this.isMounted(),
      path: this.mountPath,
    };
  }
}
