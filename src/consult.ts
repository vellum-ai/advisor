/**
 * Run one advisor consult.
 *
 * Routed entirely through the workspace's own inference: `getConfiguredProvider`
 * (from `@vellumai/plugin-api`) resolves the `inference` call site to a
 * provider/model/credentials from the configured profiles — managed-proxy or
 * BYOK, no plugin-supplied API key — selecting the advisor's model via
 * `overrideProfile`. The consult then runs a tool-less, capped one-shot
 * completion through `provider.sendMessage` and returns the text.
 */

import {
  getConfiguredProvider,
  type LLMCallSite,
  type Message,
  type ProviderResponse,
} from "@vellumai/plugin-api";

import { ADVISOR_CONFIG } from "./config.js";
import { advisorRequestText, buildAdvisorSystem } from "./steering.js";
import { toAdvisorMessages } from "./transcript.js";

// The general-purpose call site available to plugins; the model is selected via
// `overrideProfile`, so no plugin-specific call site is needed.
const ADVISOR_CALL_SITE: LLMCallSite = "inference";

export interface ConsultParams {
  systemPrompt: string | null;
  messages: ReadonlyArray<Message>;
  signal?: AbortSignal;
}

/** Join the text blocks of a provider response. */
function extractText(response: ProviderResponse): string {
  let out = "";
  for (const block of response.content) {
    if (block.type === "text") out += block.text;
  }
  return out.trim();
}

/** Combine the caller's signal with a consult timeout. */
function withTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Returns the advisor's guidance text, or a short benign notice when the
 * advisor can't run. Callers should surface the string as a non-error tool
 * result so the executor continues regardless.
 */
export async function consultAdvisor(params: ConsultParams): Promise<string> {
  const history = toAdvisorMessages(params.messages);
  if (history.length === 0) {
    return "(advisor: no conversation context is available yet)";
  }

  // Force the advisor's profile above any per-call-site config the workspace
  // has pinned to `inference` (often a cheap default). A plain `overrideProfile`
  // is the weakest override layer and loses to a call-site override, which would
  // silently route the consult to that cheaper model; `forceOverrideProfile`
  // floats the advisor's chosen profile back on top.
  const provider = await getConfiguredProvider(ADVISOR_CALL_SITE, {
    overrideProfile: ADVISOR_CONFIG.profile,
    forceOverrideProfile: true,
  });
  if (!provider) {
    return "(advisor unavailable: no inference provider is configured)";
  }

  // Append the consult instruction as the final user turn, then run a
  // tool-less, capped completion through the resolved provider.
  const messages: Message[] = [
    ...history,
    {
      role: "user",
      content: [
        { type: "text", text: advisorRequestText(ADVISOR_CONFIG.wordLimit) },
      ],
    },
  ];

  const response = await provider.sendMessage(messages, {
    systemPrompt: buildAdvisorSystem(params.systemPrompt),
    config: {
      callSite: ADVISOR_CALL_SITE,
      overrideProfile: ADVISOR_CONFIG.profile,
      // Mirror the force onto the send config: `callSite` is set here, so the
      // call-site provider passes this config through verbatim and the resolve
      // runs off these fields rather than the ones given to getConfiguredProvider.
      forceOverrideProfile: true,
      tool_choice: { type: "none" },
      max_tokens: ADVISOR_CONFIG.maxTokens,
    },
    signal: withTimeout(params.signal, ADVISOR_CONFIG.timeoutMs),
  });

  const advice = extractText(response);
  return advice.length > 0 ? advice : "(advisor returned no guidance)";
}
