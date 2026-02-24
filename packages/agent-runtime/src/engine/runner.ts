import { createLogger, type AgentId, HEARTBEAT_INTERVAL } from '@jarvis/shared';
import {
  ProviderRegistry, type ProviderRegistryConfig,
  type ChatRequest, type ChatResponse, type ChatChunk,
  type Message, type ContentBlock, type ToolUseBlock, type ToolResultBlock,
  createUsageAccumulator, mergeUsage, type UsageAccumulator,
} from '../llm/index.js';
import { type ToolRegistry } from '@jarvis/tools';
import { NatsHandler, type NatsHandlerConfig, type TaskAssignment } from '../communication/nats-handler.js';
import { SessionManager } from '../sessions/session-manager.js';
import { buildSystemPrompt, type AgentRole, type PromptContext } from '../system-prompt/index.js';
import {
  loadPlugins,
  loadSkills,
  buildSkillsPromptSection,
  type LoadedPluginSystem,
  type HookRunner,
  type PluginRegistry as PluginReg,
} from '../plugins/index.js';

const log = createLogger('agent:runner');

const MAX_TOOL_ROUNDS = 50;
const MAX_CONSECUTIVE_ERRORS = 5;

export interface AgentRunnerConfig {
  agentId: AgentId;
  role: AgentRole;
  machineId: string;
  hostname: string;
  natsUrl: string;
  natsUrlThunderbolt?: string;
  nasMountPath: string;
  workspacePath: string;
  capabilities: string[];
  llm: ProviderRegistryConfig;
  defaultModel: string;
  tools: ToolRegistry;
}

/**
 * AgentRunner - Core execution engine that runs on each Mac Mini.
 *
 * Lifecycle:
 * 1. Connect to NATS and register with Gateway
 * 2. Load plugins, skills, and hooks
 * 3. Subscribe to task assignments
 * 4. For each task: build context -> hooks -> LLM loop -> tools -> hooks -> report result
 * 5. Send heartbeats
 *
 * Adapted from OpenClaw's Pi Agent runner pattern, with full plugin lifecycle hooks.
 */
export class AgentRunner {
  private running = false;
  private nats: NatsHandler;
  private providers: ProviderRegistry;
  private sessions: SessionManager;
  private tools: ToolRegistry;
  private currentTask: TaskAssignment | null = null;
  private currentSessionId: string | null = null;

  // Plugin system
  private pluginSystem: LoadedPluginSystem | null = null;
  private hooks: HookRunner | null = null;
  private pluginRegistry: PluginReg | null = null;
  private serviceStopFns: Array<() => void> = [];

  constructor(private readonly config: AgentRunnerConfig) {
    this.providers = new ProviderRegistry(config.llm);
    this.tools = config.tools;
    this.sessions = new SessionManager(config.nasMountPath, config.agentId);
    this.nats = new NatsHandler({
      agentId: config.agentId,
      role: config.role as 'dev' | 'marketing',
      natsUrl: config.natsUrl,
      natsUrlThunderbolt: config.natsUrlThunderbolt,
      capabilities: config.capabilities,
      machineId: config.machineId,
      hostname: config.hostname,
    });
  }

  async start(): Promise<void> {
    log.info(`Starting agent ${this.config.agentId} (${this.config.role}) on ${this.config.hostname}`);
    this.running = true;

    // Initialize sessions directory
    await this.sessions.init();

    // ─── Load Plugin System ───
    try {
      this.pluginSystem = await loadPlugins({
        runtimeConfig: {
          agentId: this.config.agentId,
          role: this.config.role,
          hostname: this.config.hostname,
          workspacePath: this.config.workspacePath,
          nasPath: this.config.nasMountPath,
          defaultModel: this.config.defaultModel,
        },
        nasPath: this.config.nasMountPath,
        enableBuiltins: true,
      });
      this.hooks = this.pluginSystem.hookRunner;
      this.pluginRegistry = this.pluginSystem.registry;

      // Start plugin services
      this.serviceStopFns = await this.pluginSystem.registry.startServices();

      log.info(`Plugin system ready: ${this.pluginSystem.registry.getSummary()}`);
    } catch (err) {
      log.warn(`Plugin system failed to load (continuing without plugins): ${(err as Error).message}`);
    }

    // ─── Fire agent_start hook ───
    if (this.hooks) {
      await this.hooks.runAgentStart(
        { agentId: this.config.agentId, role: this.config.role, hostname: this.config.hostname },
        { agentId: this.config.agentId },
      );
    }

    // Connect to NATS
    await this.nats.connect();

    // Set up task handler
    this.nats.onTask((task) => {
      this.handleTask(task).catch((err) => {
        log.error(`Task handler error: ${(err as Error).message}`);
      });
    });

    // Set up chat handler
    this.nats.onChat((msg) => {
      this.handleChat(msg).catch((err) => {
        log.error(`Chat handler error: ${(err as Error).message}`);
      });
    });

    log.info(`Agent ${this.config.agentId} is ready and listening for tasks`);
  }

  async stop(): Promise<void> {
    log.info(`Stopping agent ${this.config.agentId}`);
    this.running = false;

    // Fire agent_end hook
    if (this.hooks) {
      await this.hooks.runAgentEnd(
        { agentId: this.config.agentId, reason: 'shutdown' },
        { agentId: this.config.agentId },
      );
    }

    // Stop plugin services
    for (const stopFn of this.serviceStopFns) {
      try { stopFn(); } catch { /* ignore */ }
    }

    await this.nats.updateStatus('offline');
    await this.nats.disconnect();
  }

  /** Handle an incoming task assignment */
  private async handleTask(task: TaskAssignment): Promise<void> {
    if (this.currentTask) {
      log.warn(`Already processing task ${this.currentTask.taskId}, rejecting ${task.taskId}`);
      return;
    }

    this.currentTask = task;
    log.info(`Starting task: ${task.taskId} - ${task.title}`);

    // Fire task_assigned hook
    if (this.hooks) {
      await this.hooks.runTaskAssigned(
        { taskId: task.taskId, title: task.title, description: task.description, priority: task.priority },
        { agentId: this.config.agentId },
      );
    }

    try {
      await this.nats.updateStatus('busy', task.taskId, task.title);

      const sessionId = await this.sessions.createSession(task.taskId);
      this.currentSessionId = sessionId;

      // Fire session_start hook
      if (this.hooks) {
        await this.hooks.runSessionStart(
          { sessionId, agentId: this.config.agentId, taskId: task.taskId },
          { agentId: this.config.agentId, sessionId },
        );
      }

      const systemPrompt = await this.buildEnhancedSystemPrompt({
        currentTask: `Task: ${task.title}\n\nDescription: ${task.description}\nPriority: ${task.priority}`,
      });

      const userMessage = task.description || task.title;

      // Fire message_received hook
      if (this.hooks) {
        await this.hooks.runMessageReceived(
          { role: 'user', content: userMessage, source: 'task' },
          { agentId: this.config.agentId, sessionId },
        );
      }

      const result = await this.runAgentLoop(sessionId, systemPrompt, userMessage);

      // Fire session_end hook
      if (this.hooks) {
        await this.hooks.runSessionEnd(
          { sessionId, agentId: this.config.agentId, tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
          { agentId: this.config.agentId, sessionId },
        );
      }

      await this.nats.publishResult(task.taskId, {
        success: true,
        output: result.output,
        artifacts: result.artifacts,
      });

      this.nats.trackTaskComplete(true);

      // Fire task_completed hook
      if (this.hooks) {
        await this.hooks.runTaskCompleted(
          { taskId: task.taskId, output: result.output, artifacts: result.artifacts },
          { agentId: this.config.agentId, sessionId },
        );
      }

      await this.nats.broadcastDashboard('task.completed', {
        taskId: task.taskId,
        agentId: this.config.agentId,
        output: result.output.slice(0, 500),
      });

      log.info(`Task completed: ${task.taskId}`);
    } catch (err) {
      log.error(`Task failed: ${task.taskId} - ${(err as Error).message}`);

      // Fire task_failed hook
      if (this.hooks) {
        await this.hooks.runTaskFailed(
          { taskId: task.taskId, error: (err as Error).message },
          { agentId: this.config.agentId },
        );
      }

      await this.nats.publishResult(task.taskId, {
        success: false,
        output: `Error: ${(err as Error).message}`,
      });

      this.nats.trackTaskComplete(false);

      await this.nats.broadcastDashboard('task.failed', {
        taskId: task.taskId,
        agentId: this.config.agentId,
        error: (err as Error).message,
      });
    } finally {
      this.currentTask = null;
      this.currentSessionId = null;
      await this.nats.updateStatus('idle');
    }
  }

  /** Handle chat messages from dashboard */
  private async handleChat(msg: { from: string; content: string }): Promise<void> {
    if (!this.currentSessionId) {
      const sessionId = await this.sessions.createSession();
      this.currentSessionId = sessionId;

      // Fire session_start hook for new chat session
      if (this.hooks) {
        await this.hooks.runSessionStart(
          { sessionId, agentId: this.config.agentId },
          { agentId: this.config.agentId, sessionId },
        );
      }
    }

    const systemPrompt = await this.buildEnhancedSystemPrompt();

    try {
      await this.nats.updateStatus('busy', undefined, `Chat: ${msg.content.slice(0, 60)}`);
      log.info(`Processing chat from ${msg.from}: ${msg.content.slice(0, 100)}`);

      // Fire message_received hook
      if (this.hooks) {
        await this.hooks.runMessageReceived(
          { role: 'user', content: msg.content, source: 'chat' },
          { agentId: this.config.agentId, sessionId: this.currentSessionId },
        );
      }

      const result = await this.runAgentLoop(this.currentSessionId, systemPrompt, msg.content);

      await this.nats.sendChatResponse(result.output);
      log.info(`Chat response sent (${result.output.length} chars)`);
    } catch (err) {
      log.error(`Chat error: ${(err as Error).message}`);
      await this.nats.sendChatResponse(`Error: ${(err as Error).message}`);
    } finally {
      if (!this.currentTask) {
        await this.nats.updateStatus('idle');
      }
    }
  }

  /**
   * Build enhanced system prompt with plugin sections and skills.
   */
  private async buildEnhancedSystemPrompt(options?: { currentTask?: string }): Promise<string> {
    // Base prompt from templates
    let systemPrompt = buildSystemPrompt({
      agentId: this.config.agentId,
      role: this.config.role,
      hostname: this.config.hostname,
      workspacePath: this.config.workspacePath,
      nasPath: this.config.nasMountPath,
      currentTask: options?.currentTask,
      capabilities: this.tools.listTools(),
    });

    // ─── Add skills section ───
    const skills = loadSkills(this.config.nasMountPath);
    if (skills.length > 0) {
      systemPrompt += '\n\n' + buildSkillsPromptSection(skills);
    }

    // ─── Add plugin prompt sections ───
    if (this.pluginRegistry) {
      const sections = this.pluginRegistry.getPromptSections();
      for (const section of sections) {
        systemPrompt += `\n\n## ${section.title}\n\n${section.content}`;
      }
    }

    // ─── Fire before_prompt_build hook ───
    if (this.hooks) {
      const hookResult = await this.hooks.runBeforePromptBuild(
        {
          role: this.config.role,
          agentId: this.config.agentId,
          currentTask: options?.currentTask,
        },
        { agentId: this.config.agentId, sessionId: this.currentSessionId ?? undefined },
      );

      if (hookResult) {
        if (hookResult.systemPromptOverride) {
          systemPrompt = hookResult.systemPromptOverride;
        }
        if (hookResult.prependContext) {
          systemPrompt = hookResult.prependContext + '\n\n' + systemPrompt;
        }
        if (hookResult.appendContext) {
          systemPrompt += '\n\n' + hookResult.appendContext;
        }
      }
    }

    return systemPrompt;
  }

  /**
   * Get combined tool definitions (core tools + plugin tools).
   */
  private getToolDefinitions(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    const coreTools = this.tools.getDefinitions();

    // Add plugin tools
    if (this.pluginRegistry) {
      const pluginTools = this.pluginRegistry.resolveTools({
        agentId: this.config.agentId,
        workspacePath: this.config.workspacePath,
        nasPath: this.config.nasMountPath,
        sessionId: this.currentSessionId ?? undefined,
      });

      const pluginDefs = pluginTools.map((t) => t.definition);
      // Deduplicate by name (core tools take priority)
      const coreNames = new Set(coreTools.map(t => t.name));
      const uniquePluginDefs = pluginDefs.filter(d => !coreNames.has(d.name));

      return [...coreTools, ...uniquePluginDefs];
    }

    return coreTools;
  }

  /**
   * Execute a tool by name, checking core tools first then plugin tools.
   */
  private async executeTool(
    name: string,
    params: Record<string, unknown>,
    context: { agentId: string; workspacePath: string; nasPath: string; sessionId: string },
  ) {
    // Try core tools first
    if (this.tools.has(name)) {
      return this.tools.execute(name, params, context);
    }

    // Try plugin tools
    if (this.pluginRegistry) {
      const pluginTools = this.pluginRegistry.resolveTools({
        agentId: context.agentId,
        workspacePath: context.workspacePath,
        nasPath: context.nasPath,
        sessionId: context.sessionId,
      });

      const pluginTool = pluginTools.find(t => t.definition.name === name);
      if (pluginTool) {
        return pluginTool.execute(params, context);
      }
    }

    return { type: 'error' as const, content: `Unknown tool: ${name}` };
  }

  /**
   * Core agent loop: LLM -> parse -> tools -> LLM -> repeat
   *
   * This is the heart of the agent execution engine.
   * Now with full plugin hook integration.
   */
  private async runAgentLoop(
    sessionId: string,
    systemPrompt: string,
    userMessage: string,
  ): Promise<{ output: string; artifacts: string[] }> {
    const messages: Message[] = [];
    const usage = createUsageAccumulator();
    const artifacts: string[] = [];
    let consecutiveErrors = 0;
    let activeModel = this.config.defaultModel;

    // Load existing context if resuming
    const existingMessages = await this.sessions.loadMessagesForContext(sessionId);
    messages.push(...existingMessages);

    // Add the new user message
    messages.push({ role: 'user', content: userMessage });
    await this.sessions.appendMessage(sessionId, 'user', userMessage);

    // ─── Hook: before_model_resolve ───
    if (this.hooks) {
      const modelResult = await this.hooks.runBeforeModelResolve(
        { prompt: userMessage, currentModel: activeModel },
        { agentId: this.config.agentId, sessionId },
      );
      if (modelResult?.modelOverride) {
        log.info(`Model overridden by plugin: ${activeModel} -> ${modelResult.modelOverride}`);
        activeModel = modelResult.modelOverride;
      }
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (!this.running) break;

      log.info(`Agent loop round ${round + 1}/${MAX_TOOL_ROUNDS}`);

      const toolDefs = this.getToolDefinitions();

      const request: ChatRequest = {
        model: activeModel,
        messages,
        system: systemPrompt,
        tools: toolDefs,
        max_tokens: 8192,
        stream: false,
      };

      // ─── Hook: llm_input ───
      if (this.hooks) {
        const llmInputResult = await this.hooks.runLlmInput(
          {
            model: activeModel,
            messages: messages as unknown[],
            systemPrompt,
            tools: toolDefs as unknown[],
          },
          { agentId: this.config.agentId, sessionId },
        );
        if (llmInputResult?.systemPromptOverride) {
          request.system = llmInputResult.systemPromptOverride;
        }
      }

      // Call LLM
      let response: ChatResponse;
      try {
        response = await this.providers.chat(request);
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        log.error(`LLM call failed (attempt ${consecutiveErrors}): ${(err as Error).message}`);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`LLM failed ${MAX_CONSECUTIVE_ERRORS} times consecutively`);
        }
        await new Promise((r) => setTimeout(r, 2000 * consecutiveErrors));
        continue;
      }

      // Track usage
      mergeUsage(usage, response.usage);
      await this.sessions.appendUsage(sessionId, response.usage);

      // ─── Hook: llm_output ───
      if (this.hooks) {
        await this.hooks.runLlmOutput(
          {
            model: activeModel,
            content: response.content as unknown[],
            stopReason: response.stopReason,
            usage: response.usage,
          },
          { agentId: this.config.agentId, sessionId },
        );
      }

      // Add assistant response to messages
      messages.push({ role: 'assistant', content: response.content });
      await this.sessions.appendMessage(sessionId, 'assistant', response.content);

      // Log progress
      this.logRound(round, response, usage);

      // Check if assistant is done (no tool calls)
      if (response.stopReason !== 'tool_use') {
        const textContent = response.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        return { output: textContent || '(Task completed with no text output)', artifacts };
      }

      // Execute tool calls
      const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) {
        const textContent = response.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        return { output: textContent || '(Task completed)', artifacts };
      }

      const toolResults: ContentBlock[] = [];

      for (const toolUse of toolUses) {
        log.info(`Executing tool: ${toolUse.name} (${toolUse.id})`);
        await this.sessions.appendToolCall(sessionId, toolUse.name, toolUse.id, toolUse.input);

        // ─── Hook: before_tool_call ───
        let toolInput = toolUse.input;
        if (this.hooks) {
          const beforeResult = await this.hooks.runBeforeToolCall(
            { toolName: toolUse.name, toolId: toolUse.id, input: toolUse.input },
            { agentId: this.config.agentId, sessionId },
          );
          if (beforeResult?.block) {
            log.warn(`Tool ${toolUse.name} blocked by plugin: ${beforeResult.blockReason ?? 'no reason'}`);
            const blockedResult: ToolResultBlock = {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Tool blocked by policy: ${beforeResult.blockReason ?? 'blocked by plugin hook'}`,
              is_error: true,
            };
            toolResults.push(blockedResult);
            continue;
          }
          if (beforeResult?.inputOverride) {
            toolInput = beforeResult.inputOverride;
          }
        }

        // Broadcast tool activity
        await this.nats.broadcastDashboard('agent.activity', {
          agentId: this.config.agentId,
          type: 'tool_call',
          tool: toolUse.name,
          input: JSON.stringify(toolInput).slice(0, 200),
        });

        const startTime = Date.now();
        let result = await this.executeTool(toolUse.name, toolInput, {
          agentId: this.config.agentId,
          workspacePath: this.config.workspacePath,
          nasPath: this.config.nasMountPath,
          sessionId,
        });
        const elapsed = Date.now() - startTime;

        // ─── Hook: after_tool_call ───
        if (this.hooks) {
          const afterResult = await this.hooks.runAfterToolCall(
            { toolName: toolUse.name, toolId: toolUse.id, input: toolInput, result, elapsed },
            { agentId: this.config.agentId, sessionId },
          );
          if (afterResult?.resultOverride) {
            result = afterResult.resultOverride;
          }
        }

        await this.sessions.appendToolResult(sessionId, toolUse.id, result);

        if (result.metadata?.['filePath']) {
          artifacts.push(result.metadata['filePath'] as string);
        }

        let toolResultContent: string | ContentBlock[];

        if (result.type === 'image') {
          // Image result (e.g., from screenshot) — send as image content block
          toolResultContent = [
            {
              type: 'image' as const,
              data: result.content,
              mediaType: (result.metadata?.['mediaType'] as 'image/png') || 'image/png',
            },
          ];
          log.info(`Tool ${toolUse.name} returned image (${(result.content.length / 1024).toFixed(0)}KB)`);
        } else {
          toolResultContent = result.content;
        }

        const toolResultBlock: ToolResultBlock = {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolResultContent,
          is_error: result.type === 'error',
        };

        toolResults.push(toolResultBlock);
      }

      // Add tool results as user message (Anthropic format)
      messages.push({ role: 'user', content: toolResults });

      // Report task progress
      if (this.currentTask) {
        await this.nats.publishProgress(this.currentTask.taskId, {
          step: `Round ${round + 1}: Executed ${toolUses.length} tool(s)`,
          percentage: Math.min(95, (round / MAX_TOOL_ROUNDS) * 100),
          log: toolUses.map((t) => t.name).join(', '),
        });
      }
    }

    // Hit max rounds
    const lastText = messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => typeof m.content === 'string' ? [m.content] : m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text))
      .pop();

    return {
      output: lastText ?? `(Task ended after ${MAX_TOOL_ROUNDS} rounds)`,
      artifacts,
    };
  }

  private logRound(round: number, response: ChatResponse, usage: UsageAccumulator): void {
    const toolCount = response.content.filter((b) => b.type === 'tool_use').length;
    const textLength = response.content
      .filter((b) => b.type === 'text')
      .reduce((sum, b) => sum + ((b as { text: string }).text?.length ?? 0), 0);

    log.info(
      `Round ${round + 1}: ${toolCount} tool calls, ${textLength} chars text, ` +
      `${response.usage.totalTokens} tokens (total: ${usage.totalTokens}), ` +
      `stop: ${response.stopReason}`,
    );
  }
}
