import { createLogger } from '@jarvis/shared';
import type { ToolResult } from '../../base.js';
import { createToolResult, createErrorResult } from '../../base.js';

const log = createLogger('tool:social:tiktok');

const TIKTOK_API_URL = 'https://open.tiktokapis.com/v2';

export interface TikTokConfig {
  accessToken: string;
  openId?: string;
}

/**
 * TikTok Business API client.
 * Handles video publishing, analytics, and content management.
 */
export class TikTokClient {
  constructor(private config: TikTokConfig) {}

  /** Initiate video publish (upload video from URL) */
  async publishVideo(videoUrl: string, options: {
    title: string;
    privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;
  }): Promise<ToolResult> {
    try {
      const response = await fetch(`${TIKTOK_API_URL}/post/publish/video/init/`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          post_info: {
            title: options.title,
            privacy_level: options.privacyLevel ?? 'PUBLIC_TO_EVERYONE',
            disable_comment: options.disableComment ?? false,
            disable_duet: options.disableDuet ?? false,
            disable_stitch: options.disableStitch ?? false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videoUrl,
          },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`TikTok publish failed: ${err}`);
      }

      const data = await response.json() as { data?: { publish_id?: string } };
      return createToolResult(
        `Video publish initiated.\nPublish ID: ${data.data?.publish_id}`,
        { publishId: data.data?.publish_id },
      );
    } catch (err) {
      return createErrorResult(`TikTok publish failed: ${(err as Error).message}`);
    }
  }

  /** Check video publish status */
  async getPublishStatus(publishId: string): Promise<ToolResult> {
    try {
      const response = await fetch(`${TIKTOK_API_URL}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ publish_id: publishId }),
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Status check failed: ${err}`);
      }

      const data = await response.json() as {
        data?: { status?: string; publicaly_available_post_id?: string[] };
      };

      return createToolResult(
        `Publish status: ${data.data?.status ?? 'unknown'}\n` +
        `Video IDs: ${(data.data?.publicaly_available_post_id ?? []).join(', ') || 'pending'}`,
      );
    } catch (err) {
      return createErrorResult(`Status check failed: ${(err as Error).message}`);
    }
  }

  /** Get user videos list */
  async getVideos(maxCount = 20): Promise<ToolResult> {
    try {
      const response = await fetch(`${TIKTOK_API_URL}/video/list/`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          max_count: maxCount,
          fields: ['id', 'title', 'create_time', 'like_count', 'comment_count', 'share_count', 'view_count'],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Video list failed: ${err}`);
      }

      const data = await response.json() as TikTokVideoListResponse;
      const videos = (data.data?.videos ?? []).map((v, i) =>
        `${i + 1}. "${v.title}" | Views: ${v.view_count ?? 0} | Likes: ${v.like_count ?? 0} | Comments: ${v.comment_count ?? 0} | Shares: ${v.share_count ?? 0}`,
      );

      return createToolResult(`TikTok Videos (${videos.length}):\n${videos.join('\n')}`);
    } catch (err) {
      return createErrorResult(`Video list failed: ${(err as Error).message}`);
    }
  }

  /** Query video analytics */
  async getVideoAnalytics(videoIds: string[]): Promise<ToolResult> {
    try {
      const response = await fetch(`${TIKTOK_API_URL}/video/query/`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          filters: { video_ids: videoIds },
          fields: ['id', 'title', 'like_count', 'comment_count', 'share_count', 'view_count', 'create_time'],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Analytics failed: ${err}`);
      }

      const data = await response.json() as TikTokVideoListResponse;
      const videos = (data.data?.videos ?? []).map((v) => (
        `Video: ${v.title}\n` +
        `  Views: ${v.view_count ?? 0}\n` +
        `  Likes: ${v.like_count ?? 0}\n` +
        `  Comments: ${v.comment_count ?? 0}\n` +
        `  Shares: ${v.share_count ?? 0}`
      ));

      return createToolResult(`TikTok Analytics:\n${videos.join('\n\n')}`);
    } catch (err) {
      return createErrorResult(`Analytics failed: ${(err as Error).message}`);
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.accessToken}`,
    };
  }
}

interface TikTokVideoListResponse {
  data?: {
    videos?: Array<{
      id?: string;
      title?: string;
      create_time?: number;
      like_count?: number;
      comment_count?: number;
      share_count?: number;
      view_count?: number;
    }>;
  };
}
