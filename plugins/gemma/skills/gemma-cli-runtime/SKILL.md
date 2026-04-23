---
name: gemma-cli-runtime
description: Internal helper contract for calling the gemma-companion runtime from Claude Code
user-invocable: false
---

# Gemma CLI Runtime

Use this skill only inside the `gemma:gemma-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemma-companion.mjs" task "<raw arguments>"`

Auth and transport:
- No auth — gemma4 runs locally via Ollama. The companion talks to `http://127.0.0.1:11434/api/chat` directly.
- CRITICAL: do NOT use the `/v1` OpenAI-compatible endpoint. The r/openclaw Gemma 4 megathread identified `/v1` as the single largest source of tool-calling breakage. The companion hardcodes the plain base URL — do not try to override this.
- No API key setup required. If Ollama is missing or the server is not running, instruct the user to run `/gemma:setup`.

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Prefer the helper over hand-rolled `ollama` CLI strings or direct `fetch` calls.
- Do not call `setup`, `review`, or `adversarial-review` from `gemma:gemma-rescue`.
- Use `task` for every rescue request, including explanations, diagnosis, rubber-duck debugging, boilerplate drafts, and summarization.
- You may use the `gemma-prompting` skill to rewrite the user's request into a tighter prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.
- Leave `-m` unset by default. The companion auto-picks the best installed model for the subcommand: `task` prefers `gemma4:26b` (MoE, balanced), `review` and `adversarial-review` prefer `gemma4:31b` (dense, deeper reasoning) when it's installed. Rescue agent only runs `task`, so the effective default is 26b. The chosen model is logged to stderr when it isn't the historical default, so the user always sees what ran.
- Add `-m` only when the user explicitly asks for a specific variant or when `gemma-prompting` guidance recommends an override for this situation.
- Model aliases: `fast`/`e2b` → `gemma4:e2b`, `edge`/`e4b` → `gemma4:e4b`, `moe`/`26b` → `gemma4:26b`, `dense`/`31b` → `gemma4:31b`.
- Context scoping: `--files "src/**/*.ts"` pipes matching files via shell glob. The companion reads them server-side and inlines them into the prompt.
- The companion auto-bumps `num_ctx` above the 32K default when input is large. Use `--num-ctx <n>` only to override explicitly.
- Default to non-thinking mode. The r/LocalLLaMA thread confirmed thinking provides no meaningful quality improvement for routine consultations and adds noticeable latency. Pass `--think` only when the user explicitly asks for reasoning.

Non-agentic constraint:
- gemma4 via Ollama CANNOT read files, edit files, or run commands. It only answers prompts.
- This is a deliberate scope. Do not attempt to invoke tool-calling APIs, do not forward requests that require file edits, and do not tell the user that gemma4 will "go look at" something.
- If the user request requires agentic work (file edits, multi-file reasoning, running tests, etc.), stop and recommend `/gemini:rescue` or a direct Claude action instead.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- Preserve the user's task text as-is apart from stripping routing flags.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or Ollama cannot be invoked, return nothing.

Safety rules:
- Do not inspect the repository, read files, grep, monitor progress, summarize output, or do any follow-up work of your own.
- Do not substitute a Claude-side answer when gemma4 fails or returns nothing.
