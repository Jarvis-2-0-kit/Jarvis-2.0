import { createHmac, randomBytes } from 'node:crypto';
import type { ToolResult } from '../../base.js';
import { createToolResult, createErrorResult } from '../../base.js';

const TWITTER_API_V2 = 'https://api.twitter.com/2';

export interface TwitterConfig {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly accessToken: string;
  readonly accessTokenSecret: string;
  readonly bearerToken: string;
}

/**
 * Twitter/X API v2 client.
 * Handles posting tweets, threads, reading timelines, and analytics.
 */
export class TwitterClient {
  constructor(private config: TwitterConfig) {}

  async postTweet(text: string, options?: {
    replyTo?: string;
    mediaIds?: string[];
    pollOptions?: string[];
    pollDuration?: number;
  }): Promise<ToolResult> {
    const body: Record<string, unknown> = { text };

    if (options?.replyTo) {
      body['reply'] = { in_reply_to_tweet_id: options.replyTo };
    }
    if (options?.mediaIds?.length) {
      body['media'] = { media_ids: options.mediaIds };
    }
    if (options?.pollOptions?.length) {
      body['poll'] = {
        options: options.pollOptions.map((o) => ({ label: o })),
        duration_minutes: options.pollDuration ?? 1440,
      };
    }

    try {
      const tweetUrl = `${TWITTER_API_V2}/tweets`;
      const response = await fetch(tweetUrl, {
        method: 'POST',
        headers: this.getHeaders('POST', tweetUrl),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Twitter API error ${response.status}: ${err}`);
      }

      const data = await response.json() as { data?: { id?: string; text?: string } };
      return createToolResult(
        `Tweet posted successfully.\nID: ${data.data?.id}\nURL: https://twitter.com/i/status/${data.data?.id}`,
        { tweetId: data.data?.id },
      );
    } catch (err) {
      return createErrorResult(`Failed to post tweet: ${(err as Error).message}`);
    }
  }

  async postThread(tweets: string[]): Promise<ToolResult> {
    const results: string[] = [];
    let lastTweetId: string | undefined;

    for (let i = 0; i < tweets.length; i++) {
      const result = await this.postTweet(tweets[i]!, { replyTo: lastTweetId });
      if (result.type === 'error') {
        return createErrorResult(`Thread failed at tweet ${i + 1}: ${result.content}`);
      }
      lastTweetId = result.metadata?.['tweetId'] as string;
      results.push(`${i + 1}. ${lastTweetId}`);
    }

    return createToolResult(`Thread posted (${tweets.length} tweets):\n${results.join('\n')}`);
  }

  async deleteTweet(tweetId: string): Promise<ToolResult> {
    try {
      const deleteUrl = `${TWITTER_API_V2}/tweets/${tweetId}`;
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: this.getHeaders('DELETE', deleteUrl),
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Failed to delete tweet: ${err}`);
      }

      return createToolResult(`Tweet ${tweetId} deleted`);
    } catch (err) {
      return createErrorResult(`Delete failed: ${(err as Error).message}`);
    }
  }

  async getUserTimeline(userId: string, maxResults = 10): Promise<ToolResult> {
    try {
      const url = new URL(`${TWITTER_API_V2}/users/${userId}/tweets`);
      url.searchParams.set('max_results', String(maxResults));
      url.searchParams.set('tweet.fields', 'created_at,public_metrics,text');

      const response = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${this.config.bearerToken}` },
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Timeline fetch failed: ${err}`);
      }

      const data = await response.json() as TwitterTimelineResponse;
      const tweets = (data.data ?? []).map((t, i) =>
        `${i + 1}. [${t.created_at}] ${t.text?.slice(0, 100)}... | Likes: ${t.public_metrics?.like_count ?? 0} | RT: ${t.public_metrics?.retweet_count ?? 0}`,
      );

      return createToolResult(`Timeline (${tweets.length} tweets):\n${tweets.join('\n')}`);
    } catch (err) {
      return createErrorResult(`Timeline failed: ${(err as Error).message}`);
    }
  }

  async searchTweets(query: string, maxResults = 10): Promise<ToolResult> {
    try {
      const url = new URL(`${TWITTER_API_V2}/tweets/search/recent`);
      url.searchParams.set('query', query);
      url.searchParams.set('max_results', String(Math.min(maxResults, 100)));
      url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id,text');

      const response = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${this.config.bearerToken}` },
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Search failed: ${err}`);
      }

      const data = await response.json() as TwitterTimelineResponse;
      const tweets = (data.data ?? []).map((t, i) =>
        `${i + 1}. @${t.author_id}: ${t.text?.slice(0, 120)}... | Likes: ${t.public_metrics?.like_count ?? 0}`,
      );

      return createToolResult(`Search "${query}" (${tweets.length} results):\n${tweets.join('\n')}`);
    } catch (err) {
      return createErrorResult(`Search failed: ${(err as Error).message}`);
    }
  }

  async getAnalytics(tweetId: string): Promise<ToolResult> {
    try {
      const url = new URL(`${TWITTER_API_V2}/tweets/${tweetId}`);
      url.searchParams.set('tweet.fields', 'public_metrics,organic_metrics,created_at');

      const response = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${this.config.bearerToken}` },
      });

      if (!response.ok) {
        const err = await response.text();
        return createErrorResult(`Analytics failed: ${err}`);
      }

      const data = await response.json() as { data?: TwitterTweet };
      const m = data.data?.public_metrics;
      return createToolResult(
        `Tweet ${tweetId} Analytics:\n` +
        `  Likes: ${m?.like_count ?? 0}\n` +
        `  Retweets: ${m?.retweet_count ?? 0}\n` +
        `  Replies: ${m?.reply_count ?? 0}\n` +
        `  Impressions: ${m?.impression_count ?? 0}\n` +
        `  Quotes: ${m?.quote_count ?? 0}\n` +
        `  Bookmarks: ${m?.bookmark_count ?? 0}`,
      );
    } catch (err) {
      return createErrorResult(`Analytics failed: ${(err as Error).message}`);
    }
  }

  private getHeaders(method?: string, url?: string): Record<string, string> {
    // Use OAuth 1.0a for write requests (POST/DELETE), Bearer for read (GET)
    if (method && method.toUpperCase() !== 'GET') {
      return {
        'Content-Type': 'application/json',
        'Authorization': this.generateOAuthHeader(method, url ?? ''),
      };
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.bearerToken}`,
    };
  }

  private generateOAuthHeader(method: string, url: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');

    const params: Record<string, string> = {
      oauth_consumer_key: this.config.apiKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: this.config.accessToken,
      oauth_version: '1.0',
    };

    // Build parameter string (sorted)
    const paramString = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
    const signingKey = `${encodeURIComponent(this.config.apiSecret)}&${encodeURIComponent(this.config.accessTokenSecret)}`;
    const signature = createHmac('sha1', signingKey).update(baseString).digest('base64');

    params['oauth_signature'] = signature;

    return 'OAuth ' + Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
      .join(', ');
  }
}

interface TwitterTweet {
  id?: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    impression_count?: number;
    quote_count?: number;
    bookmark_count?: number;
  };
}

interface TwitterTimelineResponse {
  data?: TwitterTweet[];
  meta?: { result_count?: number; next_token?: string };
}
