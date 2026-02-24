/**
 * Base interfaces and types for the tool system.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolResult {
  type: 'text' | 'image' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  agentId: string;
  workspacePath: string;
  nasPath: string;
  sessionId?: string;
  cwd?: string;
}

export interface AgentTool {
  definition: ToolDefinition;
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export function createToolResult(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { type: 'text', content, metadata };
}

export function createErrorResult(error: string, metadata?: Record<string, unknown>): ToolResult {
  return { type: 'error', content: error, metadata };
}
