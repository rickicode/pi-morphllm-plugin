import {
	EXISTING_CODE_MARKER,
	MORPH_ROUTING_HINT_HEADER,
	READONLY_AGENTS,
} from "./config.js";

const PLAUSIBLE_PATH_RE = /[/\\]|\.[\w]+$/;
const CHARS_PER_TOKEN = 3;

export function normalizeCodeEditInput(codeEdit) {
	const trimmed = codeEdit.trim();
	const lines = trimmed.split("\n");

	if (lines.length < 3) return codeEdit;

	const firstLine = lines[0];
	const lastLine = lines[lines.length - 1];

	if (/^```[\w-]*$/.test(firstLine) && /^```$/.test(lastLine)) {
		return lines.slice(1, -1).join("\n");
	}

	return codeEdit;
}

export function serializePart(part) {
	if (typeof part === "string") return part;
	if (!part || typeof part !== "object") return "";
	if (typeof part.content === "string") return part.content;
	if (typeof part.text === "string") return part.text;
	return JSON.stringify(part);
}

export function estimateCharsFromMessages(messages) {
	return messages.reduce((total, message) => {
		const content = Array.isArray(message.content)
			? message.content.map(serializePart).join("\n")
			: serializePart(message.content);
		return total + content.length;
	}, 0);
}

export function compactThresholdToChars(config, contextWindowTokens) {
	if (config.compactTokenLimit)
		return config.compactTokenLimit * CHARS_PER_TOKEN;
	return Math.round(
		contextWindowTokens * config.compactContextThreshold * CHARS_PER_TOKEN,
	);
}

export function formatWarpGrepResult(result) {
	if (!result.success) {
		return `Search failed: ${result.error || "search returned no error details."}`;
	}

	if (!result.contexts || result.contexts.length === 0) {
		return "No relevant code found. Try rephrasing your search term.";
	}

	const valid = result.contexts.filter(
		(ctx) =>
			Boolean(ctx.file) &&
			PLAUSIBLE_PATH_RE.test(ctx.file) &&
			ctx.content.length > 0,
	);
	if (valid.length === 0) {
		return "Search returned malformed file contexts. Fallback to native grep/read tools.";
	}

	const parts = ["Relevant context found:"];
	for (const ctx of valid) {
		const rangeStr =
			!ctx.lines || ctx.lines === "*"
				? "*"
				: ctx.lines.map(([start, end]) => `${start}-${end}`).join(",");
		parts.push(`- ${ctx.file}:${rangeStr}`);
	}

	parts.push("\nFile contents:\n");
	for (const ctx of valid) {
		const rangeStr =
			!ctx.lines || ctx.lines === "*"
				? ""
				: ` lines="${ctx.lines.map(([start, end]) => `${start}-${end}`).join(",")}"`;
		parts.push(`<file path="${ctx.file}"${rangeStr}>`);
		parts.push(ctx.content);
		parts.push("</file>\n");
	}

	return parts.join("\n");
}

function buildFallbackLine(enabled, message) {
	return enabled ? `- ${message}` : null;
}

export function buildMorphSystemRoutingHint(config) {
	const fallbackEnabled = config.routing?.fallbackToNativeTools !== false;
	const editMode = config.routing?.editMode || "strong";
	const codebaseSearchMode = config.routing?.codebaseSearchMode || "prefer";
	const githubSearchMode = config.routing?.githubSearchMode || "prefer";

	if (!config.apiKey) {
		return [
			MORPH_ROUTING_HINT_HEADER,
			"- Morph remote tools are unavailable because MORPH_API_KEY is not configured.",
			"- Use native Pi tools until Morph credentials are configured.",
			buildFallbackLine(
				fallbackEnabled,
				"If morph_fastapply is unavailable, fall back to native edit for exact replacements or write for new files.",
			),
			buildFallbackLine(
				fallbackEnabled,
				"If warpgrep_codebase_search is unavailable, fall back to bash with rg and then read matching files.",
			),
			buildFallbackLine(
				fallbackEnabled,
				"If warpgrep_github_search is unavailable, fall back to GitHub search/file tools or web search.",
			),
		]
			.filter(Boolean)
			.join("\n");
	}

	const lines = [MORPH_ROUTING_HINT_HEADER];
	lines.push(
		"- Use native edit for small exact replacements and native write for brand new files.",
	);
	lines.push(
		"- Use morph_fastapply for large files, multi-location edits, or whitespace-sensitive merges.",
	);
	lines.push(
		"- If the model chooses a workable native tool anyway, allow it and continue instead of blocking.",
	);
	if (config.fastApplyEnabled) {
		if (editMode === "force") {
			lines.push(
				"- Force the strongest morph_fastapply-first guidance for suitable existing-file edits, but keep native edit and write available.",
			);
		} else if (editMode === "strong") {
			lines.push(
				"- Strongly prefer morph_fastapply for existing-file edits that are large, scattered, or whitespace-sensitive.",
			);
		} else {
			lines.push(
				"- Prefer morph_fastapply when an existing-file edit is large, scattered, or whitespace-sensitive.",
			);
		}
		if (fallbackEnabled) {
			lines.push(
				"- If morph_fastapply fails, fall back to native edit for small exact replacements or write for brand new files.",
			);
		}
		if (!config.allowReadonlyAgents) {
			lines.push(
				`- morph_fastapply is blocked in readonly agents: ${READONLY_AGENTS.join(", ")}.`,
			);
		}
	}
	if (config.warpgrepEnabled) {
		lines.push(
			codebaseSearchMode === "force"
				? "- Force the strongest warpgrep_codebase_search guidance for exploratory local codebase questions, but keep native search tools available."
				: codebaseSearchMode === "strong"
					? "- Strongly prefer warpgrep_codebase_search for exploratory local codebase questions."
					: "- Prefer warpgrep_codebase_search for exploratory local codebase questions.",
		);
		if (fallbackEnabled) {
			lines.push(
				"- If warpgrep_codebase_search fails, fall back to bash with rg and then read matching files.",
			);
		}
	}
	if (config.warpgrepGithubEnabled) {
		lines.push(
			githubSearchMode === "force"
				? "- Force the strongest warpgrep_github_search guidance for public GitHub source questions, but keep native search tools available."
				: githubSearchMode === "strong"
					? "- Strongly prefer warpgrep_github_search for public GitHub source questions."
					: "- Prefer warpgrep_github_search for public GitHub source questions.",
		);
		if (fallbackEnabled) {
			lines.push(
				"- If warpgrep_github_search fails, fall back to GitHub search/file tools or web search.",
			);
		}
	}
	return lines.join("\n");
}

export function buildToolRuntimeNotes(toolName, config) {
	switch (toolName) {
		case "morph_fastapply": {
			const notes = [
				"Relative paths resolve from the active Pi cwd.",
				"Best for large files, multi-location edits, or whitespace-sensitive merges.",
				"Use native edit for small exact replacements and native write for new files.",
			];
			const editMode = config.routing?.editMode || "strong";
			if (editMode === "force") {
				notes.push(
					"Routing mode applies the strongest morph_fastapply-first guidance for suitable existing-file edits, but native edit and write remain available.",
				);
			} else if (editMode === "strong") {
				notes.push(
					"Routing mode strongly prefers morph_fastapply for suitable existing-file edits.",
				);
			}
			if (config.routing?.fallbackToNativeTools !== false) {
				notes.push(
					"If morph_fastapply fails, fall back to native edit for exact replacements or write for new files.",
				);
			}
			if (!config.allowReadonlyAgents) {
				notes.push(
					`Blocked in readonly agents: ${READONLY_AGENTS.join(", ")}.`,
				);
			}
			if (!config.apiKey) {
				notes.push("Currently unavailable until MORPH_API_KEY is configured.");
			}
			return notes;
		}
		case "warpgrep_codebase_search": {
			const notes = [];
			if (config.apiKey) {
				notes.push("Searches the current Pi project worktree.");
			} else {
				notes.push("Currently unavailable until MORPH_API_KEY is configured.");
			}
			if (config.routing?.codebaseSearchMode === "force") {
				notes.push(
					"Routing mode applies the strongest warpgrep_codebase_search guidance for exploratory local codebase questions, but native search tools remain available.",
				);
			} else if (config.routing?.codebaseSearchMode === "strong") {
				notes.push(
					"Routing mode strongly prefers warpgrep_codebase_search for exploratory local codebase questions.",
				);
			}
			if (config.routing?.fallbackToNativeTools !== false) {
				notes.push(
					config.apiKey
						? "If warpgrep_codebase_search fails, fall back to bash with rg and then read matching files."
						: "Fallback: use bash with rg and then read matching files.",
				);
			}
			return notes;
		}
		case "warpgrep_github_search": {
			const notes = [];
			if (config.apiKey) {
				notes.push(
					"Use this for public GitHub source questions, not the local workspace.",
				);
			} else {
				notes.push("Currently unavailable until MORPH_API_KEY is configured.");
			}
			if (config.routing?.githubSearchMode === "force") {
				notes.push(
					"Routing mode applies the strongest warpgrep_github_search guidance for public GitHub source questions, but native search tools remain available.",
				);
			} else if (config.routing?.githubSearchMode === "strong") {
				notes.push(
					"Routing mode strongly prefers warpgrep_github_search for public GitHub source questions.",
				);
			}
			if (config.routing?.fallbackToNativeTools !== false) {
				notes.push(
					config.apiKey
						? "If warpgrep_github_search fails, fall back to GitHub search/file tools or web search."
						: "Fallback: use GitHub search/file tools or web search.",
				);
			}
			return notes;
		}
		default:
			return [];
	}
}

export function appendRuntimeNotes(description, notes) {
	if (!notes.length) return description;
	return `${description}\n\nRuntime notes:\n${notes.map((note) => `- ${note}`).join("\n")}`;
}

export { CHARS_PER_TOKEN, EXISTING_CODE_MARKER, READONLY_AGENTS };
