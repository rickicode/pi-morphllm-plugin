# Morph Tools

This package adds Morph-powered tools to Pi for editing, search, and compaction workflows.

- `morph_fastapply` is for existing-file edits that are large, multi-location, or whitespace-sensitive.
- `warpgrep_codebase_search` is for natural-language exploration of the current workspace.
- `warpgrep_github_search` is for natural-language exploration of public GitHub repositories.
- When using `morph_fastapply`, wrap unchanged code with `// ... existing code ...` markers.
- If Morph is unavailable or a Morph request fails, fall back to native Pi tools.
