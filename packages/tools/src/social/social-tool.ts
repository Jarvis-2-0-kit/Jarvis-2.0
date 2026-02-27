import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';
import { TwitterClient, type TwitterConfig } from './platforms/twitter.js';
import { InstagramClient, type InstagramConfig } from './platforms/instagram.js';
import { FacebookClient, type FacebookConfig } from './platforms/meta.js';
import { LinkedInClient, type LinkedInConfig } from './platforms/linkedin.js';
import { TikTokClient, type TikTokConfig } from './platforms/tiktok.js';

export interface SocialToolConfig {
  readonly twitter?: TwitterConfig;
  readonly instagram?: InstagramConfig;
  readonly facebook?: FacebookConfig;
  readonly linkedin?: LinkedInConfig;
  readonly tiktok?: TikTokConfig;
}

/**
 * Unified social media tool for the agent.
 * Routes actions to the appropriate platform client.
 */
export class SocialTool implements AgentTool {
  private twitter?: TwitterClient;
  private instagram?: InstagramClient;
  private facebook?: FacebookClient;
  private linkedin?: LinkedInClient;
  private tiktok?: TikTokClient;

  constructor(config: SocialToolConfig) {
    if (config.twitter) this.twitter = new TwitterClient(config.twitter);
    if (config.instagram) this.instagram = new InstagramClient(config.instagram);
    if (config.facebook) this.facebook = new FacebookClient(config.facebook);
    if (config.linkedin) this.linkedin = new LinkedInClient(config.linkedin);
    if (config.tiktok) this.tiktok = new TikTokClient(config.tiktok);
  }

  definition = {
    name: 'social_post',
    description: 'Publish content to social media platforms (Twitter/X, Instagram, Facebook, LinkedIn, TikTok). Supports text posts, photos, videos, threads, carousels, and reels.',
    input_schema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['twitter', 'instagram', 'facebook', 'linkedin', 'tiktok', 'all'],
          description: 'Target platform (or "all" to post everywhere)',
        },
        action: {
          type: 'string',
          enum: ['post', 'photo', 'video', 'thread', 'carousel', 'reel'],
          description: 'Type of content to publish',
        },
        text: { type: 'string', description: 'Post text/caption' },
        media_url: { type: 'string', description: 'URL of image or video to attach' },
        media_urls: { type: 'array', items: { type: 'string' }, description: 'Multiple image URLs (for carousel)' },
        thread: { type: 'array', items: { type: 'string' }, description: 'Array of tweet texts (for thread)' },
        link: { type: 'string', description: 'Link to attach (for Facebook/LinkedIn)' },
        title: { type: 'string', description: 'Title (for LinkedIn articles, TikTok videos)' },
      },
      required: ['platform', 'action', 'text'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const platform = params['platform'] as string;
    const action = params['action'] as string;
    const text = params['text'] as string;

    if (!text) return createErrorResult('Missing required parameter: text');

    if (platform === 'all') {
      return this.postToAll(action, params);
    }

    switch (platform) {
      case 'twitter': return this.handleTwitter(action, params);
      case 'instagram': return this.handleInstagram(action, params);
      case 'facebook': return this.handleFacebook(action, params);
      case 'linkedin': return this.handleLinkedIn(action, params);
      case 'tiktok': return this.handleTikTok(action, params);
      default: return createErrorResult(`Unknown platform: ${platform}`);
    }
  }

  private async postToAll(action: string, params: Record<string, unknown>): Promise<ToolResult> {
    const platforms = [
      { name: 'Twitter', handler: () => this.handleTwitter(action, params) },
      { name: 'Facebook', handler: () => this.handleFacebook(action, params) },
      { name: 'LinkedIn', handler: () => this.handleLinkedIn(action, params) },
      { name: 'Instagram', handler: () => this.handleInstagram(action, params) },
    ];

    const settled = await Promise.allSettled(platforms.map((p) => p.handler()));

    const results = settled.map((outcome, i) => {
      const name = platforms[i]!.name;
      if (outcome.status === 'fulfilled') {
        const result = outcome.value;
        return `${name}: ${result.type === 'error' ? 'FAILED' : 'OK'} - ${result.content.slice(0, 80)}`;
      }
      return `${name}: FAILED - ${outcome.reason?.message ?? 'Unknown error'}`;
    });

    return createToolResult(`Cross-platform post results:\n${results.join('\n')}`);
  }

  private async handleTwitter(action: string, params: Record<string, unknown>): Promise<ToolResult> {
    if (!this.twitter) return createErrorResult('Twitter not configured');
    const text = params['text'] as string;

    switch (action) {
      case 'post': return this.twitter.postTweet(text);
      case 'thread': {
        const thread = params['thread'] as string[] ?? [text];
        return this.twitter.postThread(thread);
      }
      default: return this.twitter.postTweet(text);
    }
  }

  private async handleInstagram(action: string, params: Record<string, unknown>): Promise<ToolResult> {
    if (!this.instagram) return createErrorResult('Instagram not configured');
    const text = params['text'] as string;
    const mediaUrl = params['media_url'] as string;

    switch (action) {
      case 'photo':
      case 'post':
        if (!mediaUrl) return createErrorResult('Instagram requires media_url for posts');
        return this.instagram.publishPhoto(mediaUrl, text);
      case 'carousel': {
        const urls = params['media_urls'] as string[] ?? [];
        if (urls.length === 0) return createErrorResult('Carousel requires media_urls array');
        return this.instagram.publishCarousel(urls.map((u) => ({ imageUrl: u })), text);
      }
      case 'reel':
      case 'video':
        if (!mediaUrl) return createErrorResult('Reel requires media_url');
        return this.instagram.publishReel(mediaUrl, text);
      default:
        if (mediaUrl) return this.instagram.publishPhoto(mediaUrl, text);
        return createErrorResult('Instagram requires media for posts');
    }
  }

  private async handleFacebook(action: string, params: Record<string, unknown>): Promise<ToolResult> {
    if (!this.facebook) return createErrorResult('Facebook not configured');
    const text = params['text'] as string;
    const mediaUrl = params['media_url'] as string;
    const link = params['link'] as string;

    switch (action) {
      case 'photo':
        if (!mediaUrl) return createErrorResult('Photo requires media_url');
        return this.facebook.publishPhoto(mediaUrl, text);
      default:
        return this.facebook.publishPost(text, link);
    }
  }

  private async handleLinkedIn(action: string, params: Record<string, unknown>): Promise<ToolResult> {
    if (!this.linkedin) return createErrorResult('LinkedIn not configured');
    const text = params['text'] as string;
    const link = params['link'] as string;
    const title = params['title'] as string;

    return this.linkedin.publishPost(text, {
      articleUrl: link,
      articleTitle: title,
    });
  }

  private async handleTikTok(action: string, params: Record<string, unknown>): Promise<ToolResult> {
    if (!this.tiktok) return createErrorResult('TikTok not configured');
    const mediaUrl = params['media_url'] as string;
    const title = params['title'] as string ?? params['text'] as string;

    if (!mediaUrl) return createErrorResult('TikTok requires media_url (video)');
    return this.tiktok.publishVideo(mediaUrl, { title });
  }
}

/**
 * Social analytics tool - reads metrics from all platforms.
 */
export class SocialAnalyticsTool implements AgentTool {
  private twitter?: TwitterClient;
  private instagram?: InstagramClient;
  private facebook?: FacebookClient;
  private linkedin?: LinkedInClient;
  private tiktok?: TikTokClient;

  constructor(config: SocialToolConfig) {
    if (config.twitter) this.twitter = new TwitterClient(config.twitter);
    if (config.instagram) this.instagram = new InstagramClient(config.instagram);
    if (config.facebook) this.facebook = new FacebookClient(config.facebook);
    if (config.linkedin) this.linkedin = new LinkedInClient(config.linkedin);
    if (config.tiktok) this.tiktok = new TikTokClient(config.tiktok);
  }

  definition = {
    name: 'social_analytics',
    description: 'Get analytics and metrics from social media platforms. Retrieve engagement data, follower stats, post performance, and account insights.',
    input_schema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['twitter', 'instagram', 'facebook', 'linkedin', 'tiktok', 'all'],
          description: 'Platform to get analytics from',
        },
        type: {
          type: 'string',
          enum: ['account', 'post', 'search'],
          description: 'Type of analytics',
        },
        post_id: { type: 'string', description: 'Specific post/tweet ID for post analytics' },
        query: { type: 'string', description: 'Search query (for Twitter search)' },
        period: { type: 'string', enum: ['day', 'week', 'month'], description: 'Time period for insights' },
      },
      required: ['platform', 'type'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const platform = params['platform'] as string;
    const type = params['type'] as string;
    const postId = params['post_id'] as string;
    const query = params['query'] as string;
    const period = (params['period'] as 'day' | 'week' | 'month') ?? 'day';

    if (platform === 'all' && type === 'account') {
      return this.getAllAccountAnalytics(period);
    }

    switch (platform) {
      case 'twitter': {
        if (!this.twitter) return createErrorResult('Twitter not configured');
        if (type === 'post' && postId) return this.twitter.getAnalytics(postId);
        if (type === 'search' && query) return this.twitter.searchTweets(query);
        return createErrorResult('Twitter analytics requires post_id or search query');
      }
      case 'instagram': {
        if (!this.instagram) return createErrorResult('Instagram not configured');
        if (type === 'account') return this.instagram.getInsights(period);
        if (type === 'post' && postId) return this.instagram.getMediaInsights(postId);
        return createErrorResult('Specify type: account or post');
      }
      case 'facebook': {
        if (!this.facebook) return createErrorResult('Facebook not configured');
        if (type === 'account') return this.facebook.getPageInsights(period === 'month' ? 'days_28' : period);
        return createErrorResult('Facebook analytics: use type=account');
      }
      case 'linkedin': {
        if (!this.linkedin) return createErrorResult('LinkedIn not configured');
        if (type === 'account') return this.linkedin.getFollowerStats();
        return createErrorResult('LinkedIn analytics: use type=account');
      }
      case 'tiktok': {
        if (!this.tiktok) return createErrorResult('TikTok not configured');
        if (type === 'account') return this.tiktok.getVideos();
        return createErrorResult('TikTok analytics: use type=account');
      }
      default:
        return createErrorResult(`Unknown platform: ${platform}`);
    }
  }

  private async getAllAccountAnalytics(period: 'day' | 'week' | 'month'): Promise<ToolResult> {
    const sections: string[] = [];

    if (this.instagram) {
      const r = await this.instagram.getInsights(period);
      sections.push(`=== INSTAGRAM ===\n${r.content}`);
    }
    if (this.facebook) {
      const r = await this.facebook.getPageInsights(period === 'month' ? 'days_28' : period);
      sections.push(`=== FACEBOOK ===\n${r.content}`);
    }
    if (this.linkedin) {
      const r = await this.linkedin.getFollowerStats();
      sections.push(`=== LINKEDIN ===\n${r.content}`);
    }
    if (this.tiktok) {
      const r = await this.tiktok.getVideos(5);
      sections.push(`=== TIKTOK ===\n${r.content}`);
    }

    if (sections.length === 0) return createErrorResult('No social platforms configured');
    return createToolResult(`Social Media Analytics (${period}):\n\n${sections.join('\n\n')}`);
  }
}
