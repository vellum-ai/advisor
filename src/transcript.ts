/**
 * Convert a captured executor transcript into the message list sent to the
 * advisor sub-call.
 *
 * Strips blocks the advisor shouldn't (or can't) replay:
 *  - thinking / redacted-thinking (the advisor tool drops thinking),
 *  - images / files (keep the consult text-only and provider-agnostic),
 *  - `server_tool_use` AND `web_search_tool_result` — provider-side tool calls
 *    (e.g. web search) and their results are dropped *together*. Dropping the
 *    result without its paired `server_tool_use` would leave an orphaned call
 *    block the provider rejects, so any consult after prior web-search history
 *    would fail; dropping both keeps the sequence valid.
 *  - rich/nested blocks on a `tool_result` (keep its text payload).
 *
 * It also strips the *pending* client tool calls from the final assistant turn:
 * at capture time (a `post-model-call` before tools run) the last assistant
 * message carries the `advisor` tool_use with no matching `tool_result` yet, so
 * sending it would be a dangling call. Earlier, completed `tool_use` /
 * `tool_result` pairs are preserved intact.
 */

import type { ContentBlock, Message } from "@vellumai/plugin-api";

/** Drop disallowed blocks; thin out rich tool_result content. `null` = drop. */
function sanitize(block: ContentBlock): ContentBlock | null {
  switch (block.type) {
    case "thinking":
    case "redacted_thinking":
    case "image":
    case "file":
    case "server_tool_use":
    case "web_search_tool_result":
      return null;
    case "tool_result":
      return block.contentBlocks
        ? { ...block, contentBlocks: undefined }
        : block;
    default:
      return block;
  }
}

export function toAdvisorMessages(
  messages: ReadonlyArray<Message>,
): Message[] {
  const out: Message[] = [];
  const lastIndex = messages.length - 1;

  messages.forEach((message, index) => {
    let content = message.content
      .map(sanitize)
      .filter((b): b is ContentBlock => b !== null);

    // The final assistant turn's client tool calls have no results yet — drop
    // them so we never send a dangling tool_use. (server_tool_use is already
    // dropped above.)
    if (index === lastIndex && message.role === "assistant") {
      content = content.filter(
        (b) => b.type !== "tool_use" && b.type !== "server_tool_use",
      );
    }

    if (content.length > 0) out.push({ role: message.role, content });
  });

  return out;
}
