#!/usr/bin/env node
/**
 * gemma-companion.mjs — Companion script for Ollama/gemma4 integration with Claude Code.
 *
 * Subcommands:
 *   setup               Check Ollama binary, server, and whether gemma4:26b is pulled
 *   task                Forward an arbitrary consultation to gemma4
 *   review              Run a code review against local git state
 *   adversarial-review  Run a challenge-focused code review
 *   estimate            Estimate context size and recommend num_ctx
 *
 * Transport: HTTP POST to http://127.0.0.1:11434/api/chat (plain base URL, NOT /v1).
 * Auth: none — fully local.
 * Agentic: no — the model cannot read files on its own. Pipe context via stdin
 *          or --files; the companion reads those server-side and inlines them.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const DEFAULT_MODEL = "gemma4:26b";
const DEFAULT_NUM_CTX = 32768;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

const MODELS = {
  "gemma4:e2b": { ramGB: 7.2, contextWindow: 131_072, tier: "edge", speed: "fastest" },
  "gemma4:e4b": { ramGB: 9.6, contextWindow: 131_072, tier: "edge", speed: "fast" },
  "gemma4:26b": { ramGB: 17, contextWindow: 262_144, tier: "moe", speed: "balanced" },
  "gemma4:31b": { ramGB: 20, contextWindow: 262_144, tier: "dense", speed: "slow" },
};

// ── Helpers ──

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: opts.timeout || 30_000,
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch {
    return opts.fallback ?? null;
  }
}

function isGitRepo() {
  return run("git rev-parse --is-inside-work-tree") === "true";
}

function ollamaPath() {
  return run("which ollama") || run("command -v ollama");
}

function ollamaVersion() {
  return run("ollama --version");
}

async function ollamaServerAlive() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function listInstalledModels() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.models || []).map((m) => ({ name: m.name, size: m.size }));
  } catch {
    return [];
  }
}

function readStdinIfPiped() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

// ── Git context (ported from gemini-companion) ──

function gitDiffForReview(args) {
  const base = args.base;
  const scope = args.scope || "auto";

  if (base) {
    return run(`git diff ${base}...HEAD`, { fallback: "" });
  }

  if (scope === "branch") {
    const mainBranch =
      run("git rev-parse --verify main 2>/dev/null && echo main") ||
      run("git rev-parse --verify master 2>/dev/null && echo master") ||
      "main";
    return run(`git diff ${mainBranch}...HEAD`, { fallback: "" });
  }

  const staged = run("git diff --cached", { fallback: "" });
  const unstaged = run("git diff", { fallback: "" });
  const combined = [staged, unstaged].filter(Boolean).join("\n");
  if (combined) return combined;

  // Untracked files — synthesize a diff against /dev/null
  const untracked = run("git ls-files --others --exclude-standard", { fallback: "" });
  if (!untracked) return "";
  const files = untracked.split("\n").filter(Boolean);
  return files
    .map((f) => {
      try {
        const content = readFileSync(f, "utf-8");
        const lines = content.split("\n");
        return `--- /dev/null\n+++ b/${f}\n@@ -0,0 +1,${lines.length} @@\n${lines
          .map((l) => `+${l}`)
          .join("\n")}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

// ── Ollama invocation ──

function computeNumCtx({ system, user, explicitNumCtx, model }) {
  if (explicitNumCtx) return explicitNumCtx;
  const bytes = Buffer.byteLength((system || "") + (user || ""), "utf-8");
  const estTokens = Math.ceil(bytes / 4);
  const modelInfo = MODELS[model] || MODELS[DEFAULT_MODEL];
  // If estimated input is well under the default, use the default
  if (estTokens < DEFAULT_NUM_CTX * 0.6) return DEFAULT_NUM_CTX;
  // Otherwise bump to ~1.5x estimated (headroom for output), rounded to 4K
  const target = Math.ceil((estTokens * 1.5) / 4096) * 4096;
  return Math.min(modelInfo.contextWindow, Math.max(DEFAULT_NUM_CTX, target));
}

async function invokeOllama({ system, user, model, numCtx, think, temperature }) {
  const resolvedModel = model || DEFAULT_MODEL;
  const resolvedCtx = computeNumCtx({ system, user, explicitNumCtx: numCtx, model: resolvedModel });

  const body = {
    model: resolvedModel,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: user },
    ],
    stream: false,
    think: think ?? false,
    options: {
      num_ctx: resolvedCtx,
      ...(temperature !== undefined ? { temperature } : {}),
    },
  };

  let res;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`Error contacting Ollama at ${OLLAMA_HOST}: ${err.message}`);
    console.error(`Is the server running? Try: brew services start ollama`);
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Ollama returned ${res.status}: ${text}`);
    process.exit(1);
  }

  const json = await res.json();
  return json?.message?.content || "";
}

// ── Subcommands ──

async function cmdSetup(args) {
  const path = ollamaPath();
  const version = path ? ollamaVersion() : null;
  const serverAlive = await ollamaServerAlive();
  const installed = serverAlive ? await listInstalledModels() : [];
  const hasDefault = installed.some((m) => m.name === DEFAULT_MODEL);

  const result = {
    available: !!path,
    binary: path || null,
    version: version || null,
    server: { host: OLLAMA_HOST, alive: serverAlive },
    defaultModel: DEFAULT_MODEL,
    defaultModelPulled: hasDefault,
    installedModels: installed.map((m) => m.name),
    billing: "free (local)",
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.available) {
    console.log("## Ollama Status: NOT INSTALLED\n");
    console.log("Install with: `brew install ollama`");
    console.log("Then start the server: `brew services start ollama`");
    return;
  }

  console.log("## Ollama Status\n");
  console.log(`- **Binary:** ${result.binary}`);
  console.log(`- **Version:** ${result.version}`);
  console.log(
    `- **Server:** ${result.server.host} — ${serverAlive ? "running" : "NOT RUNNING"}`,
  );
  console.log(`- **Default model:** ${result.defaultModel}`);
  console.log(`- **Default pulled:** ${hasDefault ? "yes" : "NO"}`);
  const others = installed.map((m) => m.name).filter((n) => n !== DEFAULT_MODEL);
  if (others.length) {
    console.log(`- **Other installed models:** ${others.join(", ")}`);
  }
  console.log(`- **Billing:** ${result.billing}`);

  if (!serverAlive) {
    console.log(
      "\n> **Action required:** Ollama server is not running. Start it with:",
    );
    console.log("> `brew services start ollama`");
  } else if (!hasDefault) {
    console.log(
      `\n> **Action required:** The default model \`${DEFAULT_MODEL}\` is not pulled. Run:`,
    );
    console.log(`> \`ollama pull ${DEFAULT_MODEL}\``);
  }
}

async function cmdTask(args) {
  const taskText = args.rest.join(" ");
  if (!taskText) {
    console.error("Error: No task description provided.");
    process.exit(1);
  }
  const model = args.model || DEFAULT_MODEL;

  // Gather file context if --files specified
  let context = "";
  if (args.files) {
    const fileContent = run(`cat ${args.files} 2>/dev/null`, {
      fallback: "",
      timeout: 15_000,
    });
    if (!fileContent) {
      console.error(`Warning: --files "${args.files}" matched no files.`);
    }
    context = fileContent;
  }

  // Also accept stdin piped context
  const stdinData = readStdinIfPiped();
  if (stdinData) {
    context = context ? `${context}\n\n${stdinData}` : stdinData;
  }

  warnIfExpensive(model, context);

  const system = `You are gemma4 running locally via Ollama, acting as a consultant to a Claude Code agent. The Claude agent hands you focused questions, code snippets, and diffs when it wants a cheap second opinion without burning context or quota.

Your strengths: explanation, rubber-duck debugging, boilerplate generation, summarization, focused reasoning on a single bounded problem.

Answer directly and concisely. Do not ask clarifying questions unless something is genuinely ambiguous — take your best shot and flag uncertainty in one line at the end. You are Haiku-tier, not a frontier model; stay within what you can verify from the context provided and say so when you're guessing.`;

  const user = context
    ? `<task>\n${taskText}\n</task>\n\n<context>\n${context}\n</context>`
    : taskText;

  const output = await invokeOllama({
    system,
    user,
    model,
    numCtx: args.numCtx,
    think: args.think,
  });
  process.stdout.write(output);
  if (!output.endsWith("\n")) process.stdout.write("\n");
}

async function cmdReview(args) {
  if (!isGitRepo()) {
    console.error("Error: Not in a git repository. Review requires git changes to analyze.");
    process.exit(1);
  }
  const diff = gitDiffForReview(args);
  if (!diff) {
    console.log("Nothing to review — no changes detected in the target scope.");
    const status = run("git status --short --untracked-files=all", { fallback: "" });
    if (status) console.log(`\nGit status:\n${status}`);
    return;
  }
  const model = args.model || DEFAULT_MODEL;
  warnIfExpensive(model, diff);

  const system = `You are a senior code reviewer running as gemma4 via Ollama. You are a cheap second-opinion reviewer, not the final authority — find real issues, but don't invent concerns to sound thorough.`;

  const user = `Review the following git diff thoroughly.

For each finding, report:
- **Severity:** critical / high / medium / low
- **File:** path and line number(s)
- **Issue:** clear description
- **Fix:** concrete suggestion

Categories to check:
1. Bugs and logic errors
2. Security vulnerabilities (injection, auth bypass, data exposure)
3. Performance issues
4. Error handling gaps
5. Code quality and readability

If no issues are found, state that explicitly and note any residual risks.

Structure your output as:
## Summary
[1-2 sentence overview]

## Findings
[Ordered by severity, most critical first]

## Verdict
[PASS / PASS WITH NOTES / NEEDS CHANGES]

<diff>
${diff}
</diff>`;

  const output = await invokeOllama({
    system,
    user,
    model,
    numCtx: args.numCtx,
    think: args.think ?? true,
  });
  process.stdout.write(output);
  if (!output.endsWith("\n")) process.stdout.write("\n");
}

async function cmdAdversarialReview(args) {
  if (!isGitRepo()) {
    console.error("Error: Not in a git repository.");
    process.exit(1);
  }
  const diff = gitDiffForReview(args);
  if (!diff) {
    console.log("Nothing to review — no changes detected in the target scope.");
    return;
  }
  const model = args.model || DEFAULT_MODEL;
  const focusText = args.rest.length > 0 ? `\n\nAdditional focus: ${args.rest.join(" ")}` : "";
  warnIfExpensive(model, diff);

  const system = `You are an adversarial code reviewer running as gemma4. Your job is NOT just to find bugs — challenge design choices, assumptions, and tradeoffs. Be direct. Stay grounded in the diff; do not fabricate issues that aren't visible in the provided context.`;

  const user = `Review the following git diff adversarially.

For each concern, report:
- **Category:** design / architecture / assumptions / tradeoffs / correctness / security
- **File:** path and line number(s)
- **Challenge:** what you're questioning and why
- **Risk:** what could go wrong under real-world conditions
- **Alternative:** a different approach worth considering

Questions to drive your review:
1. Is this the right approach, or is there a simpler/more robust alternative?
2. What assumptions does this code make that could break?
3. What happens at 10x scale? Under adversarial input? During partial failures?
4. Are there implicit dependencies or coupling that make this fragile?
5. What would a future maintainer misunderstand?${focusText}

Structure your output as:
## Design Challenges
[Most impactful first]

## Assumption Risks
[Implicit assumptions that could break]

## Verdict
[SOLID / ACCEPTABLE / RECONSIDER]

<diff>
${diff}
</diff>`;

  const output = await invokeOllama({
    system,
    user,
    model,
    numCtx: args.numCtx,
    think: args.think ?? true,
  });
  process.stdout.write(output);
  if (!output.endsWith("\n")) process.stdout.write("\n");
}

// ── Context estimation ──

function estimateBytes(dirs, files) {
  if (files) {
    const out = run(`wc -c ${files} 2>/dev/null | tail -1`, {
      timeout: 10_000,
      fallback: "0",
    });
    return parseInt(out?.match(/(\d+)/)?.[1] || "0", 10);
  }
  const paths = dirs ? dirs.split(",").map((p) => p.trim()) : ["."];
  let totalKB = 0;
  for (const p of paths) {
    const duOut = run(`du -sk "${p}" 2>/dev/null`, { timeout: 5000, fallback: "0" });
    const match = duOut?.match(/^(\d+)/);
    if (match) totalKB += parseInt(match[1], 10);
  }
  if (!dirs) {
    for (const skip of [".git", "node_modules", "dist", ".next", "vendor", ".venv", "__pycache__"]) {
      const skipOut = run(`du -sk "${skip}" 2>/dev/null`, { timeout: 3000, fallback: "0" });
      const skipKB = parseInt(skipOut?.match(/^(\d+)/)?.[1] || "0", 10);
      totalKB = Math.max(0, totalKB - skipKB);
    }
  }
  return totalKB * 1024;
}

function warnIfExpensive(model, inlineContext) {
  try {
    const bytes = inlineContext ? Buffer.byteLength(inlineContext, "utf-8") : 0;
    const estTokens = Math.ceil(bytes / 4);
    const modelInfo = MODELS[model] || MODELS[DEFAULT_MODEL];

    if (estTokens > 32_000) {
      process.stderr.write(
        `\n>> NOTE: ~${(estTokens / 1000).toFixed(0)}K estimated context tokens. Auto-bumping num_ctx above the 32K default. Larger contexts slow inference noticeably on M-series.\n\n`,
      );
    }
    if (estTokens > modelInfo.contextWindow * 0.9) {
      process.stderr.write(
        `\n>> WARNING: context likely exceeds ${model}'s ${modelInfo.contextWindow / 1000}K window. Scope with --files or switch models.\n\n`,
      );
    }
  } catch {
    // non-fatal
  }
}

function cmdEstimate(args) {
  const model = args.model || DEFAULT_MODEL;
  const modelInfo = MODELS[model] || MODELS[DEFAULT_MODEL];
  const bytes = estimateBytes(args.dirs, args.files);
  const estTokens = Math.ceil(bytes / 4);
  const usage = estTokens / modelInfo.contextWindow;

  const result = {
    scope: args.dirs || args.files || "entire repo",
    totalBytes: bytes,
    totalMB: +(bytes / 1024 / 1024).toFixed(1),
    estimatedTokens: estTokens,
    estimatedTokensK: +(estTokens / 1000).toFixed(0),
    model,
    modelTier: modelInfo.tier,
    ramGB: modelInfo.ramGB,
    contextWindow: modelInfo.contextWindow,
    contextUsagePercent: Math.round(usage * 100),
    recommendedNumCtx: Math.min(
      modelInfo.contextWindow,
      Math.max(DEFAULT_NUM_CTX, Math.ceil((estTokens * 1.5) / 4096) * 4096),
    ),
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("## Context Estimate\n");
  console.log(`- **Scope:** ${result.scope}`);
  console.log(`- **Size:** ${result.totalMB} MB`);
  console.log(`- **Estimated tokens:** ~${result.estimatedTokensK}K`);
  console.log(`- **Model:** ${result.model} (${result.modelTier}, ~${result.ramGB} GB RAM)`);
  console.log(`- **Context window:** ${result.contextWindow / 1000}K`);
  console.log(`- **Usage:** ~${result.contextUsagePercent}%`);
  console.log(`- **Recommended --num-ctx:** ${result.recommendedNumCtx}`);
}

// ── Arg parsing ──

function parseArgs(argv) {
  const args = {
    json: false,
    base: null,
    scope: "auto",
    model: null,
    dirs: null,
    files: null,
    numCtx: null,
    think: null,
    rest: [],
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--json":
        args.json = true;
        break;
      case "--base":
        args.base = argv[++i];
        break;
      case "--scope":
        args.scope = argv[++i];
        break;
      case "--model":
      case "-m":
        args.model = argv[++i];
        break;
      case "--files":
        args.files = argv[++i];
        break;
      case "--dirs":
      case "--include-directories":
        args.dirs = argv[++i];
        break;
      case "--num-ctx":
        args.numCtx = parseInt(argv[++i], 10);
        break;
      case "--think":
        args.think = true;
        break;
      case "--nothink":
      case "--no-think":
        args.think = false;
        break;
      default:
        args.rest.push(arg);
    }
    i++;
  }

  // Model aliases
  if (args.model === "fast" || args.model === "e2b") args.model = "gemma4:e2b";
  if (args.model === "edge" || args.model === "e4b") args.model = "gemma4:e4b";
  if (args.model === "moe" || args.model === "26b") args.model = "gemma4:26b";
  if (args.model === "dense" || args.model === "31b") args.model = "gemma4:31b";

  return args;
}

// ── Main ──

const subcommand = process.argv[2];
const args = parseArgs(process.argv.slice(3));

async function main() {
  switch (subcommand) {
    case "setup":
      await cmdSetup(args);
      break;
    case "task":
      await cmdTask(args);
      break;
    case "review":
      await cmdReview(args);
      break;
    case "adversarial-review":
      await cmdAdversarialReview(args);
      break;
    case "estimate":
      cmdEstimate(args);
      break;
    default:
      console.log(`gemma-companion: unknown subcommand "${subcommand}"`);
      console.log(
        "Usage: gemma-companion <setup|task|review|adversarial-review|estimate> [options]",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
