/**
 * The `advisor` tool — a no-argument tool the model calls to consult a stronger
 * model for strategic guidance. The model supplies no input; the plugin reads
 * the transcript captured by the lifecycle hooks and runs the consult, routed
 * through the workspace's own inference.
 *
 * Default export = the tool definition. The plugin loader derives the tool name
 * from the file basename (`advisor`) and registers it in the model's catalog.
 */

import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "@vellumai/plugin-api";
import { RiskLevel } from "@vellumai/plugin-api";

import { consultAdvisor } from "../src/consult.js";
import { getCapture } from "../src/state.js";

const advisorTool: ToolDefinition = {
  name: "advisor",
  description:
    "Consult a stronger advisor model for strategic guidance. Takes NO parameters — your " +
    "full conversation (the task, every tool call, and every result) is forwarded " +
    "automatically. Call it before substantive work, when you're stuck, when changing " +
    "approach, and once before declaring a task complete.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  // Read-only advice; low risk so the consult isn't gated behind a prompt.
  defaultRiskLevel: RiskLevel.Low,
  async execute(
    _input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> {
    try {
      const capture = getCapture(ctx.conversationId);
      const advice = await consultAdvisor({
        systemPrompt: capture?.systemPrompt ?? null,
        messages: capture?.messages ?? [],
        signal: ctx.signal,
      });
      return { content: advice, isError: false };
    } catch (err) {
      // Degrade like the advisor tool: never fail the turn over a consult.
      const reason = err instanceof Error ? err.message : String(err);
      return { content: `(advisor unavailable: ${reason})`, isError: false };
    }
  },
};

export default advisorTool;
