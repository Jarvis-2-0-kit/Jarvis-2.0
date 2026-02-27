/**
 * DALL-E image generation tool using OpenAI's gpt-image-1 model.
 */

import { createLogger } from '@jarvis/shared';
import type { AgentTool, ToolContext, ToolResult } from './base.js';
import { createToolResult, createErrorResult } from './base.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const log = createLogger('tools:image-gen');

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const BLOCKED_SAVE_SEGMENTS = ['/.ssh/', '/.gnupg/', '/.config/gh/', '/.aws/', '/.env', '/etc/'];

export class ImageGenTool implements AgentTool {
  private apiKey: string;

  constructor(openaiApiKey: string) {
    this.apiKey = openaiApiKey;
  }

  definition = {
    name: 'image_generate',
    description:
      'Generate an image from a text prompt using DALL-E (gpt-image-1). ' +
      'Returns base64-encoded PNG or saves to disk if save_path is provided. ' +
      'Supports high-quality image generation with text rendering capabilities.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the image to generate. Be detailed and specific for best results.',
        },
        size: {
          type: 'string',
          enum: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
          description: 'Image dimensions. 1024x1024 (square), 1536x1024 (landscape), 1024x1536 (portrait), auto (default). Default: auto.',
        },
        quality: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'auto'],
          description: 'Image quality. "high" for maximum detail, "auto" for balanced. Default: auto.',
        },
        save_path: {
          type: 'string',
          description: 'Optional absolute file path to save the generated PNG image. If omitted, returns base64 content.',
        },
      },
      required: ['prompt'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const prompt = params['prompt'] as string;
    if (!prompt) return createErrorResult('Missing required parameter: prompt');

    const size = (params['size'] as string) ?? '1024x1024';
    const quality = (params['quality'] as string) ?? 'auto';
    let savePath = params['save_path'] as string | undefined;

    // Resolve NAS path aliases — agents may reference /Volumes/JarvisNAS but actual mount differs
    if (savePath && context.nasPath) {
      const nasAliases = ['/Volumes/JarvisNAS/jarvis', '/Volumes/JarvisNAS'];
      for (const alias of nasAliases) {
        if (savePath.startsWith(alias)) {
          savePath = savePath.replace(alias, context.nasPath);
          log.info(`Resolved NAS path: ${alias} → ${context.nasPath}`);
          break;
        }
      }
    }

    log.info(`Generating image: "${prompt.slice(0, 80)}..." (${size}, quality: ${quality})`);

    try {
      const response = await fetch(OPENAI_IMAGES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt,
          n: 1,
          size,
          quality,
          output_format: 'png',
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        log.error(`OpenAI API error ${response.status}: ${errorBody}`);
        return createErrorResult(`OpenAI API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as { data: Array<{ b64_json: string }> };
      const b64 = data.data[0]?.b64_json;
      if (!b64) {
        return createErrorResult('No image data returned from OpenAI API');
      }

      if (savePath) {
        // Validate save_path to prevent path traversal
        const resolvedSavePath = resolve(savePath);
        for (const seg of BLOCKED_SAVE_SEGMENTS) {
          if (resolvedSavePath.includes(seg)) {
            return createErrorResult(`Save path denied: contains blocked segment '${seg}'`);
          }
        }
        savePath = resolvedSavePath;

        // Ensure directory exists and write PNG
        await mkdir(dirname(savePath), { recursive: true });
        const buffer = Buffer.from(b64, 'base64');
        await writeFile(savePath, buffer);
        log.info(`Image saved to ${savePath} (${buffer.length} bytes)`);
        return createToolResult(`Image saved to ${savePath} (${buffer.length} bytes)`, {
          path: savePath,
          size,
          quality,
          bytes: buffer.length,
        });
      }

      // Return as base64 image
      log.info(`Image generated (base64, ${b64.length} chars)`);
      return {
        type: 'image',
        content: b64,
        metadata: { size, quality, format: 'png' },
      };
    } catch (err) {
      const message = (err as Error).message;
      log.error(`Image generation failed: ${message}`);
      return createErrorResult(`Image generation failed: ${message}`);
    }
  }
}
