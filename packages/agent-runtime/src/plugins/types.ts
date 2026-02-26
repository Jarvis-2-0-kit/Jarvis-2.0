/**
 * Plugin system types — inspired by OpenClaw.
 *
 * Plugins can:
 * - Register tools (agent-callable functions)
 * - Register hooks (lifecycle callbacks at 15+ execution points)
 * - Register services (background tasks)
 * - Modify system prompts
 * - Provide skills (SKILL.md documentation files)
 */

import type { AgentTool, ToolResult, ToolContext } from '@jarvis/tools';

// ─── Plugin Definition ───────────────────────────────────────────────

export interface JarvisPluginDefinition {
  id: string;
  name: string;
  description?: string;
  version?: string;
  /** Plugin registration function */
  register: (api: PluginApi) => void | Promise<void>;
  /** Optional activation (called after all plugins register) */
  activate?: (api: PluginApi) => void | Promise<void>;
}

/** Shorthand: plugin can also be just a register function */
export type JarvisPluginModule =
  | JarvisPluginDefinition
  | ((api: PluginApi) => void | Promise<void>);

// ─── Plugin API (what plugins receive) ───────────────────────────────

export interface PluginApi {
  readonly id: string;
  readonly name: string;

  /** Full runtime config */
  readonly config: PluginRuntimeConfig;

  /** Plugin-specific config from plugins.json */
  readonly pluginConfig: Record<string, unknown>;

  /** Register a tool or tool factory */
  registerTool(tool: AgentTool | AgentTool[] | PluginToolFactory): void;

  /** Register a hook handler */
  registerHook<K extends PluginHookName>(
    name: K,
    handler: PluginHookHandler<K>,
    options?: { priority?: number },
  ): void;

  /** Shorthand: api.on('hook_name', handler) */
  on<K extends PluginHookName>(
    name: K,
    handler: PluginHookHandler<K>,
    options?: { priority?: number },
  ): void;

  /** Register a background service */
  registerService(service: PluginService): void;

  /** Register additional system prompt section */
  registerPromptSection(section: PromptSection): void;

  /** Logger scoped to this plugin */
  readonly logger: PluginLogger;

  /** Resolve a path relative to the plugin's directory */
  resolvePath(input: string): string;
}

export interface PluginRuntimeConfig {
  agentId: string;
  role: string;
  hostname: string;
  workspacePath: string;
  nasPath: string;
  defaultModel: string;
  delegateTask?: (targetAgent: string, task: { title: string; description: string; priority?: string }) => Promise<void>;
}

export interface PluginLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

// ─── Tool Factory ────────────────────────────────────────────────────

export interface PluginToolContext {
  agentId: string;
  sessionId?: string;
  workspacePath: string;
  nasPath: string;
}

export type PluginToolFactory = (ctx: PluginToolContext) => AgentTool | AgentTool[];

// ─── Hook System ─────────────────────────────────────────────────────

/**
 * Lifecycle hook names — inspired by OpenClaw's 23 hook points,
 * adapted for Jarvis 2.0 architecture.
 */
export type PluginHookName =
  // Model & prompt resolution
  | 'before_model_resolve'    // Override model/provider before LLM call
  | 'before_prompt_build'     // Modify system prompt / prepend context

  // LLM execution
  | 'llm_input'               // Just before calling LLM (inspect/modify request)
  | 'llm_output'              // LLM response received (inspect/modify response)

  // Tool execution
  | 'before_tool_call'        // Before tool execution (can block/modify)
  | 'after_tool_call'         // After tool executed (inspect/modify result)

  // Session lifecycle
  | 'session_start'           // New session created
  | 'session_end'             // Session completed

  // Agent lifecycle
  | 'agent_start'             // Agent starting a task/chat
  | 'agent_end'               // Agent finished task/chat

  // Message lifecycle
  | 'message_received'        // User/task message received
  | 'message_sending'         // About to send response

  // Task lifecycle
  | 'task_assigned'           // Task received from NATS
  | 'task_completed'          // Task finished
  | 'task_failed';            // Task errored

// ─── Hook Event Types ────────────────────────────────────────────────

export interface HookEvents {
  before_model_resolve: {
    prompt: string;
    currentModel: string;
  };
  before_prompt_build: {
    role: string;
    agentId: string;
    currentTask?: string;
  };
  llm_input: {
    model: string;
    messages: unknown[];
    systemPrompt: string;
    tools: unknown[];
  };
  llm_output: {
    model: string;
    content: unknown[];
    stopReason: string;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  };
  before_tool_call: {
    toolName: string;
    toolId: string;
    input: Record<string, unknown>;
  };
  after_tool_call: {
    toolName: string;
    toolId: string;
    input: Record<string, unknown>;
    result: ToolResult;
    elapsed: number;
  };
  session_start: {
    sessionId: string;
    agentId: string;
    taskId?: string;
  };
  session_end: {
    sessionId: string;
    agentId: string;
    tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  };
  agent_start: {
    agentId: string;
    role: string;
    hostname: string;
  };
  agent_end: {
    agentId: string;
    reason: string;
  };
  message_received: {
    role: string;
    content: string;
    source: 'task' | 'chat';
  };
  message_sending: {
    content: string;
    toolCalls: number;
  };
  task_assigned: {
    taskId: string;
    title: string;
    description: string;
    priority: string;
  };
  task_completed: {
    taskId: string;
    output: string;
    artifacts: string[];
  };
  task_failed: {
    taskId: string;
    error: string;
  };
}

// ─── Hook Results (what hooks can return to modify behavior) ─────────

export interface HookResults {
  before_model_resolve: {
    modelOverride?: string;
  } | void;
  before_prompt_build: {
    systemPromptOverride?: string;
    prependContext?: string;
    appendContext?: string;
  } | void;
  llm_input: {
    messagesOverride?: unknown[];
    systemPromptOverride?: string;
  } | void;
  llm_output: void;
  before_tool_call: {
    block?: boolean;
    blockReason?: string;
    inputOverride?: Record<string, unknown>;
  } | void;
  after_tool_call: {
    resultOverride?: ToolResult;
  } | void;
  session_start: void;
  session_end: void;
  agent_start: void;
  agent_end: void;
  message_received: void;
  message_sending: void;
  task_assigned: void;
  task_completed: void;
  task_failed: void;
}

export type PluginHookHandler<K extends PluginHookName> =
  (event: HookEvents[K], ctx: PluginHookContext) => HookResults[K] | Promise<HookResults[K]>;

export interface PluginHookContext {
  agentId: string;
  sessionId?: string;
  pluginId: string;
}

// ─── Hook Registration ───────────────────────────────────────────────

export interface PluginHookRegistration {
  pluginId: string;
  hookName: PluginHookName;
  handler: PluginHookHandler<PluginHookName>;
  priority: number;
}

// ─── Tool Registration ───────────────────────────────────────────────

export interface PluginToolRegistration {
  pluginId: string;
  tool?: AgentTool;
  tools?: AgentTool[];
  factory?: PluginToolFactory;
}

// ─── Service ─────────────────────────────────────────────────────────

export interface PluginService {
  name: string;
  /** Start the service; returns a stop function */
  start: () => Promise<(() => void) | void>;
}

// ─── Prompt Section ──────────────────────────────────────────────────

export interface PromptSection {
  /** Section title (e.g., "Memory", "Calendar") */
  title: string;
  /** Section content (Markdown) */
  content: string;
  /** Priority for ordering (higher = earlier). Default: 0 */
  priority?: number;
}

// ─── Skill Definition (SKILL.md) ─────────────────────────────────────

export interface SkillDefinition {
  /** Skill ID (derived from directory name) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Path to SKILL.md file */
  path: string;
  /** Optional: required tools/bins */
  requires?: { bins?: string[]; tools?: string[] };
  /** Optional: emoji for UI */
  emoji?: string;
}
