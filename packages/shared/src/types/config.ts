import { z } from 'zod';

export const LLMProviderConfig = z.object({
  id: z.string(),
  name: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().optional(),
  enabled: z.boolean().default(true),
});
export type LLMProviderConfig = z.infer<typeof LLMProviderConfig>;

export const VNCEndpoint = z.object({
  host: z.string(),
  port: z.number().default(6080),
  password: z.string().optional(),
  label: z.string(),
});
export type VNCEndpoint = z.infer<typeof VNCEndpoint>;

export const JarvisConfig = z.object({
  gateway: z.object({
    port: z.number().default(18900),
    host: z.string().default('0.0.0.0'),
    authToken: z.string(),
  }),

  nats: z.object({
    url: z.string().default('nats://localhost:4222'),
  }),

  redis: z.object({
    url: z.string().default('redis://localhost:6379'),
  }),

  nas: z.object({
    mountPath: z.string().default('/Volumes/JarvisNAS/jarvis'),
  }),

  providers: z.record(LLMProviderConfig).default({}),

  vnc: z.object({
    endpoints: z.record(VNCEndpoint).default({}),
  }).default({}),

  agents: z.object({
    alpha: z.object({
      defaultModel: z.string().default('anthropic/claude-sonnet-4-6'),
      maxConcurrency: z.number().default(3),
    }).default({}),
    beta: z.object({
      defaultModel: z.string().default('anthropic/claude-sonnet-4-6'),
      maxConcurrency: z.number().default(3),
    }).default({}),
  }).default({}),
});
export type JarvisConfig = z.infer<typeof JarvisConfig>;
