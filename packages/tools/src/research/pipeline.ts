import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';

/**
 * Market Research Pipeline - 4-layer reasoning engine.
 *
 * Layer 1: Research (data gathering via web search + crawling)
 * Layer 2: Analysis (pattern recognition, SWOT, trends)
 * Layer 3: Strategy (recommendations, risk assessment)
 * Layer 4: Action (reports, presentations, knowledge base updates)
 *
 * This tool orchestrates the research process, saving artifacts to NAS.
 */
export class ResearchPipelineTool implements AgentTool {
  definition = {
    name: 'research_pipeline',
    description: 'Execute a structured market research pipeline with 4 layers: Research (data gathering), Analysis (pattern recognition), Strategy (recommendations), Action (reports). Produces comprehensive research artifacts saved to NAS.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The research topic or question' },
        scope: {
          type: 'string',
          enum: ['quick', 'standard', 'deep'],
          description: 'Research depth: quick (5 min), standard (15 min), deep (30+ min)',
        },
        focus_areas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific areas to focus on (e.g. ["competitors", "pricing", "trends", "audience"])',
        },
        output_format: {
          type: 'string',
          enum: ['summary', 'report', 'swot', 'competitive_analysis', 'full'],
          description: 'Output format (default: report)',
        },
        industry: { type: 'string', description: 'Industry context (e.g. "SaaS", "e-commerce", "fintech")' },
      },
      required: ['topic'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const topic = params['topic'] as string;
    if (!topic) return createErrorResult('Missing required parameter: topic');

    const scope = (params['scope'] as string) ?? 'standard';
    const focusAreas = (params['focus_areas'] as string[]) ?? ['competitors', 'market_size', 'trends', 'opportunities'];
    const outputFormat = (params['output_format'] as string) ?? 'report';
    const industry = params['industry'] as string;

    const timestamp = new Date().toISOString().split('T')[0] ?? 'unknown';
    const reportDir = join(context.nasPath, 'workspace', 'artifacts', 'reports', timestamp);
    await mkdir(reportDir, { recursive: true });

    // Build research brief
    const brief = this.buildResearchBrief(topic, scope, focusAreas, industry);

    // Build the research framework document
    const framework = this.buildFramework(topic, scope, focusAreas, outputFormat, industry);

    // Save brief
    const briefPath = join(reportDir, `research-brief-${slugify(topic)}.md`);
    await writeFile(briefPath, brief, 'utf-8');

    // Save framework
    const frameworkPath = join(reportDir, `research-framework-${slugify(topic)}.md`);
    await writeFile(frameworkPath, framework, 'utf-8');

    return createToolResult(
      `Research pipeline initialized for: "${topic}"\n\n` +
      `Scope: ${scope}\n` +
      `Focus areas: ${focusAreas.join(', ')}\n` +
      `Output format: ${outputFormat}\n` +
      `${industry ? `Industry: ${industry}\n` : ''}` +
      `\nSaved to:\n  Brief: ${briefPath}\n  Framework: ${frameworkPath}\n\n` +
      `=== RESEARCH FRAMEWORK ===\n\n${framework}\n\n` +
      `=== INSTRUCTIONS ===\n` +
      `Follow the framework above step by step. Use web_search and web_fetch tools to gather data.\n` +
      `Save intermediate findings and the final report to: ${reportDir}/\n` +
      `Use the edit tool to incrementally build the report.`,
    );
  }

  private buildResearchBrief(topic: string, scope: string, focusAreas: string[], industry?: string): string {
    return [
      `# Research Brief: ${topic}`,
      ``,
      `**Date:** ${new Date().toISOString()}`,
      `**Scope:** ${scope}`,
      `**Industry:** ${industry ?? 'General'}`,
      `**Focus Areas:** ${focusAreas.join(', ')}`,
      ``,
      `## Objective`,
      `Conduct comprehensive market research on "${topic}" with actionable insights.`,
      ``,
      `## Deliverables`,
      `- Executive summary (1 page)`,
      `- Detailed findings per focus area`,
      `- SWOT analysis`,
      `- Competitive landscape`,
      `- Strategic recommendations`,
      `- Action items with priorities`,
    ].join('\n');
  }

  private buildFramework(topic: string, scope: string, focusAreas: string[], format: string, industry?: string): string {
    const searchDepth = scope === 'quick' ? 3 : scope === 'standard' ? 8 : 15;

    return [
      `# Research Framework: ${topic}`,
      ``,
      `## Layer 1: RESEARCH (Data Gathering)`,
      ``,
      `Execute ${searchDepth} web searches with varied queries:`,
      ...focusAreas.map((area) => `- Search: "${topic} ${area} ${industry ?? ''} ${new Date().getFullYear()}"`.trim()),
      `- Search: "${topic} market size revenue"`,
      `- Search: "${topic} trends predictions"`,
      `- Search: "${topic} competitors comparison"`,
      ``,
      `For each relevant result:`,
      `1. Use web_fetch to read the full content`,
      `2. Extract key data points, statistics, quotes`,
      `3. Note the source and date for citation`,
      ``,
      `## Layer 2: ANALYSIS (Pattern Recognition)`,
      ``,
      `Synthesize gathered data:`,
      `- Identify top 3-5 key themes/patterns`,
      `- Note contradictions or data gaps`,
      `- Build SWOT matrix:`,
      `  - Strengths: Internal advantages`,
      `  - Weaknesses: Internal limitations`,
      `  - Opportunities: External favorable factors`,
      `  - Threats: External risk factors`,
      `- Competitive positioning map`,
      `- Market size & growth trajectory`,
      ``,
      `## Layer 3: STRATEGY (Recommendations)`,
      ``,
      `Based on analysis:`,
      `- Top 3 strategic recommendations (prioritized)`,
      `- Each with: rationale, expected impact, required resources, timeline`,
      `- Risk assessment per recommendation`,
      `- Quick wins vs. long-term plays`,
      `- Resource requirements estimation`,
      ``,
      `## Layer 4: ACTION (Output)`,
      ``,
      `Format: ${format}`,
      ``,
      `Generate:`,
      `1. Executive summary (max 500 words)`,
      `2. Detailed report with sections per focus area`,
      `3. Key data table (competitors, metrics, etc.)`,
      `4. Recommendation matrix (impact vs. effort)`,
      `5. Next steps with assigned priorities`,
    ].join('\n');
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}
