import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';
import { ExecTool } from '../exec.js';

const exec = new ExecTool({ mode: 'full' });

/**
 * React Native / Expo build tool using Fastlane and EAS.
 * Handles building, testing, and preparing apps for submission.
 */
export class MobileBuildTool implements AgentTool {
  definition = {
    name: 'mobile_build',
    description: 'Build React Native / Expo mobile applications for iOS and Android. Supports Fastlane lanes, EAS Build, and local builds.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['build_ios', 'build_android', 'build_both', 'eas_build', 'test', 'lint', 'status'],
          description: 'Build action to perform',
        },
        project_path: { type: 'string', description: 'Path to the React Native project (relative to workspace)' },
        profile: { type: 'string', enum: ['development', 'preview', 'production'], description: 'Build profile (default: production)' },
        platform: { type: 'string', enum: ['ios', 'android', 'all'], description: 'Target platform for EAS build' },
      },
      required: ['action'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as string;
    const projectPath = (params['project_path'] as string) || context.workspacePath;
    const profile = (params['profile'] as string) || 'production';
    const platform = (params['platform'] as string) || 'all';

    // Validate parameters to prevent shell injection
    const validPlatforms = ['ios', 'android', 'all'];
    if (!validPlatforms.includes(platform)) {
      return createErrorResult(`Invalid platform: "${platform}". Must be one of: ${validPlatforms.join(', ')}`);
    }
    const validProfiles = ['development', 'preview', 'production'];
    if (!validProfiles.includes(profile)) {
      return createErrorResult(`Invalid profile: "${profile}". Must be one of: ${validProfiles.join(', ')}`);
    }

    const ctx = { ...context, cwd: projectPath };

    switch (action) {
      case 'build_ios':
        return exec.execute({
          command: `cd "${projectPath}" && npx react-native build-ios --mode Release`,
          timeout: 600_000, // 10 min
        }, ctx);

      case 'build_android':
        return exec.execute({
          command: `cd "${projectPath}" && npx react-native build-android --mode Release`,
          timeout: 600_000,
        }, ctx);

      case 'build_both':
        return exec.execute({
          command: `cd "${projectPath}" && npx react-native build-ios --mode Release && npx react-native build-android --mode Release`,
          timeout: 900_000, // 15 min
        }, ctx);

      case 'eas_build':
        return exec.execute({
          command: `cd "${projectPath}" && npx eas-cli build --platform "${platform}" --profile "${profile}" --non-interactive`,
          timeout: 300_000, // 5 min (starts remote build)
        }, ctx);

      case 'test':
        return exec.execute({
          command: `cd "${projectPath}" && npm test -- --ci --coverage`,
          timeout: 300_000,
        }, ctx);

      case 'lint':
        return exec.execute({
          command: `cd "${projectPath}" && npx eslint . --ext .ts,.tsx --max-warnings 0`,
          timeout: 120_000,
        }, ctx);

      case 'status':
        return exec.execute({
          command: `cd "${projectPath}" && npx eas-cli build:list --limit 5 --json 2>/dev/null || echo "EAS CLI not available"`,
          timeout: 30_000,
        }, ctx);

      default:
        return createErrorResult(`Unknown build action: ${action}`);
    }
  }
}

/**
 * App Store / Google Play submission tool.
 * Handles automated app submission via Fastlane.
 */
export class MobileSubmitTool implements AgentTool {
  definition = {
    name: 'mobile_submit',
    description: 'Submit mobile app builds to App Store Connect (iOS) or Google Play Console (Android) using Fastlane or EAS Submit.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['submit_ios', 'submit_android', 'submit_both', 'status_ios', 'status_android', 'fastlane'],
          description: 'Submission action',
        },
        project_path: { type: 'string', description: 'Path to the project' },
        profile: { type: 'string', enum: ['production', 'preview'], description: 'EAS submit profile' },
        lane: { type: 'string', description: 'Fastlane lane to run (for fastlane action)' },
        platform: { type: 'string', enum: ['ios', 'android'], description: 'Platform for Fastlane' },
      },
      required: ['action'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as string;
    const projectPath = (params['project_path'] as string) || context.workspacePath;
    const profile = (params['profile'] as string) || 'production';
    const ctx = { ...context, cwd: projectPath };

    // Validate profile to prevent shell injection
    const validProfiles = ['production', 'preview'];
    if (!validProfiles.includes(profile)) {
      return createErrorResult(`Invalid profile: "${profile}". Must be one of: ${validProfiles.join(', ')}`);
    }

    switch (action) {
      case 'submit_ios':
        return exec.execute({
          command: `cd "${projectPath}" && npx eas-cli submit --platform ios --profile "${profile}" --non-interactive`,
          timeout: 300_000,
        }, ctx);

      case 'submit_android':
        return exec.execute({
          command: `cd "${projectPath}" && npx eas-cli submit --platform android --profile "${profile}" --non-interactive`,
          timeout: 300_000,
        }, ctx);

      case 'submit_both':
        return exec.execute({
          command: `cd "${projectPath}" && npx eas-cli submit --platform all --profile "${profile}" --non-interactive`,
          timeout: 300_000,
        }, ctx);

      case 'status_ios':
        return exec.execute({
          command: `cd "${projectPath}" && npx eas-cli submission:list --platform ios --limit 5 2>/dev/null || echo "Check App Store Connect manually"`,
          timeout: 30_000,
        }, ctx);

      case 'status_android':
        return exec.execute({
          command: `cd "${projectPath}" && npx eas-cli submission:list --platform android --limit 5 2>/dev/null || echo "Check Google Play Console manually"`,
          timeout: 30_000,
        }, ctx);

      case 'fastlane': {
        const lane = params['lane'] as string;
        const platform = params['platform'] as string ?? 'ios';
        if (!lane) return createErrorResult('Fastlane action requires: lane');

        // Validate lane and platform to prevent shell injection
        if (!/^[a-zA-Z0-9_-]+$/.test(lane)) {
          return createErrorResult('Invalid lane: only alphanumeric characters, underscores, and hyphens are allowed');
        }
        const validPlatforms = ['ios', 'android'];
        if (!validPlatforms.includes(platform)) {
          return createErrorResult(`Invalid platform: "${platform}". Must be one of: ${validPlatforms.join(', ')}`);
        }

        return exec.execute({
          command: `cd "${projectPath}" && bundle exec fastlane "${platform}" "${lane}"`,
          timeout: 600_000,
        }, ctx);
      }

      default:
        return createErrorResult(`Unknown submit action: ${action}`);
    }
  }
}
