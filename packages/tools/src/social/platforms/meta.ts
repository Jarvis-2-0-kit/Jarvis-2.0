import { createLogger } from '@jarvis/shared';
import type { ToolResult } from '../../base.js';
import { createToolResult, createErrorResult } from '../../base.js';

const log = createLogger('tool:social:meta');

const GRAPH_API_URL = 'https://graph.facebook.com/v21.0';

export interface FacebookConfig {
  accessToken: string;
  pageId: string;
}

/**
 * Facebook/Meta Graph API client.
 * Handles posting to pages, getting insights, and managing content.
 */
export class FacebookClient {
  constructor(private config: FacebookConfig) {}

  /** Publish a text post to page */
  async publishPost(message: string, link?: string): Promise<ToolResult> {
    try {
      const body: Record<string, string> = {
        message,
        access_token: this.config.accessToken,
      };
      if (link) body['link'] = link;

      const response = await fetch(`${GRAPH_API_URL}/${this.config.pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Facebook post failed: ${err}`);
      }

      const data = await response.json() as { id?: string };
      return createToolResult(`Post published to Facebook.\nPost ID: ${data.id}`, { postId: data.id });
    } catch (err) {
      return createErrorResult(`Facebook post failed: ${(err as Error).message}`);
    }
  }

  /** Publish a photo post */
  async publishPhoto(imageUrl: string, caption: string): Promise<ToolResult> {
    try {
      const response = await fetch(`${GRAPH_API_URL}/${this.config.pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: imageUrl,
          caption,
          access_token: this.config.accessToken,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Photo post failed: ${err}`);
      }

      const data = await response.json() as { id?: string; post_id?: string };
      return createToolResult(`Photo posted to Facebook.\nPost ID: ${data.post_id ?? data.id}`);
    } catch (err) {
      return createErrorResult(`Photo post failed: ${(err as Error).message}`);
    }
  }

  /** Get page insights */
  async getPageInsights(period: 'day' | 'week' | 'days_28' = 'day'): Promise<ToolResult> {
    try {
      const metrics = [
        'page_impressions', 'page_engaged_users', 'page_fan_adds',
        'page_views_total', 'page_post_engagements',
      ].join(',');

      const url = new URL(`${GRAPH_API_URL}/${this.config.pageId}/insights`);
      url.searchParams.set('metric', metrics);
      url.searchParams.set('period', period);
      url.searchParams.set('access_token', this.config.accessToken);

      const response = await fetch(url.toString());
      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Insights failed: ${err}`);
      }

      const data = await response.json() as { data?: Array<{ name: string; values?: Array<{ value?: number }> }> };
      const insights = (data.data ?? []).map((m) => {
        const val = m.values?.[0]?.value ?? 0;
        return `  ${m.name}: ${val}`;
      });

      return createToolResult(`Facebook Page Insights (${period}):\n${insights.join('\n')}`);
    } catch (err) {
      return createErrorResult(`Insights failed: ${(err as Error).message}`);
    }
  }

  /** Get recent posts from page */
  async getPagePosts(limit = 10): Promise<ToolResult> {
    try {
      const url = new URL(`${GRAPH_API_URL}/${this.config.pageId}/posts`);
      url.searchParams.set('fields', 'message,created_time,likes.summary(true),comments.summary(true),shares');
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('access_token', this.config.accessToken);

      const response = await fetch(url.toString());
      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Posts fetch failed: ${err}`);
      }

      const data = await response.json() as FacebookPostsResponse;
      const posts = (data.data ?? []).map((p, i) =>
        `${i + 1}. [${p.created_time}] ${(p.message ?? '').slice(0, 80)}... | Likes: ${p.likes?.summary?.total_count ?? 0} | Comments: ${p.comments?.summary?.total_count ?? 0} | Shares: ${p.shares?.count ?? 0}`,
      );

      return createToolResult(`Recent Posts (${posts.length}):\n${posts.join('\n')}`);
    } catch (err) {
      return createErrorResult(`Posts fetch failed: ${(err as Error).message}`);
    }
  }
}

interface FacebookPostsResponse {
  data?: Array<{
    id?: string;
    message?: string;
    created_time?: string;
    likes?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
    shares?: { count?: number };
  }>;
}
