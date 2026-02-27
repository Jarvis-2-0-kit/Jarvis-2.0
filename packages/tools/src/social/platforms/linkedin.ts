import type { ToolResult } from '../../base.js';
import { createToolResult, createErrorResult } from '../../base.js';

const LINKEDIN_API_URL = 'https://api.linkedin.com/v2';

export interface LinkedInConfig {
  readonly accessToken: string;
  readonly organizationId?: string; // For company pages
  readonly personUrn?: string; // For personal profile (format: urn:li:person:xxx)
}

/**
 * LinkedIn API client.
 * Handles posting articles, shares, and getting analytics.
 */
export class LinkedInClient {
  constructor(private config: LinkedInConfig) {}

  /** Publish a share/post */
  async publishPost(text: string, options?: {
    articleUrl?: string;
    articleTitle?: string;
    articleDescription?: string;
    imageUrl?: string;
    visibility?: 'PUBLIC' | 'CONNECTIONS';
  }): Promise<ToolResult> {
    const author = this.config.organizationId
      ? `urn:li:organization:${this.config.organizationId}`
      : this.config.personUrn ?? '';

    if (!author) return createErrorResult('No LinkedIn author configured (need organizationId or personUrn)');

    try {
      const body: Record<string, unknown> = {
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: options?.articleUrl ? 'ARTICLE' : 'NONE',
            ...(options?.articleUrl ? {
              media: [{
                status: 'READY',
                originalUrl: options.articleUrl,
                title: { text: options.articleTitle ?? '' },
                description: { text: options.articleDescription ?? '' },
              }],
            } : {}),
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': options?.visibility ?? 'PUBLIC',
        },
      };

      const response = await fetch(`${LINKEDIN_API_URL}/ugcPosts`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`LinkedIn post failed: ${err}`);
      }

      const data = await response.json() as { id?: string };
      return createToolResult(`Posted to LinkedIn.\nPost ID: ${data.id}`, { postId: data.id });
    } catch (err) {
      return createErrorResult(`LinkedIn post failed: ${(err as Error).message}`);
    }
  }

  /** Get organization follower statistics */
  async getFollowerStats(): Promise<ToolResult> {
    if (!this.config.organizationId) {
      return createErrorResult('Organization ID required for follower stats');
    }

    try {
      const url = new URL(`${LINKEDIN_API_URL}/organizationalEntityFollowerStatistics`);
      url.searchParams.set('q', 'organizationalEntity');
      url.searchParams.set('organizationalEntity', `urn:li:organization:${this.config.organizationId}`);

      const response = await fetch(url.toString(), { headers: this.getHeaders() });
      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Follower stats failed: ${err}`);
      }

      const data = await response.json() as { elements?: Array<{ followerCounts?: { organicFollowerCount?: number; paidFollowerCount?: number } }> };
      const stats = data.elements?.[0]?.followerCounts;

      return createToolResult(
        `LinkedIn Follower Stats:\n` +
        `  Organic followers: ${stats?.organicFollowerCount ?? 0}\n` +
        `  Paid followers: ${stats?.paidFollowerCount ?? 0}\n` +
        `  Total: ${(stats?.organicFollowerCount ?? 0) + (stats?.paidFollowerCount ?? 0)}`,
      );
    } catch (err) {
      return createErrorResult(`Stats failed: ${(err as Error).message}`);
    }
  }

  /** Get share statistics for organization posts */
  async getShareStats(shareUrn: string): Promise<ToolResult> {
    try {
      const url = new URL(`${LINKEDIN_API_URL}/organizationalEntityShareStatistics`);
      url.searchParams.set('q', 'organizationalEntity');
      url.searchParams.set('organizationalEntity', `urn:li:organization:${this.config.organizationId}`);
      url.searchParams.set('shares', shareUrn);

      const response = await fetch(url.toString(), { headers: this.getHeaders() });
      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Share stats failed: ${err}`);
      }

      const data = await response.json() as { elements?: Array<{ totalShareStatistics?: LinkedInShareStats }> };
      const s = data.elements?.[0]?.totalShareStatistics;

      return createToolResult(
        `LinkedIn Share Stats:\n` +
        `  Impressions: ${s?.impressionCount ?? 0}\n` +
        `  Clicks: ${s?.clickCount ?? 0}\n` +
        `  Likes: ${s?.likeCount ?? 0}\n` +
        `  Comments: ${s?.commentCount ?? 0}\n` +
        `  Shares: ${s?.shareCount ?? 0}\n` +
        `  Engagement: ${s?.engagement ?? 0}`,
      );
    } catch (err) {
      return createErrorResult(`Share stats failed: ${(err as Error).message}`);
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }
}

interface LinkedInShareStats {
  impressionCount?: number;
  clickCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  engagement?: number;
}
