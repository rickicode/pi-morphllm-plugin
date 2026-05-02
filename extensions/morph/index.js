import { readFile as readFileFs, writeFile } from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import {
	DEFAULT_MORPH_BASE_URL,
	EXISTING_CODE_MARKER,
	getMorphConfig,
	READONLY_AGENTS,
} from "./config.js";
import {
	fetchGitHubRepoSuggestions,
	formatPublicRepoResolutionFailure,
	lookupGitHubRepository,
	resolvePublicRepoLocator,
} from "./github.js";
import {
	appendRuntimeNotes,
	buildMorphSystemRoutingHint,
	buildToolRuntimeNotes,
	compactThresholdToChars,
	estimateCharsFromMessages,
	formatWarpGrepResult,
	normalizeCodeEditInput,
} from "./utils.js";

const PLUGIN_VERSION = "0.1.0";

async function createClients(config) {
	if (!config.apiKey) {
		return { morph: null, warpGrep: null, compact: null, loadError: null };
	}

	try {
		const { CompactClient, MorphClient, WarpGrepClient } = await import(
			"@morphllm/morphsdk"
		);

		return {
			morph: new MorphClient({
				apiKey: config.apiKey,
				timeout: config.timeoutMs,
			}),
			warpGrep: new WarpGrepClient({
				morphApiKey: config.apiKey,
				morphApiUrl: config.baseUrl,
				timeout: config.warpGrepTimeoutMs,
			}),
			compact: new CompactClient({
				morphApiKey: config.apiKey,
				morphApiUrl: config.baseUrl,
				timeout: config.compactTimeoutMs,
			}),
			loadError: null,
		};
	} catch (error) {
		return {
			morph: null,
			warpGrep: null,
			compact: null,
			loadError: error instanceof Error ? error.message : String(error),
		};
	}
}

function renderMorphCall(label, args, theme) {
	const path =
		args?.target_filepath || args?.owner_repo || args?.github_url || "...";
	return new Text(
		`${theme.fg("toolTitle", theme.bold(`${label} `))}${theme.fg("accent", path)}`,
		0,
		0,
	);
}

function summarizeResultText(result) {
	return result.content
		?.filter((item) => item.type === "text")
		.map((item) => item.text || "")
		.join("\n")
		.trim();
}

function formatResultHeadline(result, options) {
	const details = result.details || {};
	if (details.created && details.path) {
		return `created ${details.path}`;
	}
	if (details.path && Number.isFinite(details.linesAdded)) {
		return `${details.path} +${details.linesAdded}/-${details.linesRemoved || 0}`;
	}
	if (details.repository) {
		return `${details.repository}`;
	}
	if (options.isError) {
		return "request failed";
	}
	return "completed";
}

function renderMorphResult(result, options, theme) {
	if (options.isPartial) {
		return new Text(theme.fg("warning", "Morph working..."), 0, 0);
	}

	const summary = summarizeResultText(result);
	const headline = formatResultHeadline(result, options);
	const tone = options.isError ? "error" : "success";
	const preview = summary
		? summary
				.split("\n")
				.slice(0, options.expanded ? 8 : 3)
				.join("\n")
		: "Morph completed";
	const body = [
		theme.fg(tone, headline),
		theme.fg(options.isError ? "muted" : "text", preview),
	].join("\n");
	return new Text(body, 0, 0);
}

function textResult(text, details = {}) {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

function errorResult(text, details = {}) {
	return {
		content: [{ type: "text", text }],
		details,
		isError: true,
	};
}

async function readFile(fsPath) {
	return await readFileFs(fsPath, "utf8");
}

function resolvePath(ctx, targetPath) {
	return path.isAbsolute(targetPath)
		? targetPath
		: path.resolve(ctx.cwd, targetPath);
}

function getAgentName(ctx) {
	return ctx.sessionManager?.getSessionName?.() || "";
}

function isReadonlyAgent(ctx, config) {
	if (config.allowReadonlyAgents) return false;
	return READONLY_AGENTS.includes(getAgentName(ctx));
}

function serializeMessageContent(content) {
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (!part || typeof part !== "object") return "";
				if (typeof part.text === "string") return part.text;
				if (typeof part.content === "string") return part.content;
				if (part.type === "tool") {
					const toolName = part.toolName || part.name || "tool";
					const input = part.input ? JSON.stringify(part.input) : "";
					const output =
						typeof part.output === "string"
							? part.output
							: part.output
								? JSON.stringify(part.output)
								: "";
					return `[Tool: ${toolName}] ${input}\nOutput: ${output}`.trim();
				}
				return JSON.stringify(part);
			})
			.filter(Boolean)
			.join("\n");
	}

	if (typeof content === "string") return content;
	if (!content || typeof content !== "object") return "";
	if (typeof content.text === "string") return content.text;
	if (typeof content.content === "string") return content.content;
	return JSON.stringify(content);
}

function buildClientUnavailableError(clients) {
	if (clients.loadError) {
		return `Morph SDK unavailable: ${clients.loadError}`;
	}
	return "MORPH_API_KEY not configured.";
}

function buildMorphEditTool(config, clients) {
	const description = appendRuntimeNotes(
		`Edit existing files using partial code snippets with "${EXISTING_CODE_MARKER}" markers. Morph merges your changes into the full file.`,
		buildToolRuntimeNotes("morph_edit", config),
	);

	return {
		name: "morph_edit",
		label: "Morph Edit",
		description,
		promptSnippet:
			"Fast apply for large or scattered edits using lazy existing-code markers.",
		promptGuidelines: [
			"Use morph_edit for large files, multiple scattered edits, or whitespace-sensitive merges.",
			"Use morph_edit with // ... existing code ... markers around unchanged regions.",
		],
		parameters: Type.Object({
			target_filepath: Type.String({
				description: "Path of the file to modify",
			}),
			instructions: Type.String({
				description:
					"Brief first-person description of what is changing. Used to disambiguate uncertainty in the edit.",
			}),
			code_edit: Type.String({
				description:
					'Code changes wrapped with "// ... existing code ..." markers for unchanged sections',
			}),
		}),
		renderCall(args, theme) {
			return renderMorphCall("morph_edit", args, theme);
		},
		renderResult(result, options, theme) {
			return renderMorphResult(result, options, theme);
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (isReadonlyAgent(ctx, config)) {
				return errorResult("morph_edit is blocked in readonly agents.");
			}

			if (!config.apiKey || !clients.morph) {
				return errorResult(buildClientUnavailableError(clients));
			}

			const normalizedCodeEdit = normalizeCodeEditInput(params.code_edit);
			const absolutePath = resolvePath(ctx, params.target_filepath);

			return withFileMutationQueue(absolutePath, async () => {
				let originalCode = "";
				let exists = true;

				try {
					originalCode = await readFile(absolutePath);
				} catch {
					exists = false;
				}

				if (!exists) {
					if (!normalizedCodeEdit.includes(EXISTING_CODE_MARKER)) {
						await writeFile(absolutePath, normalizedCodeEdit, "utf8");
						return textResult(`Created new file: ${params.target_filepath}`, {
							created: true,
							path: params.target_filepath,
						});
					}
					return errorResult(
						`File not found: ${params.target_filepath}. New files must not use ${EXISTING_CODE_MARKER} markers.`,
					);
				}

				const result = await clients.morph.fastApply.applyEdit(
					{
						originalCode,
						codeEdit: normalizedCodeEdit,
						instruction: params.instructions,
						filepath: params.target_filepath,
					},
					{
						morphApiUrl: config.baseUrl,
						generateUdiff: true,
					},
				);

				if (!result.success || !result.mergedCode) {
					return errorResult(
						`Morph API failed: ${result.error || "unknown error"}`,
					);
				}

				if (
					normalizedCodeEdit.includes(EXISTING_CODE_MARKER) &&
					!originalCode.includes(EXISTING_CODE_MARKER) &&
					result.mergedCode.includes(EXISTING_CODE_MARKER)
				) {
					return errorResult(
						"Morph API produced unsafe output containing placeholder markers.",
					);
				}

				await writeFile(absolutePath, result.mergedCode, "utf8");
				return textResult(
					`Applied edit to ${params.target_filepath}\n\n+${result.changes.linesAdded} -${result.changes.linesRemoved} lines`,
					{
						path: params.target_filepath,
						linesAdded: result.changes.linesAdded,
						linesRemoved: result.changes.linesRemoved,
						udiff: result.udiff,
						provider: "morph",
						baseUrl: config.baseUrl,
					},
				);
			});
		},
	};
}

function buildWarpGrepTool(config, clients) {
	return {
		name: "warpgrep_codebase_search",
		label: "WarpGrep Codebase Search",
		description: appendRuntimeNotes(
			"Fast agentic codebase search for local workspace questions.",
			buildToolRuntimeNotes("warpgrep_codebase_search", config),
		),
		promptSnippet: "Exploratory local codebase search using Morph WarpGrep.",
		promptGuidelines: [
			"Use warpgrep_codebase_search for exploratory questions about how the current codebase works.",
		],
		parameters: Type.Object({
			search_term: Type.String({
				description:
					"Natural language search query describing what to find in the codebase",
			}),
		}),
		renderCall(args, theme) {
			return renderMorphCall("warpgrep_codebase_search", args, theme);
		},
		renderResult(result, options, theme) {
			return renderMorphResult(result, options, theme);
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!config.apiKey || !clients.warpGrep) {
				return errorResult(buildClientUnavailableError(clients));
			}

			try {
				const generator = clients.warpGrep.execute({
					searchTerm: params.search_term,
					repoRoot: ctx.cwd,
					streamSteps: true,
				});

				let result;
				for (;;) {
					const next = await generator.next();
					if (next.done) {
						result = next.value;
						break;
					}
				}

				return textResult(formatWarpGrepResult(result), {
					provider: "morph",
					baseUrl: config.baseUrl,
				});
			} catch (error) {
				return errorResult(`WarpGrep search failed: ${error.message}`);
			}
		},
	};
}

function buildWarpGrepGithubTool(config, clients) {
	return {
		name: "warpgrep_github_search",
		label: "WarpGrep GitHub Search",
		description: appendRuntimeNotes(
			"Grounded code context search for public GitHub repositories without cloning them locally.",
			buildToolRuntimeNotes("warpgrep_github_search", config),
		),
		promptSnippet: "Public GitHub source search using Morph WarpGrep.",
		promptGuidelines: [
			"Use warpgrep_github_search for public GitHub source questions about external libraries or SDKs.",
		],
		parameters: Type.Object({
			search_term: Type.String({
				description:
					"Natural language query to run against the public repository",
			}),
			owner_repo: Type.Optional(
				Type.String({
					description: 'GitHub repository in "owner/repo" format',
				}),
			),
			github_url: Type.Optional(
				Type.String({ description: "Full GitHub repository URL" }),
			),
			branch: Type.Optional(
				Type.String({ description: "Optional branch name" }),
			),
		}),
		renderCall(args, theme) {
			return renderMorphCall("warpgrep_github_search", args, theme);
		},
		renderResult(result, options, theme) {
			return renderMorphResult(result, options, theme);
		},
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!config.apiKey || !clients.warpGrep) {
				return errorResult(buildClientUnavailableError(clients));
			}

			const locator = resolvePublicRepoLocator(params);
			if (locator.error) return errorResult(locator.error);

			const repoLookup = await lookupGitHubRepository(locator.repo);
			if (repoLookup.status === "not_found") {
				const suggestions = await fetchGitHubRepoSuggestions(
					locator.repo,
					params.search_term,
				).catch(() => []);
				return errorResult(
					formatPublicRepoResolutionFailure(
						locator.repo,
						repoLookup.detail,
						suggestions,
					),
				);
			}

			try {
				const result = await clients.warpGrep.searchGitHub({
					searchTerm: params.search_term,
					github: locator.repo,
					branch: params.branch,
				});

				if (!result.success) {
					const suggestions = await fetchGitHubRepoSuggestions(
						locator.repo,
						params.search_term,
					).catch(() => []);
					return errorResult(
						formatPublicRepoResolutionFailure(
							locator.repo,
							result.error,
							suggestions,
						),
					);
				}

				return textResult(
					`Repository: ${locator.repo}\n\n${formatWarpGrepResult(result)}`,
					{
						provider: "morph",
						baseUrl: config.baseUrl,
						repository: locator.repo,
					},
				);
			} catch (error) {
				const suggestions = await fetchGitHubRepoSuggestions(
					locator.repo,
					params.search_term,
				).catch(() => []);
				return errorResult(
					formatPublicRepoResolutionFailure(
						locator.repo,
						error.message,
						suggestions,
					),
				);
			}
		},
	};
}

function trimMessagesForCompaction(messages, preserveRecent) {
	if (messages.length <= preserveRecent) return null;
	return {
		older: messages.slice(0, -preserveRecent),
		recent: messages.slice(-preserveRecent),
	};
}

async function runMorphCompaction(
	event,
	ctx,
	config,
	clients,
	modelContextTokens,
) {
	if (!config.compactEnabled || !config.apiKey || !clients.compact) return;

	const messages = event.branchEntries
		.filter((entry) => entry.type === "message")
		.map((entry) => entry.message);

	const charThreshold = compactThresholdToChars(config, modelContextTokens);
	if (estimateCharsFromMessages(messages) < charThreshold) {
		return;
	}

	const split = trimMessagesForCompaction(
		messages,
		config.compactPreserveRecent,
	);
	if (!split || split.older.length === 0) return;

	const compactInput = split.older
		.map((message) => ({
			role: message.role,
			content: serializeMessageContent(message.content),
		}))
		.filter((message) => message.content.length > 0);

	if (compactInput.length === 0) return;

	try {
		const result = await clients.compact.compact({
			messages: compactInput,
			compressionRatio: config.compactRatio,
			preserveRecent: 0,
		});

		return {
			compaction: {
				summary: result.output,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			},
			stats: {
				messageCount: split.older.length,
				charThreshold,
			},
		};
	} catch (error) {
		if (ctx.hasUI) {
			ctx.ui.notify(`Morph compact failed: ${error.message}`, "warning");
		}
		return;
	}
}

function createMorphCompactHandler() {
	return async (_args, ctx) => {
		ctx.compact({
			onComplete: (result) => {
				if (!ctx.hasUI) return;
				const summary = result.summary || "Compaction finished.";
				ctx.ui.notify(
					`Morph compact complete: ${summary.slice(0, 240)}`,
					"info",
				);
			},
			onError: (error) => {
				if (!ctx.hasUI) return;
				ctx.ui.notify(`Morph compact failed: ${error.message}`, "warning");
			},
		});
		if (ctx.hasUI) {
			ctx.ui.notify("Triggered compaction for the current session.", "info");
		}
	};
}

export default async function morphExtension(pi) {
	const config = getMorphConfig();
	const clients = await createClients(config);
	let modelContextTokens = 200000;
	const morphCompactHandler = createMorphCompactHandler();

	if (config.fastApplyEnabled) {
		pi.registerTool(buildMorphEditTool(config, clients));
	}
	if (config.warpgrepEnabled) {
		pi.registerTool(buildWarpGrepTool(config, clients));
	}
	if (config.warpgrepGithubEnabled) {
		pi.registerTool(buildWarpGrepGithubTool(config, clients));
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("morph", `Morph ${PLUGIN_VERSION} @ ${config.baseUrl}`);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("morph", undefined);
		}
	});

	pi.on("before_agent_start", async (event) => {
		const hint = buildMorphSystemRoutingHint(config);
		if (!hint || event.systemPrompt.includes(hint)) {
			return;
		}
		return {
			systemPrompt: `${event.systemPrompt}\n\n${hint}`,
		};
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName === "morph_edit") {
			event.input.code_edit = normalizeCodeEditInput(
				event.input.code_edit || "",
			);
		}
	});

	pi.on("tool_result", async (event) => {
		if (
			![
				"morph_edit",
				"warpgrep_codebase_search",
				"warpgrep_github_search",
			].includes(event.toolName)
		) {
			return;
		}

		return {
			details: {
				...(event.details || {}),
				provider: "morph",
				baseUrl: config.baseUrl || DEFAULT_MORPH_BASE_URL,
			},
		};
	});

	pi.on("model_select", async (event) => {
		modelContextTokens = event.model?.contextWindow || modelContextTokens;
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const result = await runMorphCompaction(
			event,
			ctx,
			config,
			clients,
			modelContextTokens,
		);
		if (!result) return;
		return {
			compaction: result.compaction,
		};
	});

	pi.registerCommand("morph_status", {
		description: "Show Morph plugin configuration status",
		handler: async (_args, ctx) => {
			const lines = [
				`Morph config: ${config.configPath || "none"}`,
				`Morph API key: ${config.apiKey ? "configured" : "missing"}`,
				`Morph SDK: ${clients.loadError ? `unavailable (${clients.loadError})` : "ready"}`,
				`Morph base URL: ${config.baseUrl}`,
				`Morph edit: ${config.fastApplyEnabled}`,
				`WarpGrep: ${config.warpgrepEnabled}`,
				`WarpGrep GitHub: ${config.warpgrepGithubEnabled}`,
				`Compaction: ${config.compactEnabled}`,
			];
			if (ctx.hasUI) {
				ctx.ui.notify(lines.join(" | "), "info");
			}
		},
	});

	pi.registerCommand("morph-compact", {
		description:
			"Trigger Pi compaction immediately with Morph compaction integration enabled",
		handler: morphCompactHandler,
	});
}
