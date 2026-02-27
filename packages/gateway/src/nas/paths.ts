import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve as pathResolve, join } from 'node:path';
import { NAS_DIRS, DEFAULT_NAS_MOUNT, createLogger } from '@jarvis/shared';

const log = createLogger('gateway:nas');

export class NasPaths {
  constructor(private readonly mountPath: string = process.env['JARVIS_NAS_MOUNT'] ?? DEFAULT_NAS_MOUNT) {}

  /** Get the effective base path (NAS mount or local fallback) */
  getBasePath(): string {
    return this.isMounted() ? this.mountPath : join(process.cwd(), '.jarvis-data');
  }

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

    const basePath = this.getBasePath();

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
    const basePath = this.getBasePath();
    const resolved = join(basePath, NAS_DIRS[dir], ...segments);
    const normalizedBase = pathResolve(basePath);
    const normalizedResolved = pathResolve(resolved);
    if (!normalizedResolved.startsWith(normalizedBase + '/') && normalizedResolved !== normalizedBase) {
      throw new Error(`Path traversal detected: ${segments.join('/')}`);
    }
    return resolved;
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
