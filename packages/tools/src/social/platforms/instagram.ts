import { createLogger } from '@jarvis/shared';
import type { ToolResult } from '../../base.js';
import { createToolResult, createErrorResult } from '../../base.js';
import { GRAPH_API_URL } from './constants.js';

const log = createLogger('tool:social:instagram');

export interface InstagramConfig {
  readonly accessToken: string;
  readonly businessAccountId: string;
}

/**
 * Instagram Graph API client.
 * Handles publishing posts/reels, getting insights, and managing comments.
 */
export class InstagramClient {
  constructor(private config: InstagramConfig) {}

  /** Publish a photo post */
  async publishPhoto(imageUrl: string, caption: string): Promise<ToolResult> {
    try {
      // Step 1: Create media container
      const container = await this.createMediaContainer({
        image_url: imageUrl,
        caption,
      });
      if (!container.id) return createErrorResult('No container ID returned');

      // Step 2: Wait for processing (photos are usually instant but can take a moment)
      await this.waitForMedia(container.id, 30_000);

      // Step 3: Publish
      return await this.publishContainer(container.id);
    } catch (err) {
      return createErrorResult(`Instagram publish failed: ${(err as Error).message}`);
    }
  }

  /** Publish a carousel (multiple images) */
  async publishCarousel(items: Array<{ imageUrl: string }>, caption: string): Promise<ToolResult> {
    try {
      // Create containers for each image
      const childIds: string[] = [];
      for (const item of items) {
        const child = await this.createMediaContainer({
          image_url: item.imageUrl,
          is_carousel_item: 'true',
        });
        if (child.id) childIds.push(child.id);
      }

      if (childIds.length === 0) {
        return createErrorResult('No carousel items were created successfully');
      }

      // Create carousel container
      const container = await this.createMediaContainer({
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption,
      });
      if (!container.id) return createErrorResult('No carousel container ID returned');

      // Wait for processing
      await this.waitForMedia(container.id, 60_000);

      // Publish
      return await this.publishContainer(container.id, `Carousel published (${items.length} images)`);
    } catch (err) {
      return createErrorResult(`Carousel publish failed: ${(err as Error).message}`);
    }
  }

  /** Publish a reel (video) */
  async publishReel(videoUrl: string, caption: string, coverUrl?: string): Promise<ToolResult> {
    try {
      const params: Record<string, string> = {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
      };
      if (coverUrl) params['cover_url'] = coverUrl;

      const container = await this.createMediaContainer(params);
      if (!container.id) return createErrorResult('No reel container ID returned');

      // Reels need more time for video processing
      await this.waitForMedia(container.id, 90_000);

      return await this.publishContainer(container.id, 'Reel published');
    } catch (err) {
      return createErrorResult(`Reel publish failed: ${(err as Error).message}`);
    }
  }

  /** Get account insights */
  async getInsights(period: 'day' | 'week' | 'month' = 'day'): Promise<ToolResult> {
    try {
      const metrics = [
        'impressions', 'reach', 'profile_views',
        'accounts_engaged', 'total_interactions',
      ].join(',');

      const url = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/insights`);
      url.searchParams.set('metric', metrics);
      url.searchParams.set('period', period);
      url.searchParams.set('access_token', this.config.accessToken);

      const response = await fetch(url.toString());
      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Insights failed: ${err}`);
      }

      const data = await response.json() as InsightsResponse;
      const insights = (data.data ?? []).map((m) => {
        const val = m.values?.[0]?.value ?? 0;
        return `  ${m.title ?? m.name}: ${val}`;
      });

      return createToolResult(`Instagram Insights (${period}):\n${insights.join('\n')}`);
    } catch (err) {
      return createErrorResult(`Insights failed: ${(err as Error).message}`);
    }
  }

  /** Get media insights for a specific post */
  async getMediaInsights(mediaId: string): Promise<ToolResult> {
    try {
      const url = new URL(`${GRAPH_API_URL}/${mediaId}/insights`);
      url.searchParams.set('metric', 'impressions,reach,likes,comments,shares,saved');
      url.searchParams.set('access_token', this.config.accessToken);

      const response = await fetch(url.toString());
      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Media insights failed: ${err}`);
      }

      const data = await response.json() as InsightsResponse;
      const insights = (data.data ?? []).map((m) => {
        const val = m.values?.[0]?.value ?? 0;
        return `  ${m.title ?? m.name}: ${val}`;
      });

      return createToolResult(`Media ${mediaId} Insights:\n${insights.join('\n')}`);
    } catch (err) {
      return createErrorResult(`Media insights failed: ${(err as Error).message}`);
    }
  }

  /** Create a media container with given params */
  private async createMediaContainer(params: Record<string, string>): Promise<{ id?: string }> {
    const url = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/media`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('access_token', this.config.accessToken);

    const res = await fetch(url.toString(), { method: 'POST' });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Container creation failed: ${err}`);
    }
    return await res.json() as { id?: string };
  }

  /** Publish a media container by its creation_id */
  private async publishContainer(creationId: string, successPrefix = 'Published'): Promise<ToolResult> {
    const url = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/media_publish`);
    url.searchParams.set('creation_id', creationId);
    url.searchParams.set('access_token', this.config.accessToken);

    const res = await fetch(url.toString(), { method: 'POST' });
    if (!res.ok) {
      const err = await res.text();
      return createErrorResult(`Publish failed: ${err}`);
    }

    const result = await res.json() as { id?: string };
    log.info({ mediaId: result.id }, successPrefix);
    return createToolResult(
      `${successPrefix}.\nMedia ID: ${result.id}`,
      { mediaId: result.id },
    );
  }

  /**
   * Wait for media container to finish processing.
   * Uses exponential backoff: 2s, 4s, 8s, 10s, 10s... (capped at 10s)
   * Default timeout: 60s total (not 2.5 min like before)
   */
  private async waitForMedia(containerId: string, timeoutMs = 60_000): Promise<void> {
    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
      const url = new URL(`${GRAPH_API_URL}/${containerId}`);
      url.searchParams.set('fields', 'status_code,status');
      url.searchParams.set('access_token', this.config.accessToken);

      const res = await fetch(url.toString());
      if (!res.ok) {
        log.warn({ containerId, status: res.status }, 'Media status check failed, retrying');
      } else {
        const data = await res.json() as { status_code?: string; status?: string };
        log.debug({ containerId, status_code: data.status_code, attempt }, 'Media processing status');

        if (data.status_code === 'FINISHED') return;
        if (data.status_code === 'ERROR') {
          throw new Error(`Media processing failed: ${data.status ?? 'unknown error'}`);
        }
        if (data.status_code === 'EXPIRED') {
          throw new Error('Media container expired — re-upload required');
        }
      }

      // Exponential backoff: 2s, 4s, 8s, then cap at 10s
      const delay = Math.min(2000 * Math.pow(2, attempt), 10_000);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }

    throw new Error(`Media processing timeout after ${Math.round(timeoutMs / 1000)}s`);
  }
}

interface InsightsResponse {
  data?: Array<{
    name: string;
    title?: string;
    values?: Array<{ value?: number }>;
  }>;
}
