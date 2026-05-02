# pi-morph-plugin

Morph extension/package for Pi Coding Agent with support for custom Morph base URL or custom Morph API endpoint.

## Features

- `morph_edit` for Fast Apply style file merging
- `warpgrep_codebase_search` for local exploratory code search
- `warpgrep_github_search` for public GitHub source lookup
- Morph compaction integration for large conversations
- `MORPH_BASE_URL` / `MORPH_BASE_API` override support

## Install

### Try the full package for the current run

```bash
pi -e .
```

This loads the package manifest from `package.json`, so Pi discovers both the Morph extension and the bundled prompt resource.

### Install as a Pi package

```bash
pi install /absolute/path/to/pi-morph-plugin
```

### Extension-only development shortcut

```bash
pi -e ./extensions/morph/index.js
```

Use the extension entrypoint directly only when you intentionally want to test the extension file by itself. That path does not load the package prompt resource from `prompts/morph-tools.md`.

## JSON configuration

The easiest setup is a JSON file.

Pi Morph looks for config in this order:

- `MORPH_CONFIG` if you want to point at a custom JSON file
- `.pi/morph.json` in the current project
- `morph.config.json` in the current project
- `~/.pi/agent/morph.json` for a global fallback

A repo example is available at `.pi/morph.json.example`.

Example `.pi/morph.json`:

```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://my-morph-proxy.example.com",
  "editEnabled": true,
  "warpgrepEnabled": true,
  "warpgrepGithubEnabled": true,
  "compactEnabled": true,
  "compactContextThreshold": 0.7,
  "compactPreserveRecent": 1,
  "compactRatio": 0.3,
  "timeoutMs": 30000,
  "warpGrepTimeoutMs": 60000,
  "compactTimeoutMs": 60000
}
```

JSON values take precedence over environment variables.

## Environment variable fallback

If you still want env-based setup, these keys are supported:

- `MORPH_API_KEY` - Morph API key
- `MORPH_BASE_URL` - optional custom Morph API base URL
- `MORPH_BASE_API` - optional alias for custom Morph API base URL
- `MORPH_EDIT` - set `false` to disable `morph_edit`
- `MORPH_WARPGREP` - set `false` to disable local WarpGrep
- `MORPH_WARPGREP_GITHUB` - set `false` to disable GitHub WarpGrep
- `MORPH_COMPACT` - set `false` to disable Morph compaction
- `MORPH_ALLOW_READONLY_AGENTS` - set `true` to allow `morph_edit` in readonly agents
- `MORPH_COMPACT_TOKEN_LIMIT` - optional fixed compaction trigger in tokens
- `MORPH_COMPACT_CONTEXT_THRESHOLD` - optional fraction of context window to trigger compaction
- `MORPH_COMPACT_PRESERVE_RECENT` - recent messages to keep uncompacted
- `MORPH_COMPACT_RATIO` - target compression ratio
- `MORPH_TIMEOUT` - optional Fast Apply timeout in ms
- `MORPH_WARPGREP_TIMEOUT` - optional WarpGrep timeout in ms
- `MORPH_COMPACT_TIMEOUT` - optional compaction timeout in ms

## Example

Copy `.pi/morph.json.example` to `.pi/morph.json`, fill in `apiKey`, then run:

```bash
pi -e .
```

## Notes

- Default Morph endpoint is `https://api.morphllm.com`.
- `MORPH_BASE_URL` takes precedence over the default endpoint.
- `MORPH_BASE_API` is supported as a compatibility alias.
- The package manifest in `package.json` allows Pi to auto-discover the extension and prompt resource.
- Use `/morph_status` inside Pi to confirm the loaded config.
- Use `/morph-compact` to trigger session compaction manually with Morph compaction integration enabled.

## Testing

Run:

```bash
npm test
```
