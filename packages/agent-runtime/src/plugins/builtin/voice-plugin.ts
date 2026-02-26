/**
 * Voice Plugin — Voice synthesis and processing support for Jarvis agents.
 *
 * Tools:
 * - voice_respond: Generate a voice response in character as Jarvis
 * - voice_status: Check voice system status
 *
 * Hooks:
 * - session_start: Log voice capability
 * - message_received: Detect voice-originated messages
 *
 * Prompt section: Adds Jarvis personality and voice behavior guidelines.
 */

import type { JarvisPluginDefinition, PluginApi } from '../types.js';

export function createVoicePlugin(): JarvisPluginDefinition {
  return {
    id: 'voice',
    name: 'Voice Interface',
    version: '1.0.0',
    description: 'Speech-to-text and text-to-speech support with Jarvis personality',

    register(api: PluginApi) {
      const log = api.logger;

      // --- Tools ---

      api.registerTool({
        name: 'voice_respond',
        description: 'Generate a response as Jarvis for voice output. The response should be natural, concise, and in-character as a sophisticated AI assistant. Support Polish and English.',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The user\'s voice message to respond to',
            },
            language: {
              type: 'string',
              enum: ['pl', 'en'],
              description: 'Response language: pl (Polish) or en (English)',
            },
            context: {
              type: 'string',
              description: 'Additional context about current system state',
            },
          },
          required: ['message', 'language'],
        },
        execute: async (_params, context) => {
          const { message, language, context: sysContext } = _params as {
            message: string;
            language: 'pl' | 'en';
            context?: string;
          };

          log.info(`Voice respond request [${language}]: "${message.substring(0, 50)}..."`);

          // Build prompt — natural, casual, no cringe butler talk
          const systemPrompt = language === 'pl'
            ? `Jesteś Jarvis — system AI zarządzający agentami. Gadasz normalnie, po ludzku, bez sztucznego "sir" czy "do usług". Mów jak kumpel który ogarnia temat — krótko, konkretnie, czasem z lekkim sarkazmem. Masz agentów AI (Smith — dev, Johny — marketing), NATS, Redis, NAS. Odpowiadaj po polsku, max 2-3 zdania, to jest odpowiedź głosowa.${sysContext ? `\n\nKontekst: ${sysContext}` : ''}`
            : `You're Jarvis — an AI system managing agents. Talk naturally, casually, like a knowledgeable friend — no "sir", no butler talk. Be brief, direct, sometimes a bit sarcastic. You have AI agents (Smith — dev, Johny — marketing), NATS, Redis, NAS. Max 2-3 sentences, this is a voice response.${sysContext ? `\n\nContext: ${sysContext}` : ''}`;

          return {
            systemPrompt,
            userMessage: message,
            responseGuidelines: {
              maxLength: 200,
              style: 'concise, professional, slight wit',
              persona: 'Jarvis AI assistant',
              language,
            },
          };
        },
      });

      api.registerTool({
        name: 'voice_status',
        description: 'Get the current voice system status and capabilities',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: async () => {
          return {
            enabled: true,
            sttEngines: ['web-speech-api', 'whisper'],
            ttsEngines: ['elevenlabs', 'openai', 'browser'],
            supportedLanguages: ['pl-PL', 'en-US'],
            features: [
              'real-time-transcription',
              'wake-word-detection',
              'continuous-listening',
              'audio-level-monitoring',
              'multi-provider-tts',
              'voice-conversation-history',
            ],
          };
        },
      });

      // --- Hooks ---

      api.registerHook('session_start', async () => {
        log.info('Voice plugin active — speech interface available');
      });

      api.registerHook('message_received', async (context) => {
        const msg = context as Record<string, unknown>;
        if (msg?.source === 'voice') {
          log.info(`Voice message received: "${(msg.content as string)?.substring(0, 50)}..."`);
        }
      });

      // --- Prompt Section ---

      api.registerPromptSection({
        id: 'voice-personality',
        title: 'Voice Interface Personality',
        content: `You have a voice interface. When responding to voice messages:
- Keep responses SHORT (1-3 sentences) — they will be spoken aloud
- Talk naturally and casually, like a smart friend — NO "sir", NO butler talk, NO "at your service"
- Polish: gadaj normalnie, po ludzku, bez "wielmożny panie" czy "do usług". Jak kumpel.
- English: be chill and direct, no formalities
- A bit of sarcasm or humor is fine, but don't overdo it
- You understand both Polish and English and can switch between them
- For system commands (status, agents, tasks), just give the facts briefly
- Never use markdown formatting in voice responses — plain text only
- If someone curses, stay chill and ask what's wrong`,
        priority: 50,
      });

      log.info('Voice plugin registered — 2 tools, 2 hooks, 1 prompt section');
    },
  };
}
