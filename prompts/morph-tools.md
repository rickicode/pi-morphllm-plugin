# Morph Tool Selection Policy

Use Morph tools when they are the best fit for the task.

- Use `morph_edit` for large files, multiple scattered edits, or whitespace-sensitive merges in existing files.
- Use Pi built-in `edit` for small exact replacements and `write` for brand new files.
- Use `warpgrep_codebase_search` for exploratory questions about the current workspace.
- Use `warpgrep_github_search` for public GitHub source questions about external libraries, SDKs, or frameworks.
- If `MORPH_API_KEY` is missing or a Morph request fails, fall back to native Pi tools.
- When using `morph_edit`, wrap unchanged code with `// ... existing code ...` markers.
