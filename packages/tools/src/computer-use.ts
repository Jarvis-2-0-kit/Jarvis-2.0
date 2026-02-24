import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@jarvis/shared';
import type { AgentTool, ToolContext, ToolResult } from './base.js';
import { createToolResult, createErrorResult } from './base.js';
import { sshExecSimple, type SshHostConfig } from './ssh.js';

const log = createLogger('tool:computer-use');

export interface VncHostConfig {
  /** VNC host IP */
  host: string;
  /** VNC port (default: 5900) */
  vncPort?: number;
  /** VNC password for VNCAuth */
  vncPassword: string;
  /** SSH config for commands that need SSH (open_app, etc.) */
  ssh?: SshHostConfig;
}

export interface ComputerUseConfig {
  /** Map of agentId -> VNC host config for target machines */
  hosts: Record<string, VncHostConfig>;
}

type ComputerAction =
  | 'screenshot'
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'key'
  | 'key_combo'
  | 'scroll'
  | 'move'
  | 'drag'
  | 'open_app'
  | 'get_screen_size';

/**
 * ComputerUseTool - Screen capture + mouse/keyboard control for remote Mac Minis.
 *
 * Uses VNC protocol directly for:
 * - Screenshots (framebuffer capture via RFB protocol)
 * - Mouse events (click, move, drag via RFB PointerEvent)
 * - Keyboard events (type, key press via RFB KeyEvent)
 *
 * Falls back to SSH for:
 * - Opening applications (macOS `open -a` command)
 *
 * This approach bypasses macOS Screen Recording permission issues
 * because the VNC server already has the permission.
 *
 * Inspired by OpenClaw's Peekaboo and Anthropic's Computer Use API.
 */
export class ComputerUseTool implements AgentTool {
  definition = {
    name: 'computer',
    description: `Control the remote Mac computer assigned to this agent. Take screenshots to see the screen, click on elements, type text, press keyboard shortcuts, scroll, and open apps.

WORKFLOW:
1. Take a screenshot first to see the current screen state
2. Identify coordinates of elements you want to interact with
3. Click, type, or perform keyboard actions
4. Take another screenshot to verify the result

COORDINATE SYSTEM: Origin (0,0) is top-left corner. Use get_screen_size to know dimensions.

KEY COMBOS: Use key_combo with format like "cmd+c", "cmd+shift+s", "ctrl+a"`,
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'screenshot',
            'click',
            'double_click',
            'right_click',
            'type',
            'key',
            'key_combo',
            'scroll',
            'move',
            'drag',
            'open_app',
            'get_screen_size',
          ],
          description: 'The action to perform on the remote computer',
        },
        x: {
          type: 'number',
          description: 'X coordinate (pixels from left). Required for click, double_click, right_click, move actions.',
        },
        y: {
          type: 'number',
          description: 'Y coordinate (pixels from top). Required for click, double_click, right_click, move actions.',
        },
        text: {
          type: 'string',
          description: 'Text to type (for "type" action), key name (for "key" action like "return", "tab", "escape"), or key combo (for "key_combo" action like "cmd+c", "cmd+shift+s")',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction (for "scroll" action)',
        },
        amount: {
          type: 'number',
          description: 'Scroll amount (for "scroll" action, default: 3)',
        },
        end_x: {
          type: 'number',
          description: 'End X coordinate for drag action',
        },
        end_y: {
          type: 'number',
          description: 'End Y coordinate for drag action',
        },
        app_name: {
          type: 'string',
          description: 'Application name to open (for "open_app" action, e.g., "Safari", "Terminal", "Google Chrome")',
        },
        target: {
          type: 'string',
          description: 'Optional: specific target agent ID. Defaults to the current agent\'s machine.',
        },
      },
      required: ['action'],
    },
  };

  private vncControlScript: string;

  constructor(private config: ComputerUseConfig) {
    // Resolve path to vnc-control.py
    // Priority: env var > package root > src dir > cwd-based
    if (process.env['JARVIS_VNC_CONTROL_SCRIPT']) {
      this.vncControlScript = process.env['JARVIS_VNC_CONTROL_SCRIPT'];
    } else {
      const thisDir = dirname(fileURLToPath(import.meta.url));
      // When running from dist/, the script is at ../vnc-control.py
      // When running from src/, it's at ./vnc-control.py
      this.vncControlScript = resolve(thisDir, '..', 'vnc-control.py');
    }
    log.info(`VNC control script: ${this.vncControlScript}`);
  }

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as ComputerAction;
    const target = (params['target'] as string) || context.agentId;

    if (!action) return createErrorResult('Missing required parameter: action');

    // Resolve target host
    const hostConfig = this.config.hosts[target];
    if (!hostConfig) {
      const available = Object.keys(this.config.hosts).join(', ');
      return createErrorResult(`No host configured for target "${target}". Available: ${available}`);
    }

    log.info(`Computer action: ${action} on ${hostConfig.host} (target: ${target})`);

    try {
      switch (action) {
        case 'screenshot':
          return await this.vncAction(hostConfig, 'screenshot');

        case 'click':
          return await this.vncAction(hostConfig, 'click', [String(params['x']), String(params['y'])]);

        case 'double_click':
          return await this.vncAction(hostConfig, 'doubleclick', [String(params['x']), String(params['y'])]);

        case 'right_click':
          return await this.vncAction(hostConfig, 'rightclick', [String(params['x']), String(params['y'])]);

        case 'type':
          return await this.vncAction(hostConfig, 'type', [params['text'] as string]);

        case 'key':
          return await this.vncAction(hostConfig, 'key', [params['text'] as string]);

        case 'key_combo':
          return await this.vncAction(hostConfig, 'keycombo', [params['text'] as string]);

        case 'scroll': {
          const dir = (params['direction'] as string) || 'down';
          const amt = String(params['amount'] ?? 3);
          const args = [dir, amt];
          if (params['x'] !== undefined) args.push(String(params['x']), String(params['y']));
          return await this.vncAction(hostConfig, 'scroll', args);
        }

        case 'move':
          return await this.vncAction(hostConfig, 'move', [String(params['x']), String(params['y'])]);

        case 'drag':
          return await this.vncAction(hostConfig, 'drag', [
            String(params['x']), String(params['y']),
            String(params['end_x']), String(params['end_y']),
          ]);

        case 'open_app':
          return await this.openApp(hostConfig, params['app_name'] as string);

        case 'get_screen_size':
          return await this.vncAction(hostConfig, 'screensize');

        default:
          return createErrorResult(`Unknown action: ${action}`);
      }
    } catch (err) {
      log.error(`Computer action ${action} failed: ${(err as Error).message}`);
      return createErrorResult(`Computer action failed: ${(err as Error).message}`);
    }
  }

  /** Execute a VNC control action via the Python helper script */
  private vncAction(host: VncHostConfig, action: string, params: string[] = []): Promise<ToolResult> {
    return new Promise((resolve) => {
      const args = [
        this.vncControlScript,
        host.host,
        String(host.vncPort || 5900),
        host.vncPassword,
        action,
        ...params,
      ];

      log.info(`VNC: ${action} ${params.join(' ')}`);

      const proc = spawn('python3', args, {
        timeout: action === 'screenshot' ? 30000 : 15000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        resolve(createErrorResult(`VNC control failed: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve(createErrorResult(`VNC action failed: ${stderr || stdout}`));
          return;
        }

        const output = stdout.trim();

        // Handle screenshot (output is base64 PNG)
        if (action === 'screenshot') {
          // Output is base64 encoded PNG
          log.info(`Screenshot captured: ${(output.length / 1024).toFixed(0)}KB base64`);
          resolve({
            type: 'image',
            content: output,
            metadata: {
              mediaType: 'image/png',
            },
          });
          return;
        }

        // Handle screensize
        if (action === 'screensize') {
          const [w, h] = output.split('x').map(Number);
          resolve(createToolResult(`Screen size: ${w}x${h}`, { width: w, height: h }));
          return;
        }

        // All other actions return OK:action:details
        resolve(createToolResult(output));
      });
    });
  }

  /** Open an app via SSH */
  private async openApp(host: VncHostConfig, appName: string): Promise<ToolResult> {
    if (!appName) return createErrorResult('Missing required parameter: app_name');

    if (!host.ssh) {
      return createErrorResult('SSH config not available for open_app action');
    }

    const result = await sshExecSimple(host.ssh,
      `open -a "${appName}" 2>&1 || open -a "${appName}.app" 2>&1`,
      15000
    );

    if (result.code !== 0) {
      return createErrorResult(`Failed to open ${appName}: ${result.stderr || result.stdout}`);
    }

    return createToolResult(`Opened application: ${appName}`);
  }
}
