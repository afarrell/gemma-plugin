---
name: gemma-prompting
description: Internal guidance for composing prompts for local gemma4 consultations via the Gemma Claude Code plugin
user-invocable: false
---

# Gemma Prompting

Use this skill when `gemma:gemma-rescue` needs to shape a prompt before forwarding to the companion's `task` command.

gemma4:26b is a local MoE model (~3.8B active of 26B total) running through Ollama. It is Haiku-tier: fast and free, but not a frontier model. Treat it as a consultant, not an agent.

## What gemma4 is good at

- **Explanation** — walking through how a piece of code works, clarifying a concept, translating between languages
- **Rubber-duck debugging** — surfacing the obvious-in-hindsight fix when the main agent is stuck
- **Boilerplate drafts** — first drafts of tests, migrations, config, simple CRUD
- **Summarization** — condensing logs, errors, long files into actionable bullets
- **Bounded reasoning** — single-file, single-concern problems with clear success criteria

## What gemma4 is NOT good at

- Multi-file reasoning where relationships matter
- Architecture decisions, design tradeoffs
- Tasks requiring access to the current conversation history
- Anything where accuracy is critical and you cannot verify the answer
- Tasks that require reading or editing files (it cannot — it is not agentic)

If the request falls into this second list, stop shaping the prompt and tell the user `gemma:rescue` is the wrong tool — recommend `/gemini:rescue` or letting Claude handle it directly.

## Core prompting rules

- **One clear job per call.** Split unrelated asks into separate runs.
- **State what "done" looks like.** gemma4 does not infer desired end states as well as frontier models — be explicit.
- **Scope the context.** Pass only what gemma4 needs to answer. Extra context slows inference without improving quality at this tier.
- **Ground every claim.** Tell gemma4 to anchor its answer to the provided context, and to say "I'm guessing" when it has to extrapolate.
- **Prefer short output contracts.** A 5-bullet answer is better than a 500-word explanation for most consultation tasks.

## Prompt recipe

Use XML tags for structure when the prompt is non-trivial:

- `<task>` — the concrete question, one sentence if possible
- `<context>` — the code, diff, or facts gemma4 needs (auto-populated by the companion from `--files` or stdin)
- `<output_contract>` — exact shape of the expected answer (format, length, headings if any)
- `<grounding>` — "stay within the provided context; flag anything you are guessing at"

Add these only when they buy something. A bare task text is fine for simple questions.

## Verify context received before debugging the prompt

gemma4:26b can confabulate "no code attached" or "please paste the code" even when the context IS in its prompt. This makes it look like a piping/glob bug when it's actually a model confabulation. Wasting iterations on the prompt when the mechanism is fine is the most expensive failure mode in this plugin.

Before iterating on the prompt, **always run a marker test first** to isolate mechanism failures from confabulation:

```bash
# 3-second sanity check that proves the pipeline carries content end to end
echo "MARKER_XYZZY_12345" | node gemma-companion.mjs task \
  "What EXACT string did I send? Reply with just the string, nothing else."
```

If gemma echoes the marker back, **the mechanism is fine** — any subsequent "no code attached" response is a model confabulation, not a piping or glob failure. Treat the next response accordingly:

- **Tell gemma explicitly** that the content IS in its context: *"The full source is in your context — you can see it. Reference specific lines or function names you find. Do NOT claim the code is missing."*
- **Ask gemma to quote** something specific from the context as a self-verification: *"Quote the first 3 lines of your context block before answering."* This forces it to actually look.
- **Cap context size.** Confabulation gets worse near the model's effective ceiling (well below the nominal `num_ctx`). For 26b, ~30KB of context is reliable; ~40KB starts producing fetch failures and confabulation. Strip non-essential files via narrower `--files` patterns rather than throwing the whole tree at it.

When the marker test FAILS (no marker echoed), the issue is in the pipeline: check `--files` glob expansion (the resolver supports `**` and `{a,b}`, but typos in paths still match nothing), check stdin TTY detection if running from a non-shell context, or check the stderr `--files: read N files` line that the companion logs on every run.

## Model selection

- `gemma4:26b` (default): MoE, ~17 GB, balanced speed and quality. Use for almost everything.
- `gemma4:e4b`: Edge model, ~9.6 GB, faster but noticeably weaker reasoning. Use only when you need sub-5-second responses.
- `gemma4:e2b`: Edge model, ~7.2 GB, fastest. Use only for the simplest lookups.
- `gemma4:31b`: Dense, ~20 GB, highest quality but slowest. Reserve for genuinely tricky single-file problems where the MoE model fell short.

Default to 26b. Only switch when there is a specific reason.

## Thinking mode

- Default: **non-thinking**. Faster, fewer tokens, no meaningful quality loss for routine consultations (per the r/LocalLLaMA thread that the plugin is based on).
- Enable `--think` only when the task is analytical — a subtle bug hunt, a code review, or a multi-step logical argument where the reasoning trace genuinely helps.

## Context length

- Default `num_ctx` is 32K. This is the r/openclaw Gemma 4 megathread's minimum for reliable tool-calling and context retention.
- The companion auto-bumps `num_ctx` above 32K when the inlined context is large. You usually do not need to set `--num-ctx` manually.
- Do not bump it above the model's native window (128K for edge, 256K for MoE/dense) — the model will degrade noticeably near its ceiling.

## Working rules

- Prefer explicit prompt contracts over vague nudges.
- Do not escalate to a larger variant before tightening the prompt.
- Keep claims anchored to the provided context. If the answer has to extrapolate, say so.
- When context is a diff, mark it clearly with `<diff>` tags so gemma4 doesn't confuse before/after lines with current code.
