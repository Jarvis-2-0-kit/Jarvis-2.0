import { createLogger, NatsSubjects } from '@jarvis/shared';
import type { AgentTool, ToolContext, ToolResult } from './base.js';
import { createToolResult, createErrorResult } from './base.js';

const log = createLogger('tool:message-agent');

type NatsPublishFn = (subject: string, data: string) => Promise<void>;

/**
 * Inter-agent messaging tool via NATS.
 * Allows agents to send messages, queries, and notifications to other agents.
 */
export class MessageAgentTool implements AgentTool {
  private publish: NatsPublishFn;

  constructor(publishFn: NatsPublishFn) {
    this.publish = publishFn;
  }

  definition = {
    name: 'message_agent',
    description: 'Send a message to another agent in the Jarvis system. Use for coordination, delegating subtasks, or sharing information between Agent Alpha (Dev) and Agent Beta (Marketing).',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          enum: ['agent-alpha', 'agent-beta'],
          description: 'The target agent ID',
        },
        type: {
          type: 'string',
          enum: ['task', 'query', 'notification', 'result'],
          description: 'Message type',
        },
        content: {
          type: 'string',
          description: 'The message content',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'critical'],
          description: 'Message priority (default: normal)',
        },
      },
      required: ['to', 'type', 'content'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const to = params['to'] as string;
    const type = params['type'] as string;
    const content = params['content'] as string;
    const priority = (params['priority'] as string) || 'normal';

    if (!to) return createErrorResult('Missing required parameter: to');
    if (!type) return createErrorResult('Missing required parameter: type');
    if (!content) return createErrorResult('Missing required parameter: content');
    if (to === context.agentId) return createErrorResult('Cannot send a message to yourself');

    const message = {
      id: crypto.randomUUID(),
      from: context.agentId,
      to,
      type,
      payload: { content },
      priority,
      timestamp: Date.now(),
    };

    try {
      const subject = `jarvis.agent.${to}.task`;
      await this.publish(subject, JSON.stringify(message));
      log.info(`Sent ${type} message to ${to}: ${content.slice(0, 80)}`);
      return createToolResult(`Message sent to ${to} (type: ${type}, priority: ${priority})`);
    } catch (err) {
      return createErrorResult(`Failed to send message: ${(err as Error).message}`);
    }
  }
}
