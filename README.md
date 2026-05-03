# pi-morphllm-plugin

<p align="center">
  <img src="./images/morph-plugin-icon.svg" alt="Pi Morph plugin icon" width="160" height="160" />
</p>

Pi runtime extension package that integrates Morph into Pi as real tools, commands, hooks, and compaction behavior, with file-based configuration for consistent setup.

This package is not just a prompt snippet or a thin skill wrapper. It installs as a normal Pi package and runs an active extension that registers Morph tools, lifecycle hooks, status commands, and Morph-first routing guidance.

## What This Plugin Does

`pi-morphllm-plugin` makes Morph a practical part of everyday Pi coding sessions.

Use it when you want Pi to:

- apply larger or multi-location edits through `morph_fastapply`
- search the current workspace with natural language through `warpgrep_codebase_search`
- inspect public GitHub repositories through `warpgrep_github_search`
- compact long conversations with Morph before falling back to Pi
- keep Morph configuration in one JSON file instead of scattered runtime environment variables

In short, this plugin turns Morph into a real Pi runtime integration instead of a manual workflow.

## When To Use It

This plugin is a good fit if you use Pi regularly and want Morph to be part of your default workflow, especially for:

- refactoring or editing larger files safely
- searching unfamiliar codebases with natural language
- inspecting public GitHub repositories without cloning them locally
- reducing long session context with Morph compaction
- standardizing Morph setup across projects with file-based config

If you only need a one-off note about Morph or a manual prompt pattern, this package is probably more than you need.

## Features

- `morph_fastapply` for Fast Apply style file merging with dry-run preview
- `warpgrep_codebase_search` for local exploratory code search
- `warpgrep_github_search` for public GitHub source lookup
- Morph compaction integration for large conversations
- File-based `baseUrl` / `baseApi` endpoint configuration
- Single-key and multiple-key Morph API configuration
- Prompt-level Morph-first routing guidance without blocking native Pi tools

## Install

### From npm

```bash
pi install npm:pi-morphllm-plugin
```

This is the main installation path and does not require cloning the repository.

### For the current run only

```bash
pi -e npm:pi-morphllm-plugin
```

This loads the package temporarily for the current Pi run without adding it to your installed package list.

### For local development

```bash
pi -e .
```

This loads the package manifest from `package.json`, so Pi discovers both the Morph extension and the bundled prompt resource.

### Extension-only development shortcut

```bash
pi -e ./extensions/morph/index.js
```

Use the extension entrypoint directly only when you intentionally want to test the extension file by itself. That path does not load the package prompt resource from `prompts/morph-tools.md`.

## Editing Policy

Pi Morph uses guidance, not runtime blocking.

- Small exact replacements should use native `edit`.
- Brand new files should use native `write`.
- Large files, multi-location edits, and whitespace-sensitive merges should use `morph_fastapply`.
- If the model chooses a workable native tool anyway, the extension allows it and continues instead of blocking.

## Config

Pi Morph uses JSON config files only.

Config lookup order:

- `~/.pi/agent/morph.json` as the default global Pi config
- `.pi/morph.json` in the current project
- `morph.config.json` in the current project

The recommended setup is global config in `~/.pi/agent/morph.json`.
Pi Morph auto-creates that file on first runtime load when no existing Morph config is found. Installing the package alone does not create it; the extension must actually be loaded by Pi.

A repo example is available at `.pi/morph.json.example`.
You can also create the global config manually:

```bash
mkdir -p ~/.pi/agent
cp .pi/morph.json.example ~/.pi/agent/morph.json
```

### Single API key

Example config:

```json
{
  "apiKey": "sk-...",
  "editEnabled": true,
  "warpgrepEnabled": true,
  "warpgrepGithubEnabled": true,
  "autoCompactEnabled": true,
  "routing": {
    "editMode": "force",
    "codebaseSearchMode": "force",
    "githubSearchMode": "force",
    "fallbackToNativeTools": true
  },
  "compactContextThreshold": 0.7,
  "compactPreserveRecent": 1,
  "compactRatio": 0.3,
  "timeoutMs": 30000,
  "warpGrepTimeoutMs": 60000,
  "compactTimeoutMs": 60000
}
```

### Multiple API keys

Pi Morph also supports rotation across multiple Morph API keys.
Set `apiKey` to `"multiple"`, point `apiKeyFile` at a text file, and choose an `apiKeyStrategy`.
Only add `baseUrl` when you want to use a custom Morph-compatible endpoint.

```json
{
  "apiKey": "multiple",
  "apiKeyFile": "~/.pi/agent/morph.env",
  "apiKeyStrategy": "round-robin"
}
```

Example `morph.env`:

```txt
sk-key-1
sk-key-2
sk-key-3
```

Supported strategies:

- `round-robin` - rotate sequentially between configured keys
- `random` - choose a random configured key for each client call

The key file parser also ignores blank lines and `#` comments.
If a line contains pipe-delimited metadata like `name|label|sk-key`, Pi Morph uses the third field as the API key.

All runtime settings come from JSON config files only.

Routing config lives inside `morph.json`:

- `routing.editMode` - `prefer`, `strong`, or `force` for prompt-level Morph-first edit guidance; default is `force`
- `routing.codebaseSearchMode` - `prefer`, `strong`, or `force` for prompt-level local WarpGrep guidance; default is `force`
- `routing.githubSearchMode` - `prefer`, `strong`, or `force` for prompt-level public GitHub WarpGrep guidance; default is `force`
- `routing.fallbackToNativeTools` - when `true`, Morph tool failures explicitly fall back to native Pi tools

Invalid routing mode strings automatically fall back to safe defaults:

- `routing.editMode` -> `force`
- `routing.codebaseSearchMode` -> `force`
- `routing.githubSearchMode` -> `force`

## Commands

- `/morph_status` shows the loaded config path, API key status, live API probe result, SDK status, base URL, feature flags, routing mode state, and whether Morph-first guidance is active.
- `/morph_settings` opens a simple interactive menu for updating routing settings in `morph.json`.
- `/morph_selftest` runs end-to-end checks for the API probe, FastApply, local WarpGrep, GitHub WarpGrep, and compact using temporary files and sample queries.
- `/morph-compact` is explicit and Morph-only: the manual command requires Morph compaction and reports a clear warning when compaction cannot run.
- Automatic compaction is Morph-first when `autoCompactEnabled` is enabled, then falls back to Pi if Morph cannot produce a result.
- When `autoCompactEnabled` is `false`, automatic compaction skips Morph entirely and leaves compaction to Pi.

Example `/morph_status` fields:

- `Morph plugin version: 0.1.7`
- `Morph config: ~/.pi/agent/morph.json`
- `Morph API key: configured`
- `Morph API key source: single key`, `3 keys (round-robin)`, or `key file: ~/.pi/agent/morph.env` depending on your configuration
- `Morph API live test: ok`, `failed (authentication error: ...)`, `failed (request timeout: ...)`, `failed (network/base URL error: ...)`, or `skipped (...)`
- `Morph FastApply enabled: true`
- `Auto compaction policy: Morph first, Pi fallback`
- `Manual /morph-compact policy: Morph required`
- `Routing edit mode: force`
- `Routing codebase search mode: force`
- `Routing GitHub search mode: force`
- `Morph FastApply-first guidance active: true`
- `Morph-first local search guidance active: true`
- `Morph-first GitHub search guidance active: true`
- `Fallback to native tools: true`
- `Manual /morph-compact` will report a warning if there are no older messages available to compact.

`/morph_status` is the main summary view. Use `/morph_settings` when you want to change config interactively instead of editing JSON by hand. Reload the extension or session after credential or key-file changes so Morph clients are rebuilt with the new config. The footer also shows `MorphLLM` plus the loaded API key count, including the active strategy when multiple keys are configured.

## Tools

- `morph_fastapply` handles large or scattered edits in existing files using `// ... existing code ...` markers and supports `dry_run` previews.
- `warpgrep_codebase_search` answers exploratory questions about the current workspace.
- `warpgrep_github_search` searches public GitHub repositories without cloning them locally.
- Tool preference strength and fallback behavior are controlled by `routing` in `morph.json`.
- In `force` mode, the extension applies the strongest Morph-first guidance in prompts and tool descriptions, but native tools remain available.
- In `strong` mode, the extension strongly prefers Morph tools for suitable cases.
- In `prefer` mode, the extension gives a softer recommendation without changing tool availability.

Example `morph_fastapply` diff preview:

![Morph FastApply preview](https://raw.githubusercontent.com/rickicode/pi-morphllm-plugin/main/images/fastapply.png)

Example `morph_fastapply` preview call:

```json
{
  "target_filepath": "src/utils/math.ts",
  "instructions": "I am adding input validation to the add function.",
  "code_edit": "function add(a: number, b: number): number {\n  if (typeof a !== 'number' || typeof b !== 'number') {\n    throw new TypeError('Both arguments must be numbers.');\n  }\n  // ... existing code ...\n}",
  "dry_run": true
}
```

Use `dry_run: true` first when you want to inspect the diff preview without writing the file. Then rerun the same tool call with `dry_run: false` or omit it to apply the edit.

## Hooks And Compaction

This package uses Pi extension hooks rather than command aliases alone.

- `session_start` and `session_shutdown` manage Morph runtime status in the UI.
- `before_agent_start` injects Morph routing hints into the system prompt based on `routing` config.
- `tool_call` normalizes tool input before execution.
- `tool_result` adds Morph metadata such as provider and base URL.
- `model_select` tracks the active model context window.
- `session_before_compact` runs Morph compaction before Pi falls back to its normal compactor, so automatic compaction stays Morph-first while preserving Pi as the safety net whenever `autoCompactEnabled` is on.
- When `autoCompactEnabled` is off, `session_before_compact` skips Morph and leaves automatic compaction to Pi.
- `/morph-compact` uses the same hook-based path and always requires Morph compaction instead of silently falling back to Pi.

## Development

Clone the repository only if you want to work on the package itself.

Copy `.pi/morph.json.example` to `.pi/morph.json` or create `~/.pi/agent/morph.json`, fill in `apiKey`, then run:

```bash
pi -e .
```

Useful development modes:

- `pi -e .` loads the full package manifest, extension, and bundled prompt resource.
- `pi -e ./extensions/morph/index.js` loads only the extension entrypoint.
- `npm test` runs the package tests.

## Notes

- Default Morph endpoint is `https://api.morphllm.com`.
- Set `baseUrl` or `baseApi` in JSON when you want a custom endpoint.
- The package manifest in `package.json` allows Pi to auto-discover the extension and prompt resource.
- Automatic config creation happens on first runtime load, not during `pi install`.
- Automatic config creation only targets the global `~/.pi/agent/morph.json` path, never a project-local file by default.

## Testing

Run:

```bash
npm test
```
