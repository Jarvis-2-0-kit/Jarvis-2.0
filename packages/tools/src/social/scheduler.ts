import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@jarvis/shared';
import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';

const log = createLogger('tool:social:scheduler');

export interface ScheduledPost {
  id: string;
  platform: string;
  action: string;
  text: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  link?: string;
  title?: string;
  scheduledAt: number; // Unix timestamp ms
  status: 'scheduled' | 'published' | 'failed' | 'cancelled';
  createdAt: number;
  publishedAt?: number;
  error?: string;
}

/**
 * Social media post scheduler.
 * Stores scheduled posts as JSON on NAS for persistence.
 * The agent checks and publishes due posts during its loop.
 */
export class SocialSchedulerTool implements AgentTool {
  definition = {
    name: 'social_schedule',
    description: 'Schedule social media posts for future publishing. Manage a content calendar with scheduled posts across all platforms.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['schedule', 'list', 'cancel', 'reschedule'],
          description: 'Scheduler action',
        },
        platform: { type: 'string', description: 'Target platform' },
        post_type: { type: 'string', enum: ['post', 'photo', 'video', 'thread', 'carousel', 'reel'], description: 'Content type' },
        text: { type: 'string', description: 'Post content' },
        media_url: { type: 'string', description: 'Media URL' },
        scheduled_at: { type: 'string', description: 'ISO date string for when to publish (e.g. "2025-06-15T10:00:00Z")' },
        post_id: { type: 'string', description: 'Post ID (for cancel/reschedule)' },
      },
      required: ['action'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as string;
    const schedulePath = join(context.nasPath, 'config', 'social-schedule.json');

    switch (action) {
      case 'schedule': {
        const platform = params['platform'] as string;
        const text = params['text'] as string;
        const scheduledAt = params['scheduled_at'] as string;
        if (!platform || !text || !scheduledAt) {
          return createErrorResult('schedule requires: platform, text, scheduled_at');
        }

        const posts = await this.loadSchedule(schedulePath);
        const post: ScheduledPost = {
          id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          platform,
          action: (params['post_type'] as string) || 'post',
          text,
          mediaUrl: params['media_url'] as string | undefined,
          mediaUrls: params['media_urls'] as string[] | undefined,
          link: params['link'] as string | undefined,
          title: params['title'] as string | undefined,
          scheduledAt: new Date(scheduledAt).getTime(),
          status: 'scheduled',
          createdAt: Date.now(),
        };

        posts.push(post);
        await this.saveSchedule(schedulePath, posts);

        return createToolResult(
          `Post scheduled:\n  ID: ${post.id}\n  Platform: ${platform}\n  Scheduled: ${scheduledAt}\n  Text: ${text.slice(0, 80)}...`,
        );
      }

      case 'list': {
        const posts = await this.loadSchedule(schedulePath);
        const upcoming = posts
          .filter((p) => p.status === 'scheduled')
          .sort((a, b) => a.scheduledAt - b.scheduledAt);

        if (upcoming.length === 0) return createToolResult('No scheduled posts.');

        const list = upcoming.map((p, i) => {
          const when = new Date(p.scheduledAt).toISOString();
          return `${i + 1}. [${p.id}] ${p.platform} @ ${when}\n   ${p.text.slice(0, 60)}...`;
        });

        return createToolResult(`Scheduled posts (${upcoming.length}):\n${list.join('\n')}`);
      }

      case 'cancel': {
        const postId = params['post_id'] as string;
        if (!postId) return createErrorResult('cancel requires: post_id');

        const posts = await this.loadSchedule(schedulePath);
        const post = posts.find((p) => p.id === postId);
        if (!post) return createErrorResult(`Post not found: ${postId}`);
        if (post.status !== 'scheduled') return createErrorResult(`Post is already ${post.status}`);

        post.status = 'cancelled';
        await this.saveSchedule(schedulePath, posts);
        return createToolResult(`Post ${postId} cancelled.`);
      }

      case 'reschedule': {
        const postId = params['post_id'] as string;
        const newTime = params['scheduled_at'] as string;
        if (!postId || !newTime) return createErrorResult('reschedule requires: post_id, scheduled_at');

        const posts = await this.loadSchedule(schedulePath);
        const post = posts.find((p) => p.id === postId);
        if (!post) return createErrorResult(`Post not found: ${postId}`);

        post.scheduledAt = new Date(newTime).getTime();
        await this.saveSchedule(schedulePath, posts);
        return createToolResult(`Post ${postId} rescheduled to ${newTime}`);
      }

      default:
        return createErrorResult(`Unknown action: ${action}`);
    }
  }

  private async loadSchedule(path: string): Promise<ScheduledPost[]> {
    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as ScheduledPost[];
    } catch {
      return [];
    }
  }

  private async saveSchedule(path: string, posts: ScheduledPost[]): Promise<void> {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(posts, null, 2), 'utf-8');
  }
}
