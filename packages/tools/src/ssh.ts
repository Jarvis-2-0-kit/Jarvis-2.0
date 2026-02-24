import { Client } from 'ssh2';
import { createLogger } from '@jarvis/shared';
import type { AgentTool, ToolContext, ToolResult } from './base.js';
import { createToolResult, createErrorResult } from './base.js';

const log = createLogger('tool:ssh');

const MAX_OUTPUT_SIZE = 200_000; // 200KB max output
const DEFAULT_TIMEOUT = 120_000; // 2 minutes

export interface SshHostConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}

export interface SshToolConfig {
  /** Map of agentId -> SSH host config for target machines */
  hosts: Record<string, SshHostConfig>;
}

/**
 * SSH Tool - Execute commands on remote machines via SSH.
 * Each agent is mapped to a target machine (e.g., agent-alpha -> Agent Smith Mac Mini).
 * Uses ssh2 library for password-based authentication.
 */
export class SshTool implements AgentTool {
  definition = {
    name: 'ssh_exec',
    description: 'Execute a command on the remote machine assigned to this agent via SSH. Use this for running commands on the target Mac Mini (installing software, managing files, running scripts, etc.). The remote machine is automatically determined based on the agent identity.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute on the remote machine',
        },
        target: {
          type: 'string',
          description: 'Optional: specific target host ID (e.g., "agent-alpha", "agent-beta"). Defaults to the current agent\'s assigned machine.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 120000)',
        },
      },
      required: ['command'],
    },
  };

  constructor(private config: SshToolConfig) {}

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = params['command'] as string;
    const target = (params['target'] as string) || context.agentId;
    const timeout = (params['timeout'] as number) || DEFAULT_TIMEOUT;

    if (!command) return createErrorResult('Missing required parameter: command');

    // Resolve target host config
    const hostConfig = this.config.hosts[target];
    if (!hostConfig) {
      const available = Object.keys(this.config.hosts).join(', ');
      return createErrorResult(`No SSH host configured for target "${target}". Available targets: ${available}`);
    }

    log.info(`SSH exec on ${hostConfig.host} (target: ${target}): ${command.slice(0, 100)}`);

    try {
      const result = await this.sshExec(hostConfig, command, timeout);
      return result;
    } catch (err) {
      log.error(`SSH exec failed: ${(err as Error).message}`);
      return createErrorResult(`SSH execution failed: ${(err as Error).message}`);
    }
  }

  /** Execute a command via SSH and return the result */
  private sshExec(host: SshHostConfig, command: string, timeout: number): Promise<ToolResult> {
    return new Promise((resolve) => {
      const conn = new Client();
      let stdout = '';
      let stderr = '';
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          conn.end();
          resolve(createErrorResult(`SSH command timed out after ${timeout}ms`));
        }
      }, timeout);

      conn.on('ready', () => {
        log.info(`SSH connected to ${host.host}`);
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            resolved = true;
            conn.end();
            resolve(createErrorResult(`SSH exec error: ${err.message}`));
            return;
          }

          stream.on('close', (code: number) => {
            clearTimeout(timer);
            if (!resolved) {
              resolved = true;
              conn.end();

              let output = '';
              if (stdout) output += stdout.slice(0, MAX_OUTPUT_SIZE);
              if (stderr) output += (output ? '\n\nSTDERR:\n' : '') + stderr.slice(0, MAX_OUTPUT_SIZE);
              if (code !== 0 && code !== null) {
                output += `\n\nExit code: ${code}`;
              }
              if (!output.trim()) {
                output = code === 0 ? 'Command completed successfully (no output)' : `Command failed with exit code ${code}`;
              }

              resolve(createToolResult(output, { exitCode: code, host: host.host }));
            }
          });

          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          log.error(`SSH connection error: ${err.message}`);
          resolve(createErrorResult(`SSH connection failed to ${host.host}: ${err.message}`));
        }
      });

      // Connect
      conn.connect({
        host: host.host,
        port: host.port || 22,
        username: host.username,
        password: host.password,
        // Accept all host keys (trusted local network)
        hostVerifier: () => true,
        readyTimeout: 10000,
      } as unknown as Record<string, unknown>);
    });
  }
}

/**
 * Helper: Execute a single SSH command and return stdout.
 * Used internally by ComputerUseTool.
 */
export async function sshExecSimple(
  host: SshHostConfig,
  command: string,
  timeout = 30000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        conn.end();
        reject(new Error(`SSH command timed out after ${timeout}ms`));
      }
    }, timeout);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          resolved = true;
          conn.end();
          reject(err);
          return;
        }

        stream.on('close', (code: number) => {
          clearTimeout(timer);
          if (!resolved) {
            resolved = true;
            conn.end();
            resolve({ stdout, stderr, code });
          }
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    conn.connect({
      host: host.host,
      port: host.port || 22,
      username: host.username,
      password: host.password,
      hostVerifier: () => true,
      readyTimeout: 10000,
    } as unknown as Record<string, unknown>);
  });
}

/**
 * Helper: Execute SSH command and get raw binary stdout (for screenshots).
 */
export async function sshExecBinary(
  host: SshHostConfig,
  command: string,
  timeout = 30000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const chunks: Buffer[] = [];
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        conn.end();
        reject(new Error(`SSH binary command timed out after ${timeout}ms`));
      }
    }, timeout);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          resolved = true;
          conn.end();
          reject(err);
          return;
        }

        stream.on('close', (code: number) => {
          clearTimeout(timer);
          if (!resolved) {
            resolved = true;
            conn.end();
            if (code !== 0) {
              reject(new Error(`Command exited with code ${code}`));
            } else {
              resolve(Buffer.concat(chunks));
            }
          }
        });

        stream.on('data', (data: Buffer) => {
          chunks.push(data);
        });

        stream.stderr.on('data', (data: Buffer) => {
          // Log stderr but don't fail
          log.warn(`SSH stderr: ${data.toString().slice(0, 200)}`);
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    conn.connect({
      host: host.host,
      port: host.port || 22,
      username: host.username,
      password: host.password,
      hostVerifier: () => true,
      readyTimeout: 10000,
    } as unknown as Record<string, unknown>);
  });
}
