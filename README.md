# Advisor

A user-installable [Vellum Assistant](https://github.com/vellum-ai/vellum-assistant) plugin
that adds an **`advisor` tool** — a no-argument tool the model calls mid-task to consult a
**stronger inference profile** on the full conversation transcript for strategic guidance.
It imitates Anthropic's
[advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool):
the model calls `advisor()` with nothing, and the plugin forwards its transcript to a stronger
model and returns concise guidance the model continues from.

The consult is **routed through the workspace's own inference** — managed-proxy on a managed
install, the user's own key on BYOK — so there is **no separate API key** to configure. The
advisor's model is just an inference profile (default `quality-optimized`).

## How it works

A tool's `execute` can't see the conversation transcript — only lifecycle hooks can — so the
hooks capture what the executor saw and the tool reads it:

- **`hooks/post-model-call.ts`** snapshots the transcript the executor saw (fires before tools
  run), keyed by conversation.
- **`hooks/pre-model-call.ts`** captures the executor's system prompt and injects steering that
  nudges the model to consult.
- **`hooks/user-prompt-submit.ts`** seeds the capture at turn start.
- **`tools/advisor.ts`** — the no-arg tool; reads the capture and runs the consult.
- **`src/consult.ts`** resolves a provider with
  `getConfiguredProvider("inference", { overrideProfile })` and runs a tool-less, capped
  `sendMessage`, returning the text. It **soft-fails** (never throws), so a consult never fails
  the turn.
- **`src/transcript.ts`** sanitizes the transcript for the advisor (drops thinking, keeps
  images, drops `server_tool_use` + web-search results together, strips the pending `advisor`
  call).

Recursion-safe: the advisor sub-call runs through `sendMessage` directly (not the agent loop),
and the capture hooks gate on `mainAgent`, so the advisor can't trigger itself.

## Layout

```
advisor/
├── hooks/          # pre-model-call, post-model-call, user-prompt-submit
├── tools/          # advisor.ts (default export = the tool)
├── src/            # internal modules (config, state, steering, transcript, consult)
└── __tests__/      # unit tests
```

## Configure

The advisor's model is the inference profile in `src/config.ts` (`profile`, default
`quality-optimized`) — any profile from `getModelProfiles()`. Also: `maxTokens` (2048),
`wordLimit` (80), `timeoutMs`, `steeringEnabled`.

## Develop

```bash
bun install
bun run typecheck
bun test
```

> Requires `@vellumai/plugin-api` to export `getConfiguredProvider` (vellum-ai/vellum-assistant
> PR #35143). Until that ships in the published package, typecheck against an assistant checkout
> that includes it.

## Install into an assistant

Whitelisted in the assistant's
[`plugins/marketplace.json`](https://github.com/vellum-ai/vellum-assistant/blob/main/plugins/marketplace.json),
then:

```bash
assistant plugins install advisor
```
