# gemma-plugin

Claude Code plugin for delegating cheap consultations to a local gemma4 model via Ollama.

Sibling to [gemini-plugin](../gemini-plugin/). Where gemini-rescue is the high-quality agentic delegation path (Google subscription, file editing), gemma-rescue is the **zero-cost, non-agentic consultation path** — a Haiku-tier second opinion that costs no quota and runs entirely offline.

## Niche

| | `gemini:rescue` | `gemma:rescue` |
|---|---|---|
| Billing | Google subscription | Free (local) |
| Agentic | Yes — can read/edit files | No — consultation only |
| Best for | Deep debugging, multi-file refactors, design review | Rubber-ducking, explanations, boilerplate, second opinions |
| Failure mode | Quota exhaustion | Quality ceiling (Haiku-tier) |

They're complementary, not competing. Use gemma-rescue when you want a cheap second opinion and don't need the model to touch files. Use gemini-rescue for everything else.

## Architecture

- **Transport:** HTTP POST to `http://127.0.0.1:11434/api/chat`. Uses the plain Ollama base URL, NOT `/v1`. The r/openclaw Gemma 4 megathread identified `/v1` as the single largest source of tool-calling breakage.
- **Default model:** `gemma4:26b` (MoE, ~17 GB, 256K context window, ~3.8B active parameters per token).
- **Default `num_ctx`:** 32768, auto-bumped when input is large. 32K is the community-reported minimum for reliable context retention at this tier.
- **Default thinking mode:** off. The r/LocalLLaMA thread this plugin is based on confirmed non-thinking has no meaningful quality loss for routine consultations and is noticeably faster.
- **Non-agentic by design.** gemma4 via Ollama cannot read files, edit files, or run commands. The companion script reads files server-side (in Node) via `--files` and inlines them into the prompt as context. Claude stays the agent; gemma4 is the consultant.

## Components

```
plugins/gemma/
├── .claude-plugin/plugin.json
├── agents/gemma-rescue.md          # thin forwarder subagent
├── commands/
│   ├── setup.md                    # /gemma:setup
│   ├── rescue.md                   # /gemma:rescue
│   ├── review.md                   # /gemma:review
│   └── adversarial-review.md       # /gemma:adversarial-review
├── scripts/gemma-companion.mjs     # runtime: setup, task, review, adversarial-review, estimate
└── skills/
    ├── gemma-cli-runtime/SKILL.md      # internal contract
    ├── gemma-prompting/SKILL.md        # prompt-shaping guidance
    └── gemma-result-handling/SKILL.md  # output-handling rules
```

## Installation

Prerequisites: Ollama installed and running, `gemma4:26b` pulled.

```bash
# Install Ollama and start the service
brew install ollama
brew services start ollama

# Pull the default model (~17 GB download)
ollama pull gemma4:26b
```

Register the marketplace with Claude Code:

```
/plugin marketplace add /Users/alex/Projects/gemma-plugin
/plugin install gemma@gemma-local
```

Then restart Claude Code (or reload plugins) and verify:

```
/gemma:setup
```

## Subcommands (companion CLI)

The companion script can also be invoked directly:

```bash
COMPANION=/Users/alex/Projects/gemma-plugin/plugins/gemma/scripts/gemma-companion.mjs

# Check readiness (text or JSON)
node $COMPANION setup
node $COMPANION setup --json

# Free-form consultation
node $COMPANION task "Explain why this test is flaky"
node $COMPANION task --files "src/**/*.ts" "Where does this error come from?"
echo "some code" | node $COMPANION task "What does this do?"

# Review the current git diff
node $COMPANION review
node $COMPANION review --base main
node $COMPANION adversarial-review --base main "focus on concurrency"

# Estimate context size for a scope
node $COMPANION estimate --files "src/**/*.ts"
node $COMPANION estimate --dirs src,test
```

## Flags

- `-m, --model <name>` — model variant. Aliases: `fast`/`e2b`, `edge`/`e4b`, `moe`/`26b`, `dense`/`31b`.
- `--files <glob>` — read matching files server-side and inline them into the prompt.
- `--num-ctx <n>` — override the auto-computed context window. Default 32K, auto-bumped when input is large.
- `--think` / `--nothink` — toggle the model's internal reasoning trace. Default off.
- `--base <ref>` — for `review` and `adversarial-review`, compare against this ref.
- `--scope auto|branch|working-tree` — for reviews, control which changes are included.
- `--json` — for `setup` and `estimate`, emit machine-readable JSON.

## Credit

Architecture inspired by the r/LocalLLaMA thread ["Use a local LLM as a subagent from Claude Code to reduce context use"](https://www.reddit.com/r/LocalLLaMA/comments/1riog2w/) and the r/openclaw Gemma 4 megathread's "Main Brain + Local Sub-Agent" pattern. Ports the structure of the sibling [gemini-plugin](../gemini-plugin/).
