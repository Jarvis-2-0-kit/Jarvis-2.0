/**
 * Workflow Engine Plugin — Multi-step automated workflows with conditions.
 *
 * Allows agents to:
 * - Define reusable workflow templates (YAML-like JSON definitions)
 * - Execute workflows with variables, branching, loops
 * - Chain tool calls with data flowing between steps
 * - Handle errors with retry/skip/abort strategies
 * - Trigger workflows manually, on events, or on schedule
 * - Pause/resume long-running workflows
 *
 * Inspired by: GitHub Actions, n8n, OpenClaw pipelines, Temporal.io
 *
 * Architecture:
 * - Workflow definitions stored on NAS as JSON (reusable templates)
 * - Workflow runs tracked in-memory + persisted to NAS
 * - Steps executed sequentially with optional parallel groups
 * - Variables interpolated at runtime ({{ vars.foo }})
 * - Conditions evaluated before each step
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JarvisPluginDefinition, PluginApi } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────

/**
 * A workflow step definition
 */
interface WorkflowStepDef {
  /** Unique step ID within workflow */
  id: string;
  /** Step display name */
  name: string;
  /** Action type */
  action: 'tool_call' | 'set_variable' | 'condition' | 'log' | 'notify' | 'wait' | 'delegate' | 'http' | 'script';
  /** Action parameters (varies by action type) */
  params: Record<string, unknown>;
  /** Condition: step runs only if this evaluates to true. Supports: {{ vars.x }}, comparisons. */
  condition?: string;
  /** On error: retry (with count), skip, or abort (default) */
  onError?: 'abort' | 'skip' | 'retry';
  /** Max retries if onError is 'retry' */
  retryCount?: number;
  /** Retry delay in ms */
  retryDelay?: number;
  /** Store step result in this variable name */
  outputVar?: string;
  /** Timeout in ms (0 = no timeout) */
  timeout?: number;
}

/**
 * A workflow definition (template)
 */
interface WorkflowDefinition {
  /** Unique workflow ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Version */
  version: string;
  /** Input parameters the workflow expects */
  inputs?: Record<string, { type: string; description?: string; default?: unknown; required?: boolean }>;
  /** Ordered list of steps */
  steps: WorkflowStepDef[];
  /** Default error handling strategy */
  defaultOnError?: 'abort' | 'skip' | 'retry';
  /** Tags for categorization */
  tags?: string[];
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
  /** Created by agent */
  createdBy?: string;
}

/**
 * A running workflow instance
 */
interface WorkflowRun {
  /** Unique run ID */
  runId: string;
  /** Workflow definition ID */
  workflowId: string;
  /** Workflow name (for display) */
  workflowName: string;
  /** Current status */
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  /** Variables scope for this run */
  variables: Record<string, unknown>;
  /** Input parameters provided at start */
  inputs: Record<string, unknown>;
  /** Step execution log */
  stepResults: StepResult[];
  /** Index of current step (for resume) */
  currentStepIndex: number;
  /** Started timestamp */
  startedAt: number;
  /** Completed/failed timestamp */
  endedAt?: number;
  /** Error if failed */
  error?: string;
  /** Agent that started this run */
  agentId: string;
}

interface StepResult {
  stepId: string;
  stepName: string;
  action: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  startedAt?: number;
  endedAt?: number;
  output?: unknown;
  error?: string;
  retryCount?: number;
  conditionMet?: boolean;
}

// ─── Expression Evaluator ─────────────────────────────────────────────

/**
 * Simple expression evaluator for workflow conditions and variable interpolation.
 * Supports: {{ vars.name }}, {{ steps.stepId.output }}, comparisons.
 */
function interpolateString(template: string, context: { vars: Record<string, unknown>; steps: Record<string, unknown> }): string {
  return template.replace(/\{\{\s*(.*?)\s*\}\}/g, (_match, expr: string) => {
    const value = evaluateExpression(expr.trim(), context);
    return value !== undefined ? String(value) : '';
  });
}

function interpolateParams(
  params: Record<string, unknown>,
  context: { vars: Record<string, unknown>; steps: Record<string, unknown> },
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      result[key] = interpolateString(value, context);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = interpolateParams(value as Record<string, unknown>, context);
    } else if (Array.isArray(value)) {
      result[key] = value.map(v =>
        typeof v === 'string' ? interpolateString(v, context) : v
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function evaluateExpression(expr: string, context: { vars: Record<string, unknown>; steps: Record<string, unknown> }): unknown {
  // Handle dot-notation access: vars.foo, steps.step1.output, etc.
  const parts = expr.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function evaluateCondition(condition: string, context: { vars: Record<string, unknown>; steps: Record<string, unknown> }): boolean {
  if (!condition || condition.trim() === '' || condition.trim() === 'true') return true;
  if (condition.trim() === 'false') return false;

  // Handle comparison operators
  const comparisons = [
    { op: '===', fn: (a: unknown, b: unknown) => a === b },
    { op: '!==', fn: (a: unknown, b: unknown) => a !== b },
    { op: '==', fn: (a: unknown, b: unknown) => String(a) === String(b) },
    { op: '!=', fn: (a: unknown, b: unknown) => String(a) !== String(b) },
    { op: '>=', fn: (a: unknown, b: unknown) => Number(a) >= Number(b) },
    { op: '<=', fn: (a: unknown, b: unknown) => Number(a) <= Number(b) },
    { op: '>', fn: (a: unknown, b: unknown) => Number(a) > Number(b) },
    { op: '<', fn: (a: unknown, b: unknown) => Number(a) < Number(b) },
    { op: ' contains ', fn: (a: unknown, b: unknown) => String(a).includes(String(b)) },
    { op: ' startsWith ', fn: (a: unknown, b: unknown) => String(a).startsWith(String(b)) },
    { op: ' endsWith ', fn: (a: unknown, b: unknown) => String(a).endsWith(String(b)) },
  ];

  for (const { op, fn } of comparisons) {
    const idx = condition.indexOf(op);
    if (idx > 0) {
      const leftExpr = condition.slice(0, idx).trim();
      const rightExpr = condition.slice(idx + op.length).trim();

      const left = resolveValue(leftExpr, context);
      const right = resolveValue(rightExpr, context);

      return fn(left, right);
    }
  }

  // Handle boolean checks: truthy evaluation
  const val = resolveValue(condition, context);
  return !!val;
}

function resolveValue(expr: string, context: { vars: Record<string, unknown>; steps: Record<string, unknown> }): unknown {
  // String literal
  if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
    return expr.slice(1, -1);
  }
  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(expr)) {
    return Number(expr);
  }
  // Boolean literal
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'null') return null;
  // Template expression
  if (expr.startsWith('{{') && expr.endsWith('}}')) {
    return evaluateExpression(expr.slice(2, -2).trim(), context);
  }
  // Dot-notation (vars.foo, steps.step1.output)
  return evaluateExpression(expr, context);
}

// ─── Step Executors ───────────────────────────────────────────────────

type StepExecutor = (
  step: WorkflowStepDef,
  params: Record<string, unknown>,
  run: WorkflowRun,
  api: PluginApi,
) => Promise<unknown>;

const stepExecutors: Record<string, StepExecutor> = {
  tool_call: async (step, params, _run, _api) => {
    // Execute a Jarvis tool by name
    // In real execution, the agent would call the tool through the agent loop
    // Here we store the tool call request for the agent to execute
    return {
      action: 'tool_call',
      tool: params.tool as string,
      input: params.input ?? params,
      description: `Execute tool: ${params.tool}`,
    };
  },

  set_variable: async (_step, params, run, _api) => {
    // Set one or more variables
    for (const [key, value] of Object.entries(params)) {
      if (key !== '__description') {
        run.variables[key] = value;
      }
    }
    return { set: Object.keys(params).filter(k => k !== '__description') };
  },

  condition: async (step, params, _run, _api) => {
    // Evaluate condition and return branch
    const condition = params.condition as string || params.if as string || '';
    const context = {
      vars: _run.variables,
      steps: buildStepsContext(_run),
    };
    const result = evaluateCondition(condition, context);
    return {
      condition,
      result,
      branch: result ? (params.then as string || 'continue') : (params.else as string || 'skip'),
    };
  },

  log: async (_step, params, _run, api) => {
    const message = params.message as string || params.text as string || '';
    const level = (params.level as string || 'info') as 'info' | 'warn' | 'error' | 'debug';
    api.logger[level](`[workflow] ${message}`);
    return { logged: message, level };
  },

  notify: async (_step, params, _run, _api) => {
    // Create a notification request (will be picked up by notification plugin)
    return {
      action: 'notify',
      title: params.title as string || 'Workflow Notification',
      message: params.message as string || '',
      priority: params.priority as string || 'normal',
      channel: params.channel as string || 'all',
    };
  },

  wait: async (_step, params, _run, _api) => {
    const ms = Number(params.duration ?? params.ms ?? 1000);
    const maxWait = 30000; // Cap at 30s to prevent blocking
    const actualWait = Math.min(ms, maxWait);
    await new Promise(resolve => setTimeout(resolve, actualWait));
    return { waited: actualWait };
  },

  delegate: async (_step, params, _run, _api) => {
    // Create a delegation request for the task planner plugin
    return {
      action: 'delegate',
      targetAgent: params.targetAgent as string || 'agent-smith',
      title: params.title as string || '',
      description: params.description as string || '',
      priority: params.priority as string || 'normal',
    };
  },

  http: async (_step, params, _run, _api) => {
    // HTTP request (uses Node fetch)
    const url = params.url as string;
    const method = (params.method as string || 'GET').toUpperCase();
    const headers = params.headers as Record<string, string> || {};
    const body = params.body as string | undefined;

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? body : undefined,
        signal: AbortSignal.timeout(30000),
      });

      const contentType = response.headers.get('content-type') || '';
      let responseBody: unknown;
      if (contentType.includes('json')) {
        responseBody = await response.json();
      } else {
        const text = await response.text();
        responseBody = text.length > 2000 ? text.slice(0, 2000) + '...(truncated)' : text;
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
        ok: response.ok,
      };
    } catch (err) {
      throw new Error(`HTTP ${method} ${url} failed: ${(err as Error).message}`);
    }
  },

  script: async (_step, params, _run, _api) => {
    // Evaluate a simple expression / compute
    // This is intentionally limited for safety
    const expression = params.expression as string || params.code as string || '';
    const operation = params.operation as string;

    if (operation === 'json_parse') {
      return JSON.parse(params.input as string);
    }
    if (operation === 'json_stringify') {
      return JSON.stringify(params.input, null, 2);
    }
    if (operation === 'concat') {
      return (params.values as string[])?.join(params.separator as string || '') ?? '';
    }
    if (operation === 'split') {
      return (params.input as string)?.split(params.separator as string || ',') ?? [];
    }
    if (operation === 'regex_match') {
      const match = new RegExp(params.pattern as string, params.flags as string || '').exec(params.input as string);
      return match ? { matched: true, groups: match.slice(1), full: match[0] } : { matched: false };
    }
    if (operation === 'math') {
      const a = Number(params.a ?? 0);
      const b = Number(params.b ?? 0);
      const op = params.op as string;
      if (op === '+' || op === 'add') return a + b;
      if (op === '-' || op === 'subtract') return a - b;
      if (op === '*' || op === 'multiply') return a * b;
      if (op === '/' || op === 'divide') return b !== 0 ? a / b : 'division by zero';
      if (op === '%' || op === 'modulo') return a % b;
    }
    if (operation === 'template') {
      // Interpolate a template string with current variables
      const template = params.template as string || '';
      return interpolateString(template, {
        vars: _run.variables,
        steps: buildStepsContext(_run),
      });
    }
    if (operation === 'pick') {
      // Pick specific keys from an object
      const obj = params.input as Record<string, unknown> || {};
      const keys = params.keys as string[] || [];
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (key in obj) result[key] = obj[key];
      }
      return result;
    }
    if (operation === 'length') {
      const input = params.input;
      if (Array.isArray(input)) return input.length;
      if (typeof input === 'string') return input.length;
      if (typeof input === 'object' && input !== null) return Object.keys(input).length;
      return 0;
    }

    // Default: return expression as-is (useful for passing data through)
    return expression || params;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────

function buildStepsContext(run: WorkflowRun): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  for (const sr of run.stepResults) {
    ctx[sr.stepId] = {
      status: sr.status,
      output: sr.output,
      error: sr.error,
    };
  }
  return ctx;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Plugin ───────────────────────────────────────────────────────────

export function createWorkflowEnginePlugin(): JarvisPluginDefinition {
  // In-memory state
  const workflows = new Map<string, WorkflowDefinition>();
  const activeRuns = new Map<string, WorkflowRun>();
  const completedRuns: WorkflowRun[] = []; // Keep last N

  const MAX_COMPLETED_RUNS = 50;
  const MAX_STEPS_PER_WORKFLOW = 100;

  return {
    id: 'jarvis-workflow-engine',
    name: 'Workflow Engine',
    description: 'Multi-step automated workflows with conditions, variables, and error handling',
    version: '1.0.0',

    register: (api) => {
      const log = api.logger;
      const nasPath = api.config.nasPath;
      const workflowsDir = join(nasPath, 'workflows');
      const runsDir = join(nasPath, 'workflow-runs');

      // Ensure directories
      for (const dir of [workflowsDir, runsDir]) {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      }

      // Load existing workflow definitions from NAS
      loadWorkflowsFromDisk(workflowsDir, workflows, log);

      // ─── Tool: workflow_create ───────────────────────────────────

      api.registerTool({
        definition: {
          name: 'workflow_create',
          description: [
            'Create a new workflow definition (reusable template).',
            'Workflows are multi-step automations that chain tool calls, conditions, and data.',
            '',
            'Step action types:',
            '  tool_call   — Call a Jarvis tool (params: { tool: "exec", input: { command: "ls" } })',
            '  set_variable — Set workflow variables (params: { key: "value" })',
            '  condition   — Branch based on condition (params: { if: "vars.x == true", then: "continue", else: "skip" })',
            '  log         — Log a message (params: { message: "...", level: "info" })',
            '  notify      — Send notification (params: { title: "...", message: "..." })',
            '  wait        — Pause execution (params: { duration: 5000 })',
            '  delegate    — Delegate to another agent (params: { targetAgent: "agent-johny", title: "...", description: "..." })',
            '  http        — Make HTTP request (params: { url: "...", method: "GET", headers: {}, body: "..." })',
            '  script      — Data manipulation (params: { operation: "concat|split|math|regex_match|template|pick|length", ... })',
            '',
            'Variable interpolation: Use {{ vars.name }} or {{ steps.stepId.output }} in params.',
            '',
            'Example: Deploy workflow with build + test + notify',
            '  steps: [',
            '    { id: "build", name: "Build", action: "tool_call", params: { tool: "exec", input: { command: "pnpm build" } }, outputVar: "buildResult" },',
            '    { id: "test", name: "Test", action: "tool_call", params: { tool: "exec", input: { command: "pnpm test" } }, onError: "skip", outputVar: "testResult" },',
            '    { id: "notify", name: "Notify", action: "notify", params: { title: "Build done", message: "Build: {{ vars.buildResult }}" } }',
            '  ]',
          ].join('\n'),
          input_schema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Workflow name',
              },
              description: {
                type: 'string',
                description: 'What this workflow does',
              },
              inputs: {
                type: 'object',
                description: 'Input parameter definitions: { paramName: { type: "string", description: "...", default: "...", required: true } }',
              },
              steps: {
                type: 'array',
                description: 'Ordered list of workflow steps',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Unique step ID' },
                    name: { type: 'string', description: 'Step display name' },
                    action: {
                      type: 'string',
                      enum: ['tool_call', 'set_variable', 'condition', 'log', 'notify', 'wait', 'delegate', 'http', 'script'],
                      description: 'Action type',
                    },
                    params: { type: 'object', description: 'Action parameters' },
                    condition: { type: 'string', description: 'Run condition (empty = always)' },
                    onError: { type: 'string', enum: ['abort', 'skip', 'retry'], description: 'Error handling' },
                    retryCount: { type: 'number', description: 'Max retries (default: 3)' },
                    retryDelay: { type: 'number', description: 'Retry delay in ms (default: 1000)' },
                    outputVar: { type: 'string', description: 'Store result in this variable' },
                    timeout: { type: 'number', description: 'Step timeout in ms' },
                  },
                  required: ['id', 'name', 'action', 'params'],
                },
              },
              defaultOnError: {
                type: 'string',
                enum: ['abort', 'skip', 'retry'],
                description: 'Default error handling (default: abort)',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorization',
              },
            },
            required: ['name', 'steps'],
          },
        },
        execute: async (params) => {
          const steps = params.steps as WorkflowStepDef[];
          if (steps.length > MAX_STEPS_PER_WORKFLOW) {
            return { type: 'error', content: `Too many steps (max ${MAX_STEPS_PER_WORKFLOW})` };
          }

          const workflowId = generateId('wf');
          const now = Date.now();

          const definition: WorkflowDefinition = {
            id: workflowId,
            name: params.name as string,
            description: (params.description as string) || '',
            version: '1.0.0',
            inputs: params.inputs as WorkflowDefinition['inputs'],
            steps: steps.map(s => ({
              id: s.id || generateId('step'),
              name: s.name || s.id,
              action: s.action,
              params: s.params || {},
              condition: s.condition,
              onError: s.onError,
              retryCount: s.retryCount,
              retryDelay: s.retryDelay,
              outputVar: s.outputVar,
              timeout: s.timeout,
            })),
            defaultOnError: (params.defaultOnError as WorkflowDefinition['defaultOnError']) || 'abort',
            tags: params.tags as string[] || [],
            createdAt: now,
            updatedAt: now,
            createdBy: api.config.agentId,
          };

          workflows.set(workflowId, definition);
          saveWorkflow(workflowsDir, definition);

          log.info(`[workflow-engine] Created workflow: ${workflowId} "${definition.name}" (${steps.length} steps)`);

          const visual = buildWorkflowVisual(definition);
          return {
            type: 'text',
            content: `✅ Workflow created: ${workflowId}\n\n${visual}\n\nUse \`workflow_run\` with workflowId="${workflowId}" to execute it.`,
          };
        },
      });

      // ─── Tool: workflow_run ─────────────────────────────────────

      api.registerTool({
        definition: {
          name: 'workflow_run',
          description: [
            'Execute a workflow by ID. Steps are executed sequentially.',
            'Provide input values if the workflow expects them.',
            '',
            'For tool_call steps, the result contains the tool call definition',
            'that the agent should execute. Check the run status with workflow_status.',
          ].join('\n'),
          input_schema: {
            type: 'object',
            properties: {
              workflowId: {
                type: 'string',
                description: 'Workflow ID to execute',
              },
              inputs: {
                type: 'object',
                description: 'Input values for the workflow',
              },
              dryRun: {
                type: 'boolean',
                description: 'If true, validate and show what would execute without actually running',
              },
            },
            required: ['workflowId'],
          },
        },
        execute: async (params) => {
          const workflowId = params.workflowId as string;
          const definition = workflows.get(workflowId);

          if (!definition) {
            return { type: 'error', content: `Workflow not found: ${workflowId}. Use workflow_list to see available workflows.` };
          }

          const inputs = (params.inputs as Record<string, unknown>) || {};
          const dryRun = params.dryRun as boolean || false;

          // Validate required inputs
          if (definition.inputs) {
            for (const [key, schema] of Object.entries(definition.inputs)) {
              if (schema.required && !(key in inputs)) {
                if (schema.default !== undefined) {
                  inputs[key] = schema.default;
                } else {
                  return { type: 'error', content: `Missing required input: ${key} (${schema.description || schema.type})` };
                }
              }
            }
          }

          if (dryRun) {
            return {
              type: 'text',
              content: buildDryRunPreview(definition, inputs),
            };
          }

          // Create run instance
          const runId = generateId('run');
          const run: WorkflowRun = {
            runId,
            workflowId,
            workflowName: definition.name,
            status: 'running',
            variables: { ...inputs },
            inputs,
            stepResults: [],
            currentStepIndex: 0,
            startedAt: Date.now(),
            agentId: api.config.agentId,
          };

          activeRuns.set(runId, run);
          log.info(`[workflow-engine] Starting run ${runId} of workflow "${definition.name}"`);

          // Execute steps sequentially
          try {
            for (let i = 0; i < definition.steps.length; i++) {
              if (run.status === 'paused' || run.status === 'cancelled') break;

              const stepDef = definition.steps[i];
              run.currentStepIndex = i;

              const context = {
                vars: run.variables,
                steps: buildStepsContext(run),
              };

              // Check condition
              const conditionMet = stepDef.condition
                ? evaluateCondition(interpolateString(stepDef.condition, context), context)
                : true;

              const stepResult: StepResult = {
                stepId: stepDef.id,
                stepName: stepDef.name,
                action: stepDef.action,
                status: 'pending',
                conditionMet,
              };

              if (!conditionMet) {
                stepResult.status = 'skipped';
                stepResult.output = 'Condition not met';
                run.stepResults.push(stepResult);
                log.info(`[workflow-engine] Step ${stepDef.id} skipped (condition: ${stepDef.condition})`);
                continue;
              }

              // Execute step with retry logic
              const errorStrategy = stepDef.onError || definition.defaultOnError || 'abort';
              const maxRetries = errorStrategy === 'retry' ? (stepDef.retryCount ?? 3) : 0;
              let lastError: Error | null = null;

              stepResult.status = 'running';
              stepResult.startedAt = Date.now();
              run.stepResults.push(stepResult);

              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                  // Interpolate params with current context
                  const interpolatedParams = interpolateParams(stepDef.params, {
                    vars: run.variables,
                    steps: buildStepsContext(run),
                  });

                  // Get executor
                  const executor = stepExecutors[stepDef.action];
                  if (!executor) {
                    throw new Error(`Unknown step action: ${stepDef.action}`);
                  }

                  // Execute with optional timeout
                  let output: unknown;
                  if (stepDef.timeout && stepDef.timeout > 0) {
                    output = await Promise.race([
                      executor(stepDef, interpolatedParams, run, api),
                      new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Step timed out after ${stepDef.timeout}ms`)), stepDef.timeout)
                      ),
                    ]);
                  } else {
                    output = await executor(stepDef, interpolatedParams, run, api);
                  }

                  // Store result
                  stepResult.status = 'completed';
                  stepResult.output = output;
                  stepResult.endedAt = Date.now();
                  stepResult.retryCount = attempt;

                  // Store in variable if requested
                  if (stepDef.outputVar) {
                    run.variables[stepDef.outputVar] = output;
                  }

                  log.info(`[workflow-engine] Step ${stepDef.id} completed${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);
                  lastError = null;
                  break;
                } catch (err) {
                  lastError = err as Error;
                  stepResult.retryCount = attempt;

                  if (attempt < maxRetries) {
                    const delay = stepDef.retryDelay ?? 1000;
                    log.warn(`[workflow-engine] Step ${stepDef.id} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                  }
                }
              }

              if (lastError) {
                stepResult.status = 'failed';
                stepResult.error = lastError.message;
                stepResult.endedAt = Date.now();

                if (errorStrategy === 'abort') {
                  run.status = 'failed';
                  run.error = `Step "${stepDef.name}" failed: ${lastError.message}`;
                  run.endedAt = Date.now();
                  log.error(`[workflow-engine] Run ${runId} aborted at step ${stepDef.id}: ${lastError.message}`);
                  break;
                } else if (errorStrategy === 'skip') {
                  stepResult.status = 'skipped';
                  log.warn(`[workflow-engine] Step ${stepDef.id} failed, skipping: ${lastError.message}`);
                }
              }
            }

            // Finalize run
            if (run.status === 'running') {
              run.status = 'completed';
              run.endedAt = Date.now();
              log.info(`[workflow-engine] Run ${runId} completed successfully`);
            }
          } catch (err) {
            run.status = 'failed';
            run.error = (err as Error).message;
            run.endedAt = Date.now();
            log.error(`[workflow-engine] Run ${runId} failed: ${(err as Error).message}`);
          }

          // Move to completed and persist
          activeRuns.delete(runId);
          completedRuns.unshift(run);
          if (completedRuns.length > MAX_COMPLETED_RUNS) {
            completedRuns.pop();
          }
          saveRun(runsDir, run);

          return {
            type: 'text',
            content: buildRunSummary(run),
          };
        },
      });

      // ─── Tool: workflow_status ──────────────────────────────────

      api.registerTool({
        definition: {
          name: 'workflow_status',
          description: 'Get the status of a workflow run, or list recent runs.',
          input_schema: {
            type: 'object',
            properties: {
              runId: {
                type: 'string',
                description: 'Run ID to check. Omit to list recent runs.',
              },
              limit: {
                type: 'number',
                description: 'Max runs to list (default: 10)',
              },
            },
          },
        },
        execute: async (params) => {
          if (params.runId) {
            const run = activeRuns.get(params.runId as string)
              ?? completedRuns.find(r => r.runId === params.runId)
              ?? loadRun(runsDir, params.runId as string);

            if (!run) {
              return { type: 'error', content: `Run not found: ${params.runId}` };
            }

            return { type: 'text', content: buildRunSummary(run) };
          }

          // List recent runs
          const limit = Number(params.limit ?? 10);
          const allRuns = [
            ...Array.from(activeRuns.values()),
            ...completedRuns,
          ].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);

          if (allRuns.length === 0) {
            return { type: 'text', content: 'No workflow runs found. Use `workflow_run` to execute a workflow.' };
          }

          const lines = allRuns.map(r => {
            const elapsed = r.endedAt
              ? `${((r.endedAt - r.startedAt) / 1000).toFixed(1)}s`
              : `${((Date.now() - r.startedAt) / 1000).toFixed(1)}s (running)`;
            const stepsOk = r.stepResults.filter(s => s.status === 'completed').length;
            const stepsTotal = r.stepResults.length;
            const icon = statusIcon(r.status);
            return `  ${icon} ${r.runId}: "${r.workflowName}" [${r.status}] — ${stepsOk}/${stepsTotal} steps — ${elapsed}`;
          });

          return { type: 'text', content: `Recent workflow runs:\n${lines.join('\n')}` };
        },
      });

      // ─── Tool: workflow_list ────────────────────────────────────

      api.registerTool({
        definition: {
          name: 'workflow_list',
          description: 'List all available workflow definitions. Use to find workflow IDs for execution.',
          input_schema: {
            type: 'object',
            properties: {
              tag: {
                type: 'string',
                description: 'Filter by tag',
              },
            },
          },
        },
        execute: async (params) => {
          const tag = params.tag as string | undefined;
          let wfs = Array.from(workflows.values());

          if (tag) {
            wfs = wfs.filter(w => w.tags?.includes(tag));
          }

          wfs.sort((a, b) => b.updatedAt - a.updatedAt);

          if (wfs.length === 0) {
            return { type: 'text', content: 'No workflows found. Use `workflow_create` to define one.' };
          }

          const lines = wfs.map(w => {
            const tags = w.tags?.length ? ` [${w.tags.join(', ')}]` : '';
            const inputCount = w.inputs ? Object.keys(w.inputs).length : 0;
            return `  📋 ${w.id}: "${w.name}" — ${w.steps.length} steps${inputCount > 0 ? `, ${inputCount} inputs` : ''}${tags}`;
          });

          return {
            type: 'text',
            content: `Available workflows (${wfs.length}):\n${lines.join('\n')}\n\nUse \`workflow_run\` with a workflow ID to execute.`,
          };
        },
      });

      // ─── Tool: workflow_delete ──────────────────────────────────

      api.registerTool({
        definition: {
          name: 'workflow_delete',
          description: 'Delete a workflow definition.',
          input_schema: {
            type: 'object',
            properties: {
              workflowId: {
                type: 'string',
                description: 'Workflow ID to delete',
              },
            },
            required: ['workflowId'],
          },
        },
        execute: async (params) => {
          const workflowId = params.workflowId as string;
          const wf = workflows.get(workflowId);

          if (!wf) {
            return { type: 'error', content: `Workflow not found: ${workflowId}` };
          }

          workflows.delete(workflowId);

          // Remove from disk
          const filePath = join(workflowsDir, `${workflowId}.json`);
          try {
            if (existsSync(filePath)) {
              const { unlinkSync } = await import('node:fs');
              unlinkSync(filePath);
            }
          } catch {
            // Ignore delete errors
          }

          log.info(`[workflow-engine] Deleted workflow: ${workflowId} "${wf.name}"`);
          return { type: 'text', content: `✅ Workflow deleted: ${workflowId} "${wf.name}"` };
        },
      });

      // ─── Tool: workflow_inspect ─────────────────────────────────

      api.registerTool({
        definition: {
          name: 'workflow_inspect',
          description: 'View the full definition of a workflow including all steps, conditions, and configuration.',
          input_schema: {
            type: 'object',
            properties: {
              workflowId: {
                type: 'string',
                description: 'Workflow ID to inspect',
              },
            },
            required: ['workflowId'],
          },
        },
        execute: async (params) => {
          const workflowId = params.workflowId as string;
          const wf = workflows.get(workflowId);

          if (!wf) {
            return { type: 'error', content: `Workflow not found: ${workflowId}` };
          }

          return {
            type: 'text',
            content: buildWorkflowInspection(wf),
          };
        },
      });

      // ─── Tool: workflow_clone ───────────────────────────────────

      api.registerTool({
        definition: {
          name: 'workflow_clone',
          description: 'Clone an existing workflow with a new name. Useful for creating variations.',
          input_schema: {
            type: 'object',
            properties: {
              workflowId: {
                type: 'string',
                description: 'Source workflow ID to clone',
              },
              newName: {
                type: 'string',
                description: 'Name for the cloned workflow',
              },
            },
            required: ['workflowId', 'newName'],
          },
        },
        execute: async (params) => {
          const source = workflows.get(params.workflowId as string);
          if (!source) {
            return { type: 'error', content: `Workflow not found: ${params.workflowId}` };
          }

          const newId = generateId('wf');
          const now = Date.now();
          const cloned: WorkflowDefinition = {
            ...JSON.parse(JSON.stringify(source)),
            id: newId,
            name: params.newName as string,
            createdAt: now,
            updatedAt: now,
            createdBy: api.config.agentId,
          };

          workflows.set(newId, cloned);
          saveWorkflow(workflowsDir, cloned);

          log.info(`[workflow-engine] Cloned ${params.workflowId} → ${newId} "${cloned.name}"`);
          return {
            type: 'text',
            content: `✅ Workflow cloned: ${newId} "${cloned.name}" (from ${params.workflowId})`,
          };
        },
      });

      // ─── Prompt Section ─────────────────────────────────────────

      api.registerPromptSection({
        title: 'Workflow Engine',
        priority: 7,
        content: [
          '### Automated Workflows',
          '',
          'Use the workflow engine for repeatable multi-step automations:',
          '',
          '1. **workflow_create** — Define a reusable workflow template with steps',
          '2. **workflow_run** — Execute a workflow (with optional inputs and dry-run)',
          '3. **workflow_status** — Check run progress or list recent runs',
          '4. **workflow_list** — See all available workflow definitions',
          '5. **workflow_inspect** — View full workflow definition details',
          '6. **workflow_delete** — Remove a workflow',
          '7. **workflow_clone** — Duplicate a workflow for modification',
          '',
          '### Step Types:',
          '- `tool_call` — Call any Jarvis tool',
          '- `set_variable` — Set workflow-scoped variables',
          '- `condition` — Conditional branching (if/then/else)',
          '- `log` — Log a message',
          '- `notify` — Send a notification',
          '- `wait` — Pause execution',
          '- `delegate` — Delegate to another agent',
          '- `http` — Make HTTP requests',
          '- `script` — Data manipulation (concat, split, math, regex, template)',
          '',
          '### Variable Interpolation:',
          '- `{{ vars.myVar }}` — Access workflow variables',
          '- `{{ steps.stepId.output }}` — Access a previous step\'s output',
          '- Variables are set via `set_variable` steps, workflow inputs, or `outputVar` on steps',
          '',
          '### Error Handling:',
          '- `abort` — Stop workflow on error (default)',
          '- `skip` — Skip failed step and continue',
          '- `retry` — Retry failed step (configurable count and delay)',
          '',
          '### Example Workflow:',
          '```json',
          '{',
          '  "name": "Deploy App",',
          '  "steps": [',
          '    { "id": "build", "name": "Build", "action": "tool_call", "params": { "tool": "exec", "input": { "command": "pnpm build" } }, "outputVar": "buildResult" },',
          '    { "id": "check", "name": "Check Build", "action": "condition", "params": { "if": "steps.build.status == completed" } },',
          '    { "id": "notify", "name": "Done", "action": "notify", "params": { "title": "Deploy", "message": "Build finished!" } }',
          '  ]',
          '}',
          '```',
        ].join('\n'),
      });

      // ─── Hooks ──────────────────────────────────────────────────

      // Auto-report workflow results on task completion
      api.on('task_completed', async (event) => {
        // Check if any workflow runs were associated with this task
        const relatedRuns = completedRuns.filter(r => r.agentId === api.config.agentId);
        if (relatedRuns.length > 0) {
          log.info(`[workflow-engine] Task ${event.taskId} completed with ${relatedRuns.length} workflow run(s)`);
        }
      });

      log.info(`[workflow-engine] Workflow Engine plugin registered with 7 tools + prompt section (${workflows.size} workflows loaded)`);
    },
  };
}

// ─── File I/O ─────────────────────────────────────────────────────────

function saveWorkflow(dir: string, wf: WorkflowDefinition): void {
  writeFileSync(join(dir, `${wf.id}.json`), JSON.stringify(wf, null, 2));
}

function saveRun(dir: string, run: WorkflowRun): void {
  writeFileSync(join(dir, `${run.runId}.json`), JSON.stringify(run, null, 2));
}

function loadRun(dir: string, runId: string): WorkflowRun | undefined {
  const filePath = join(dir, `${runId}.json`);
  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function loadWorkflowsFromDisk(
  dir: string,
  map: Map<string, WorkflowDefinition>,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): void {
  if (!existsSync(dir)) return;
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const wf = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as WorkflowDefinition;
        if (wf.id && wf.steps) {
          map.set(wf.id, wf);
        }
      } catch {
        log.warn(`[workflow-engine] Failed to load workflow file: ${file}`);
      }
    }
    if (files.length > 0) {
      log.info(`[workflow-engine] Loaded ${map.size} workflows from disk`);
    }
  } catch {
    // Directory might not exist yet
  }
}

// ─── Visual Builders ──────────────────────────────────────────────────

function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    running: '🔵',
    completed: '✅',
    failed: '❌',
    paused: '⏸️',
    cancelled: '🚫',
    skipped: '⏭️',
    pending: '⬜',
  };
  return icons[status] ?? '❓';
}

function buildWorkflowVisual(wf: WorkflowDefinition): string {
  const lines = [
    `📋 Workflow: ${wf.name}`,
    `   ID: ${wf.id}`,
    wf.description ? `   Description: ${wf.description}` : '',
    `   Steps: ${wf.steps.length}`,
    `   Default error handling: ${wf.defaultOnError || 'abort'}`,
    '',
    '   Flow:',
  ].filter(Boolean);

  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i];
    const isLast = i === wf.steps.length - 1;
    const connector = isLast ? '   └─' : '   ├─';
    const condition = step.condition ? ` [if: ${step.condition}]` : '';
    const errorStr = step.onError ? ` (${step.onError})` : '';
    const outputStr = step.outputVar ? ` → $${step.outputVar}` : '';
    lines.push(`${connector} ${step.id}: ${step.name} (${step.action})${condition}${errorStr}${outputStr}`);
  }

  if (wf.inputs && Object.keys(wf.inputs).length > 0) {
    lines.push('');
    lines.push('   Inputs:');
    for (const [key, schema] of Object.entries(wf.inputs)) {
      const req = schema.required ? ' (required)' : '';
      const def = schema.default !== undefined ? ` [default: ${JSON.stringify(schema.default)}]` : '';
      lines.push(`     - ${key}: ${schema.type}${req}${def}`);
    }
  }

  return lines.join('\n');
}

function buildWorkflowInspection(wf: WorkflowDefinition): string {
  const lines = [
    `╔══════════════════════════════════════════════════╗`,
    `║  Workflow: ${wf.name.padEnd(38)}║`,
    `╚══════════════════════════════════════════════════╝`,
    '',
    `ID:          ${wf.id}`,
    `Version:     ${wf.version}`,
    `Description: ${wf.description || '(none)'}`,
    `Created:     ${new Date(wf.createdAt).toISOString()}`,
    `Updated:     ${new Date(wf.updatedAt).toISOString()}`,
    `Created by:  ${wf.createdBy || 'unknown'}`,
    `Tags:        ${wf.tags?.join(', ') || '(none)'}`,
    `Error mode:  ${wf.defaultOnError || 'abort'}`,
    '',
  ];

  // Inputs
  if (wf.inputs && Object.keys(wf.inputs).length > 0) {
    lines.push('📥 Inputs:');
    for (const [key, schema] of Object.entries(wf.inputs)) {
      const req = schema.required ? '✱ ' : '  ';
      const def = schema.default !== undefined ? ` = ${JSON.stringify(schema.default)}` : '';
      lines.push(`  ${req}${key} (${schema.type})${def}`);
      if (schema.description) lines.push(`      ${schema.description}`);
    }
    lines.push('');
  }

  // Steps
  lines.push(`📋 Steps (${wf.steps.length}):`);
  lines.push('─'.repeat(50));

  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i];
    lines.push(`  Step ${i + 1}: ${step.name}`);
    lines.push(`    ID:     ${step.id}`);
    lines.push(`    Action: ${step.action}`);
    if (step.condition) lines.push(`    If:     ${step.condition}`);
    if (step.onError) lines.push(`    Error:  ${step.onError}${step.retryCount ? ` (${step.retryCount}x, ${step.retryDelay ?? 1000}ms delay)` : ''}`);
    if (step.outputVar) lines.push(`    Output: → $${step.outputVar}`);
    if (step.timeout) lines.push(`    Timeout: ${step.timeout}ms`);
    lines.push(`    Params: ${JSON.stringify(step.params, null, 2).split('\n').join('\n            ')}`);
    if (i < wf.steps.length - 1) lines.push('    ↓');
  }

  return lines.join('\n');
}

function buildRunSummary(run: WorkflowRun): string {
  const elapsed = run.endedAt
    ? `${((run.endedAt - run.startedAt) / 1000).toFixed(1)}s`
    : `${((Date.now() - run.startedAt) / 1000).toFixed(1)}s (running)`;

  const completedSteps = run.stepResults.filter(s => s.status === 'completed').length;
  const skippedSteps = run.stepResults.filter(s => s.status === 'skipped').length;
  const failedSteps = run.stepResults.filter(s => s.status === 'failed').length;
  const totalSteps = run.stepResults.length;

  const barLen = 20;
  const progress = totalSteps > 0 ? completedSteps / totalSteps : 0;
  const filled = Math.round(progress * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  const lines = [
    `${statusIcon(run.status)} Workflow Run: ${run.workflowName}`,
    `   Run ID: ${run.runId}`,
    `   Workflow: ${run.workflowId}`,
    `   Status: ${run.status}`,
    `   Duration: ${elapsed}`,
    `   Progress: [${bar}] ${completedSteps}/${totalSteps} (${skippedSteps} skipped, ${failedSteps} failed)`,
    '',
  ];

  if (run.error) {
    lines.push(`   ❌ Error: ${run.error}`);
    lines.push('');
  }

  if (Object.keys(run.inputs).length > 0) {
    lines.push('   Inputs:');
    for (const [k, v] of Object.entries(run.inputs)) {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      const truncated = val.length > 80 ? val.slice(0, 80) + '...' : val;
      lines.push(`     ${k}: ${truncated}`);
    }
    lines.push('');
  }

  // Step results
  lines.push('   Steps:');
  for (const sr of run.stepResults) {
    const icon = statusIcon(sr.status);
    const dur = sr.startedAt && sr.endedAt
      ? ` (${((sr.endedAt - sr.startedAt) / 1000).toFixed(1)}s)`
      : '';
    const retry = sr.retryCount && sr.retryCount > 0 ? ` [retry ${sr.retryCount}]` : '';
    lines.push(`     ${icon} ${sr.stepId}: ${sr.stepName} — ${sr.action}${dur}${retry}`);

    if (sr.output && sr.status === 'completed') {
      const outStr = typeof sr.output === 'string'
        ? sr.output
        : JSON.stringify(sr.output);
      const truncated = outStr.length > 120 ? outStr.slice(0, 120) + '...' : outStr;
      lines.push(`        └─ ${truncated}`);
    }
    if (sr.error) {
      lines.push(`        └─ ⚠️ ${sr.error}`);
    }
  }

  // Variables
  const varKeys = Object.keys(run.variables);
  if (varKeys.length > 0) {
    lines.push('');
    lines.push(`   Variables (${varKeys.length}):`);
    for (const key of varKeys.slice(0, 20)) {
      const val = typeof run.variables[key] === 'string'
        ? run.variables[key] as string
        : JSON.stringify(run.variables[key]);
      const truncated = (val as string).length > 80 ? (val as string).slice(0, 80) + '...' : val;
      lines.push(`     $${key} = ${truncated}`);
    }
    if (varKeys.length > 20) {
      lines.push(`     ... and ${varKeys.length - 20} more`);
    }
  }

  return lines.join('\n');
}

function buildDryRunPreview(wf: WorkflowDefinition, inputs: Record<string, unknown>): string {
  const lines = [
    `🔍 Dry Run Preview: ${wf.name}`,
    `   Workflow: ${wf.id}`,
    '',
    '   Inputs provided:',
  ];

  if (Object.keys(inputs).length > 0) {
    for (const [k, v] of Object.entries(inputs)) {
      lines.push(`     ${k}: ${JSON.stringify(v)}`);
    }
  } else {
    lines.push('     (none)');
  }

  lines.push('');
  lines.push('   Steps that would execute:');

  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i];
    const num = `${i + 1}`.padStart(2, ' ');
    const condition = step.condition ? ` [IF: ${step.condition}]` : '';
    const error = step.onError ? ` (on error: ${step.onError})` : '';
    lines.push(`   ${num}. ${step.name} (${step.action})${condition}${error}`);

    // Show params with variable references highlighted
    const paramStr = JSON.stringify(step.params);
    const refs = paramStr.match(/\{\{.*?\}\}/g) || [];
    if (refs.length > 0) {
      lines.push(`       Variable refs: ${refs.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('   ℹ️ This is a preview only — no steps were executed.');
  lines.push('   Remove dryRun flag to actually execute the workflow.');

  return lines.join('\n');
}
