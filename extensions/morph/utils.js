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

export function buildMorphSystemRoutingHint(config) {
	if (!config.apiKey) {
		return [
			MORPH_ROUTING_HINT_HEADER,
			"- Morph remote tools are unavailable because MORPH_API_KEY is not configured.",
			"- Use native Pi tools until Morph credentials are configured.",
		].join("\n");
	}

	const lines = [MORPH_ROUTING_HINT_HEADER];
	if (config.fastApplyEnabled) {
		lines.push(
			"- Prefer morph_edit for large or scattered edits inside existing files.",
		);
		lines.push(
			"- Use native edit for small exact replacements and write for brand new files.",
		);
		if (!config.allowReadonlyAgents) {
			lines.push(
				`- morph_edit is blocked in readonly agents: ${READONLY_AGENTS.join(", ")}.`,
			);
		}
	}
	if (config.warpgrepEnabled) {
		lines.push(
			"- Use warpgrep_codebase_search for exploratory local codebase questions.",
		);
	}
	if (config.warpgrepGithubEnabled) {
		lines.push(
			"- Use warpgrep_github_search for public GitHub source questions.",
		);
	}
	return lines.join("\n");
}

export function buildToolRuntimeNotes(toolName, config) {
	switch (toolName) {
		case "morph_edit": {
			const notes = ["Relative paths resolve from the active Pi cwd."];
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
		case "warpgrep_codebase_search":
			return config.apiKey
				? ["Searches the current Pi project worktree."]
				: ["Currently unavailable until MORPH_API_KEY is configured."];
		case "warpgrep_github_search":
			return config.apiKey
				? [
						"Use this for public GitHub source questions, not the local workspace.",
					]
				: ["Currently unavailable until MORPH_API_KEY is configured."];
		default:
			return [];
	}
}

export function appendRuntimeNotes(description, notes) {
	if (!notes.length) return description;
	return `${description}\n\nRuntime notes:\n${notes.map((note) => `- ${note}`).join("\n")}`;
}

export { CHARS_PER_TOKEN, EXISTING_CODE_MARKER, READONLY_AGENTS };
