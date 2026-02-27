/**
 * AI-powered social media content generator.
 * Uses Claude to create platform-optimized marketing content.
 */
import { createLogger } from '@jarvis/shared';
import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';

const log = createLogger('tool:social:content-gen');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5-20251001'; // Fast + cheap for content gen
const LLM_TIMEOUT = 60_000; // 60s timeout for LLM API calls
const ERR_EMPTY_LLM = 'LLM returned empty content';

interface PlatformConstraints {
  readonly maxLength: number;
  readonly hashtagStyle: 'inline' | 'block' | 'none';
  readonly maxHashtags: number;
  readonly supportsEmoji: boolean;
  readonly tone: string;
  readonly notes: string;
}

const PLATFORM_CONSTRAINTS: Record<string, PlatformConstraints> = {
  twitter: {
    maxLength: 280,
    hashtagStyle: 'inline',
    maxHashtags: 3,
    supportsEmoji: true,
    tone: 'punchy, conversational, viral',
    notes: 'Must be under 280 chars. Threads supported for longer content.',
  },
  instagram: {
    maxLength: 2200,
    hashtagStyle: 'block',
    maxHashtags: 30,
    supportsEmoji: true,
    tone: 'visual, aspirational, engaging',
    notes: 'Hashtags go in a separate block at the end. First line is the hook. Use line breaks for readability.',
  },
  facebook: {
    maxLength: 63206,
    hashtagStyle: 'inline',
    maxHashtags: 5,
    supportsEmoji: true,
    tone: 'friendly, community-oriented, informative',
    notes: 'Can be longer but shorter posts perform better. Include a call-to-action.',
  },
  linkedin: {
    maxLength: 3000,
    hashtagStyle: 'block',
    maxHashtags: 5,
    supportsEmoji: false,
    tone: 'professional, insightful, value-driven',
    notes: 'Lead with a hook. Use short paragraphs. Professional tone. Hashtags at end.',
  },
  tiktok: {
    maxLength: 2200,
    hashtagStyle: 'inline',
    maxHashtags: 5,
    supportsEmoji: true,
    tone: 'trendy, casual, Gen-Z friendly, energetic',
    notes: 'This is the video caption/description. Keep it catchy. Use trending hashtags.',
  },
};

export interface ContentGeneratorConfig {
  readonly anthropicApiKey: string;
}

export class SocialContentGeneratorTool implements AgentTool {
  private apiKey: string;

  constructor(config: ContentGeneratorConfig) {
    this.apiKey = config.anthropicApiKey;
  }

  definition = {
    name: 'social_generate_content',
    description:
      'Generate AI-powered social media content optimized for specific platforms. ' +
      'Creates captions, threads, hashtags, and full post content with platform-specific formatting. ' +
      'Supports: twitter, instagram, facebook, linkedin, tiktok.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['generate', 'rewrite', 'hashtags', 'thread', 'campaign'],
          description:
            'generate: Create new post content. ' +
            'rewrite: Adapt existing text for a platform. ' +
            'hashtags: Generate relevant hashtags only. ' +
            'thread: Generate a multi-part thread (Twitter). ' +
            'campaign: Generate content for multiple platforms at once.',
        },
        platform: {
          type: 'string',
          enum: ['twitter', 'instagram', 'facebook', 'linkedin', 'tiktok'],
          description: 'Target platform (not needed for campaign action)',
        },
        topic: {
          type: 'string',
          description: 'What the post is about — product, announcement, promotion, etc.',
        },
        text: {
          type: 'string',
          description: 'Existing text to rewrite (for rewrite action)',
        },
        tone: {
          type: 'string',
          description: 'Optional tone override (e.g. "humorous", "urgent", "luxurious")',
        },
        language: {
          type: 'string',
          description: 'Content language (default: English). E.g. "Polish", "Spanish"',
        },
        include_cta: {
          type: 'boolean',
          description: 'Include a call-to-action (default: true)',
        },
        brand_voice: {
          type: 'string',
          description: 'Brand voice description for consistent messaging',
        },
        thread_count: {
          type: 'number',
          description: 'Number of posts in a thread (for thread action, default: 4)',
        },
      },
      required: ['action', 'topic'],
    },
  };

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as string;
    const topic = params['topic'] as string;
    const platform = params['platform'] as string | undefined;
    const text = params['text'] as string | undefined;
    const tone = params['tone'] as string | undefined;
    const language = (params['language'] as string) || 'English';
    const includeCta = params['include_cta'] !== false;
    const brandVoice = params['brand_voice'] as string | undefined;
    const threadCount = (params['thread_count'] as number) || 4;

    switch (action) {
      case 'generate':
        if (!platform) return createErrorResult('generate requires: platform');
        return this.generatePost(platform, topic, { tone, language, includeCta, brandVoice });

      case 'rewrite':
        if (!platform || !text) return createErrorResult('rewrite requires: platform, text');
        return this.rewriteForPlatform(platform, text, topic, { tone, language });

      case 'hashtags':
        return this.generateHashtags(platform || 'instagram', topic, language);

      case 'thread':
        return this.generateThread(topic, threadCount, { tone, language, brandVoice });

      case 'campaign':
        return this.generateCampaign(topic, { tone, language, includeCta, brandVoice });

      default:
        return createErrorResult(`Unknown action: ${action}`);
    }
  }

  private async generatePost(
    platform: string,
    topic: string,
    opts: { tone?: string; language?: string; includeCta?: boolean; brandVoice?: string },
  ): Promise<ToolResult> {
    const constraints = PLATFORM_CONSTRAINTS[platform];
    if (!constraints) return createErrorResult(`Unknown platform: ${platform}`);

    const prompt = [
      `Write a ${platform} post about: ${topic}`,
      '',
      `Platform constraints:`,
      `- Max length: ${constraints.maxLength} characters`,
      `- Tone: ${opts.tone || constraints.tone}`,
      `- Hashtag style: ${constraints.hashtagStyle} (max ${constraints.maxHashtags})`,
      `- Emoji: ${constraints.supportsEmoji ? 'yes, use naturally' : 'avoid'}`,
      `- ${constraints.notes}`,
      '',
      opts.brandVoice ? `Brand voice: ${opts.brandVoice}` : '',
      opts.includeCta ? 'Include a clear call-to-action.' : '',
      `Language: ${opts.language || 'English'}`,
      '',
      'Return ONLY the post content, ready to publish. No explanations or meta-text.',
    ].filter(Boolean).join('\n');

    const content = await this.callLLM(prompt);
    if (!content) return createErrorResult(ERR_EMPTY_LLM);

    log.info({ platform, topic: topic.slice(0, 50) }, 'Content generated');
    return createToolResult(
      `Generated ${platform} post:\n\n${content}`,
      { platform, content, charCount: content.length },
    );
  }

  private async rewriteForPlatform(
    platform: string,
    originalText: string,
    topic: string,
    opts: { tone?: string; language?: string },
  ): Promise<ToolResult> {
    const constraints = PLATFORM_CONSTRAINTS[platform];
    if (!constraints) return createErrorResult(`Unknown platform: ${platform}`);

    const prompt = [
      `Rewrite the following text for ${platform}:`,
      '',
      `Original text: "${originalText}"`,
      `Topic context: ${topic}`,
      '',
      `Platform constraints:`,
      `- Max length: ${constraints.maxLength} characters`,
      `- Tone: ${opts.tone || constraints.tone}`,
      `- Hashtag style: ${constraints.hashtagStyle} (max ${constraints.maxHashtags})`,
      `- ${constraints.notes}`,
      `Language: ${opts.language || 'English'}`,
      '',
      'Return ONLY the rewritten post content, ready to publish.',
    ].join('\n');

    const content = await this.callLLM(prompt);
    if (!content) return createErrorResult(ERR_EMPTY_LLM);

    return createToolResult(
      `Rewritten for ${platform}:\n\n${content}`,
      { platform, content, charCount: content.length },
    );
  }

  private async generateHashtags(
    platform: string,
    topic: string,
    language: string,
  ): Promise<ToolResult> {
    const constraints = PLATFORM_CONSTRAINTS[platform] || PLATFORM_CONSTRAINTS['instagram'];

    const prompt = [
      `Generate ${constraints.maxHashtags} highly relevant hashtags for a ${platform} post about: ${topic}`,
      '',
      'Mix of:',
      '- 2-3 high-volume general hashtags',
      '- 2-3 niche/specific hashtags',
      '- 1-2 trending/branded hashtags if applicable',
      '',
      `Language: ${language}`,
      '',
      'Return ONLY the hashtags, one per line, with # prefix. No explanations.',
    ].join('\n');

    const content = await this.callLLM(prompt);
    if (!content) return createErrorResult(ERR_EMPTY_LLM);

    const hashtags = content.split('\n').filter(h => h.trim().startsWith('#'));
    return createToolResult(
      `Hashtags for "${topic}":\n${hashtags.join('\n')}`,
      { hashtags, count: hashtags.length },
    );
  }

  private async generateThread(
    topic: string,
    count: number,
    opts: { tone?: string; language?: string; brandVoice?: string },
  ): Promise<ToolResult> {
    const prompt = [
      `Write a Twitter/X thread of ${count} tweets about: ${topic}`,
      '',
      'Rules:',
      '- Each tweet MUST be under 280 characters',
      '- First tweet is the hook — make it irresistible',
      '- Last tweet is the CTA / summary',
      '- Number each tweet: 1/, 2/, etc.',
      `- Tone: ${opts.tone || 'insightful, engaging'}`,
      opts.brandVoice ? `- Brand voice: ${opts.brandVoice}` : '',
      `- Language: ${opts.language || 'English'}`,
      '',
      'Return ONLY the thread tweets, numbered. No meta-text.',
    ].filter(Boolean).join('\n');

    const content = await this.callLLM(prompt);
    if (!content) return createErrorResult(ERR_EMPTY_LLM);

    // Parse individual tweets
    const tweets = content.split(/\n(?=\d+\/)/).filter(t => t.trim());

    return createToolResult(
      `Twitter thread (${tweets.length} tweets):\n\n${content}`,
      { tweets, count: tweets.length },
    );
  }

  private async generateCampaign(
    topic: string,
    opts: { tone?: string; language?: string; includeCta?: boolean; brandVoice?: string },
  ): Promise<ToolResult> {
    const platforms = Object.keys(PLATFORM_CONSTRAINTS);

    const platformSpecs = platforms.map(p => {
      const c = PLATFORM_CONSTRAINTS[p];
      return `## ${p.toUpperCase()}\n- Max: ${c.maxLength} chars\n- Tone: ${c.tone}\n- Hashtags: ${c.hashtagStyle}, max ${c.maxHashtags}\n- ${c.notes}`;
    }).join('\n\n');

    const prompt = [
      `Create a social media campaign across all platforms about: ${topic}`,
      '',
      `Generate one optimized post for each platform:`,
      '',
      platformSpecs,
      '',
      opts.brandVoice ? `Brand voice: ${opts.brandVoice}` : '',
      opts.includeCta ? 'Each post should include a call-to-action.' : '',
      `Language: ${opts.language || 'English'}`,
      `Tone override: ${opts.tone || 'use platform defaults'}`,
      '',
      'Format each post as:',
      '### PLATFORM_NAME',
      '[post content]',
      '',
      'Return ONLY the posts. No explanations.',
    ].filter(Boolean).join('\n');

    const content = await this.callLLM(prompt, 4096);
    if (!content) return createErrorResult(ERR_EMPTY_LLM);

    // Parse per-platform content
    const campaign: Record<string, string> = {};
    const sections = content.split(/###\s*/);
    for (const section of sections) {
      if (!section.trim()) continue;
      const lines = section.trim().split('\n');
      const platformName = lines[0].trim().toLowerCase();
      const postContent = lines.slice(1).join('\n').trim();
      if (platformName && postContent) {
        campaign[platformName] = postContent;
      }
    }

    return createToolResult(
      `Campaign for "${topic}" (${Object.keys(campaign).length} platforms):\n\n${content}`,
      { campaign, platforms: Object.keys(campaign) },
    );
  }

  private async callLLM(prompt: string, maxTokens = 1024): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT);

      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          system: 'You are an expert social media marketer and copywriter. You write viral, engaging content optimized for each platform. You return ONLY the content — no explanations, no formatting labels, no meta-commentary.',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const err = await response.text();
        log.error({ status: response.status, error: err }, 'Anthropic API call failed');
        return null;
      }

      const data = await response.json() as {
        content?: Array<{ type: string; text?: string }>;
      };

      const text = data.content?.find(b => b.type === 'text')?.text;
      return text?.trim() ?? null;
    } catch (err) {
      log.error({ error: (err as Error).message }, 'LLM call failed');
      return null;
    }
  }
}
