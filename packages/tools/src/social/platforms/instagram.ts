import { createLogger } from '@jarvis/shared';
import type { ToolResult } from '../../base.js';
import { createToolResult, createErrorResult } from '../../base.js';

const log = createLogger('tool:social:instagram');

const GRAPH_API_URL = 'https://graph.facebook.com/v21.0';

export interface InstagramConfig {
  accessToken: string;
  businessAccountId: string;
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
      const containerUrl = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/media`);
      containerUrl.searchParams.set('image_url', imageUrl);
      containerUrl.searchParams.set('caption', caption);
      containerUrl.searchParams.set('access_token', this.config.accessToken);

      const containerRes = await fetch(containerUrl.toString(), { method: 'POST' });
      if (!containerRes.ok) {
        const err = await containerRes.text();
        return createErrorResult(`Container creation failed: ${err}`);
      }

      const container = await containerRes.json() as { id?: string };
      if (!container.id) return createErrorResult('No container ID returned');

      // Step 2: Publish
      const publishUrl = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/media_publish`);
      publishUrl.searchParams.set('creation_id', container.id);
      publishUrl.searchParams.set('access_token', this.config.accessToken);

      const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });
      if (!publishRes.ok) {
        const err = await publishRes.text();
        return createErrorResult(`Publish failed: ${err}`);
      }

      const result = await publishRes.json() as { id?: string };
      return createToolResult(
        `Photo published to Instagram.\nMedia ID: ${result.id}`,
        { mediaId: result.id },
      );
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
        const url = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/media`);
        url.searchParams.set('image_url', item.imageUrl);
        url.searchParams.set('is_carousel_item', 'true');
        url.searchParams.set('access_token', this.config.accessToken);

        const res = await fetch(url.toString(), { method: 'POST' });
        if (!res.ok) {
          const err = await res.text();
          return createErrorResult(`Carousel item failed: ${err}`);
        }
        const data = await res.json() as { id?: string };
        if (data.id) childIds.push(data.id);
      }

      // Create carousel container
      const containerUrl = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/media`);
      containerUrl.searchParams.set('media_type', 'CAROUSEL');
      containerUrl.searchParams.set('children', childIds.join(','));
      containerUrl.searchParams.set('caption', caption);
      containerUrl.searchParams.set('access_token', this.config.accessToken);

      const containerRes = await fetch(containerUrl.toString(), { method: 'POST' });
      if (!containerRes.ok) {
        const err = await containerRes.text();
        return createErrorResult(`Carousel container failed: ${err}`);
      }

      const container = await containerRes.json() as { id?: string };

      // Publish
      const publishUrl = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/media_publish`);
      publishUrl.searchParams.set('creation_id', container.id!);
      publishUrl.searchParams.set('access_token', this.config.accessToken);

      const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });
      const result = await publishRes.json() as { id?: string };

      return createToolResult(
        `Carousel published (${items.length} images).\nMedia ID: ${result.id}`,
        { mediaId: result.id },
      );
    } catch (err) {
      return createErrorResult(`Carousel publish failed: ${(err as Error).message}`);
    }
  }

  /** Publish a reel (video) */
  async publishReel(videoUrl: string, caption: string, coverUrl?: string): Promise<ToolResult> {
    try {
      const containerUrl = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/media`);
      containerUrl.searchParams.set('media_type', 'REELS');
      containerUrl.searchParams.set('video_url', videoUrl);
      containerUrl.searchParams.set('caption', caption);
      if (coverUrl) containerUrl.searchParams.set('cover_url', coverUrl);
      containerUrl.searchParams.set('access_token', this.config.accessToken);

      const containerRes = await fetch(containerUrl.toString(), { method: 'POST' });
      if (!containerRes.ok) {
        const err = await containerRes.text();
        return createErrorResult(`Reel container failed: ${err}`);
      }

      const container = await containerRes.json() as { id?: string };

      // Wait for processing (reels can take time)
      await this.waitForMedia(container.id!);

      // Publish
      const publishUrl = new URL(`${GRAPH_API_URL}/${this.config.businessAccountId}/media_publish`);
      publishUrl.searchParams.set('creation_id', container.id!);
      publishUrl.searchParams.set('access_token', this.config.accessToken);

      const publishRes = await fetch(publishUrl.toString(), { method: 'POST' });
      const result = await publishRes.json() as { id?: string };

      return createToolResult(
        `Reel published.\nMedia ID: ${result.id}`,
        { mediaId: result.id },
      );
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

  /** Wait for media container to finish processing */
  private async waitForMedia(containerId: string, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const url = new URL(`${GRAPH_API_URL}/${containerId}`);
      url.searchParams.set('fields', 'status_code');
      url.searchParams.set('access_token', this.config.accessToken);

      const res = await fetch(url.toString());
      const data = await res.json() as { status_code?: string };

      if (data.status_code === 'FINISHED') return;
      if (data.status_code === 'ERROR') throw new Error('Media processing failed');

      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error('Media processing timeout');
  }
}

interface InsightsResponse {
  data?: Array<{
    name: string;
    title?: string;
    values?: Array<{ value?: number }>;
  }>;
}
