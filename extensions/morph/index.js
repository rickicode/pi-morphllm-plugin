import { readFile as readFileFs, writeFile } from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import {
	DEFAULT_MORPH_BASE_URL,
	EXISTING_CODE_MARKER,
	ensureMorphConfigFile,
	getMorphConfig,
	READONLY_AGENTS,
	saveMorphConfig,
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

function createApiKeySelector(config) {
	const apiKeys = config.apiKeys || [];
	let roundRobinIndex = 0;

	return () => {
		if (apiKeys.length === 0) return null;
		if (apiKeys.length === 1) return apiKeys[0];
		if (config.apiKeyStrategy === "random") {
			const index = Math.floor(Math.random() * apiKeys.length);
			return apiKeys[index];
		}
		const apiKey = apiKeys[roundRobinIndex % apiKeys.length];
		roundRobinIndex += 1;
		return apiKey;
	};
}

function createRotatingMorphClient(ClientClass, buildOptions, selectApiKey) {
	return new Proxy(
		{},
		{
			get(_target, prop) {
				const apiKey = selectApiKey();
				if (!apiKey) return undefined;
				const client = new ClientClass(buildOptions(apiKey));
				const value = client[prop];
				return typeof value === "function" ? value.bind(client) : value;
			},
		},
	);
}

async function createClients(config) {
	if (!config.apiKeys?.length) {
		return { morph: null, warpGrep: null, compact: null, loadError: null };
	}

	try {
		const { CompactClient, MorphClient, WarpGrepClient } = await import(
			"@morphllm/morphsdk"
		);
		const selectApiKey = createApiKeySelector(config);

		return {
			morph: createRotatingMorphClient(
				MorphClient,
				(apiKey) => ({
					apiKey,
					timeout: config.timeoutMs,
				}),
				selectApiKey,
			),
			warpGrep: createRotatingMorphClient(
				WarpGrepClient,
				(apiKey) => ({
					morphApiKey: apiKey,
					morphApiUrl: config.baseUrl,
					timeout: config.warpGrepTimeoutMs,
				}),
				selectApiKey,
			),
			compact: createRotatingMorphClient(
				CompactClient,
				(apiKey) => ({
					morphApiKey: apiKey,
					morphApiUrl: config.baseUrl,
					timeout: config.compactTimeoutMs,
				}),
				selectApiKey,
			),
			loadError: null,
			selectApiKey,
		};
	} catch (error) {
		return {
			morph: null,
			warpGrep: null,
			compact: null,
			loadError: error instanceof Error ? error.message : String(error),
			selectApiKey: () => null,
		};
	}
}

function truncatePreview(text, maxLength = 96) {
	const normalized = String(text || "").replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function renderMorphCall(label, args, theme) {
	const path =
		args?.target_filepath || args?.owner_repo || args?.github_url || "...";
	const instructions = truncatePreview(args?.instructions);
	const lines = [
		`${theme.fg("toolTitle", theme.bold(`${label} `))}${theme.fg("accent", path)}`,
	];
	if (instructions) {
		lines.push(theme.fg("dim", instructions));
	}
	return new Text(lines.join("\n"), 0, 0);
}

function summarizeResultText(result) {
	return result.content
		?.filter((item) => item.type === "text")
		.map((item) => item.text || "")
		.join("\n")
		.trim();
}

function formatUdiffPreview(udiff, theme, expanded) {
	if (!udiff) return "";

	const lines = udiff.split("\n");
	const maxLines = expanded ? 28 : 10;
	const rendered = [];
	let shown = 0;

	for (const line of lines) {
		if (shown >= maxLines) break;
		if (!expanded && (line.startsWith("--- ") || line.startsWith("+++ "))) {
			continue;
		}

		if (line.startsWith("@@")) {
			rendered.push(theme.fg("warning", line));
			shown += 1;
			continue;
		}
		if (line.startsWith("+") && !line.startsWith("+++")) {
			rendered.push(theme.fg("success", `+ ${line.slice(1)}`));
			shown += 1;
			continue;
		}
		if (line.startsWith("-") && !line.startsWith("---")) {
			rendered.push(theme.fg("error", `- ${line.slice(1)}`));
			shown += 1;
			continue;
		}
		if (line.startsWith("--- ") || line.startsWith("+++ ")) {
			rendered.push(theme.fg("accent", line));
			shown += 1;
			continue;
		}
		rendered.push(
			theme.fg("text", `  ${line.startsWith(" ") ? line.slice(1) : line}`),
		);
		shown += 1;
	}

	if (lines.length > shown) {
		rendered.push(theme.fg("dim", `... ${lines.length - shown} more diff lines`));
	}

	return rendered.join("\n");
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

	const details = result.details || {};
	const summary = summarizeResultText(result);
	const headline = formatResultHeadline(result, options);
	const tone = options.isError ? "error" : "success";
	const instruction = truncatePreview(details.instruction || details.instructions);
	const stats =
		Number.isFinite(details.linesAdded) || Number.isFinite(details.linesRemoved)
			? `+${details.linesAdded || 0} -${details.linesRemoved || 0} ~${details.linesModified || 0}${details.dryRun ? " dry run" : " applied"}`
			: details.dryRun
				? "dry run"
				: "";
	const fallbackPreview = summary
		? summary
				.split("\n")
				.slice(0, options.expanded ? 8 : 3)
				.join("\n")
		: "Morph completed";
	const body = [theme.fg(tone, headline)];
	if (instruction) {
		body.push(theme.fg("dim", instruction));
	}
	if (stats) {
		body.push(theme.fg(options.isError ? "muted" : "success", stats));
	}
	if (details.udiff) {
		body.push(formatUdiffPreview(details.udiff, theme, options.expanded));
	} else {
		body.push(theme.fg(options.isError ? "muted" : "text", fallbackPreview));
	}
	return new Text(body.join("\n"), 0, 0);
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

async function pathExists(fsPath) {
	try {
		await readFileFs(fsPath);
		return true;
	} catch {
		return false;
	}
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

function buildClientUnavailableError(clients, fallbackHint) {
	if (clients.loadError) {
		return `Morph SDK unavailable: ${clients.loadError}${fallbackHint ? ` Fallback: ${fallbackHint}` : ""}`;
	}
	return `MORPH_API_KEY not configured.${fallbackHint ? ` Fallback: ${fallbackHint}` : ""}`;
}

function buildMorphFastApplyTool(config, clients) {
	const description = appendRuntimeNotes(
		`Edit existing files using partial code snippets with "${EXISTING_CODE_MARKER}" markers. Morph merges your changes into the full file and supports dry-run previews.`,
		buildToolRuntimeNotes("morph_fastapply", config),
	);

	return {
		name: "morph_fastapply",
		label: "Morph FastApply",
		description,
		promptSnippet:
			"Fast apply for large or scattered edits using lazy existing-code markers.",
		promptGuidelines: [
			"Use morph_fastapply for large files, multiple scattered edits, or whitespace-sensitive merges.",
			"Use morph_fastapply with // ... existing code ... markers around unchanged regions.",
			"Use dry_run when you want a preview of the merge and diff before writing the file.",
			"If morph_fastapply fails or is unavailable, fall back to native edit for exact replacements or write for new files.",
		],
		parameters: Type.Object({
			target_filepath: Type.String({
				description: "Path of the existing file to modify",
			}),
			instructions: Type.String({
				description:
					"Brief first-person description of what is changing. Used to disambiguate uncertainty in the edit.",
			}),
			code_edit: Type.String({
				description:
					'Code changes wrapped with "// ... existing code ..." markers for unchanged sections',
			}),
			dry_run: Type.Optional(
				Type.Boolean({
					description: "Preview the Morph merge without writing the file.",
				}),
			),
		}),
		renderCall(args, theme) {
			return renderMorphCall("morph_fastapply", args, theme);
		},
		renderResult(result, options, theme) {
			return renderMorphResult(result, options, theme);
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (isReadonlyAgent(ctx, config)) {
				return errorResult(
					"morph_fastapply is blocked in readonly agents. Fallback: use native edit for exact replacements or write for new files.",
				);
			}

			if (!config.apiKey || !clients.morph) {
				return errorResult(
					buildClientUnavailableError(
						clients,
						"use native edit for exact replacements or write for new files.",
					),
				);
			}

			const normalizedCodeEdit = normalizeCodeEditInput(params.code_edit);
			const absolutePath = resolvePath(ctx, params.target_filepath);
			const dryRun = Boolean(params.dry_run);

			return withFileMutationQueue(absolutePath, async () => {
				let originalCode = "";
				let exists = true;

				try {
					originalCode = await readFile(absolutePath);
				} catch {
					exists = false;
				}

				if (!exists) {
					return errorResult(
						`File not found: ${params.target_filepath}. Use native write for new files.`,
					);
				}

				const originalLineCount = originalCode.length === 0 ? 0 : originalCode.split("\n").length;
				if (
					originalLineCount > 10 &&
					!normalizedCodeEdit.includes(EXISTING_CODE_MARKER)
				) {
					return errorResult(
						`Missing ${EXISTING_CODE_MARKER} markers for existing ${originalLineCount}-line file: ${params.target_filepath}. Fallback: use native edit for small exact replacements or add marker-wrapped context for morph_fastapply.`,
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
						`Morph API failed: ${result.error || "unknown error"}. Fallback: use native edit for exact replacements or write for new files.`,
					);
				}

				if (
					normalizedCodeEdit.includes(EXISTING_CODE_MARKER) &&
					!originalCode.includes(EXISTING_CODE_MARKER) &&
					result.mergedCode.includes(EXISTING_CODE_MARKER)
				) {
					return errorResult(
						"Morph API produced unsafe output containing placeholder markers. Fallback: use native edit for exact replacements.",
					);
				}

				if (!dryRun) {
					await writeFile(absolutePath, result.mergedCode, "utf8");
				}
				return textResult(
					`${dryRun ? "Previewed" : "Applied"} edit to ${params.target_filepath}\n\n+${result.changes.linesAdded} -${result.changes.linesRemoved} ~${result.changes.linesModified} lines${result.udiff ? `\n\n${result.udiff}` : ""}`,
					{
						path: params.target_filepath,
						instruction: params.instructions,
						dryRun,
						linesAdded: result.changes.linesAdded,
						linesRemoved: result.changes.linesRemoved,
						linesModified: result.changes.linesModified,
						udiff: result.udiff,
						originalCode,
						mergedCode: result.mergedCode,
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
			"If warpgrep_codebase_search fails or is unavailable, fall back to bash with rg and then read matching files.",
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
				return errorResult(
					buildClientUnavailableError(
						clients,
						"use bash with rg and then read matching files.",
					),
				);
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
				return errorResult(
					`WarpGrep search failed: ${error.message}. Fallback: use bash with rg and then read matching files.`,
				);
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
			"If warpgrep_github_search fails or is unavailable, fall back to GitHub search/file tools or web search.",
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
				return errorResult(
					buildClientUnavailableError(
						clients,
						"use GitHub search/file tools or web search.",
					),
				);
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
					`${formatPublicRepoResolutionFailure(
						locator.repo,
						error.message,
						suggestions,
					)}\n\nFallback: use GitHub search/file tools or web search.`,
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
	options = {},
) {
	const force = options.force === true;
	if (!config.compactEnabled || !config.apiKey || !clients.compact) return;

	const messages = event.branchEntries
		.filter((entry) => entry.type === "message")
		.map((entry) => entry.message);

	const charThreshold = compactThresholdToChars(config, modelContextTokens);
	if (!force && estimateCharsFromMessages(messages) < charThreshold) {
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

function shouldForceMorphEdit(config) {
	return config.routing?.editMode === "force";
}

function shouldForceCodebaseSearch(config) {
	return config.routing?.codebaseSearchMode === "force";
}

function shouldForceGithubSearch(config) {
	return config.routing?.githubSearchMode === "force";
}

function createMorphCompactHandler(forceMorphCompactRef, config) {
	return async (_args, ctx) => {
		forceMorphCompactRef.value =
			config.routing?.forceMorphCompactCommand !== false;
		ctx.compact({
			onComplete: (result) => {
				forceMorphCompactRef.value = false;
				if (!ctx.hasUI) return;
				const summary = result.summary || "Compaction finished.";
				ctx.ui.notify(
					`Morph compact complete: ${summary.slice(0, 240)}`,
					"info",
				);
			},
			onError: (error) => {
				forceMorphCompactRef.value = false;
				if (!ctx.hasUI) return;
				ctx.ui.notify(`Morph compact failed: ${error.message}`, "warning");
			},
		});
		if (ctx.hasUI) {
			ctx.ui.notify(
				config.routing?.forceMorphCompactCommand !== false
					? "Triggered Morph compaction for the current session."
					: "Triggered Pi compaction with Morph auto-compaction rules for the current session.",
				"info",
			);
		}
	};
}

function formatApiKeySource(config) {
	if (config.apiKeys?.length > 1) {
		return `${config.apiKeys.length} keys (${config.apiKeyStrategy})`;
	}
	if (config.apiKeys?.length === 1) {
		return "single key";
	}
	if (config.apiKeyFile) {
		return `key file: ${config.apiKeyFile}`;
	}
	return "none";
}

function formatMorphFooterStatus(config) {
	const keyCount = config.apiKeys?.length || 0;
	if (keyCount === 1) return "MorphLLM (1 key)";
	if (keyCount > 1) {
		return `MorphLLM (${keyCount} keys, ${config.apiKeyStrategy})`;
	}
	return "MorphLLM (0 keys)";
}

function buildStatusLines(config, clients, configFile) {
	return [
		`Morph config: ${config.configPath || configFile.path || "none"}`,
		`Morph config auto-created: ${Boolean(configFile.created)}`,
		`Morph API key: ${config.apiKey ? "configured" : "missing"}`,
		`Morph API key source: ${formatApiKeySource(config)}`,
		`Morph SDK: ${clients.loadError ? `unavailable (${clients.loadError})` : "ready"}`,
		`Morph base URL: ${config.baseUrl}`,
		`Morph FastApply enabled: ${config.fastApplyEnabled}`,
		`WarpGrep enabled: ${config.warpgrepEnabled}`,
		`WarpGrep GitHub enabled: ${config.warpgrepGithubEnabled}`,
		`Compaction enabled: ${config.compactEnabled}`,
		`Readonly agents allowed: ${config.allowReadonlyAgents}`,
		`Routing edit mode: ${config.routing?.editMode || "strong"}`,
		`Routing codebase search mode: ${config.routing?.codebaseSearchMode || "prefer"}`,
		`Routing GitHub search mode: ${config.routing?.githubSearchMode || "prefer"}`,
		`Morph FastApply-first guidance active: ${config.routing?.editMode === "force"}`,
		`Morph-first local search guidance active: ${config.routing?.codebaseSearchMode === "force"}`,
		`Morph-first GitHub search guidance active: ${config.routing?.githubSearchMode === "force"}`,
		`Fallback to native tools: ${config.routing?.fallbackToNativeTools !== false}`,
		`Force /morph-compact: ${config.routing?.forceMorphCompactCommand !== false}`,
	];
}

function formatStatusMessage(lines) {
	return `Morph status\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

async function updateMorphSettingInteractively(ctx, cwd) {
	const choice = await ctx.ui.select("Morph settings", [
		"Routing edit mode",
		"Routing codebase search mode",
		"Routing GitHub search mode",
		"Fallback to native tools",
		"Force /morph-compact",
	]);
	if (!choice) return null;

	if (choice === "Fallback to native tools") {
		const next = await ctx.ui.select("Fallback to native tools", ["true", "false"]);
		if (!next) return null;
		const path = saveMorphConfig(
			{ routing: { fallbackToNativeTools: next === "true" } },
			cwd,
		);
		return `Updated ${path}: routing.fallbackToNativeTools = ${next}`;
	}

	if (choice === "Force /morph-compact") {
		const next = await ctx.ui.select("Force /morph-compact", ["true", "false"]);
		if (!next) return null;
		const path = saveMorphConfig(
			{ routing: { forceMorphCompactCommand: next === "true" } },
			cwd,
		);
		return `Updated ${path}: routing.forceMorphCompactCommand = ${next}`;
	}

	const next = await ctx.ui.select(choice, ["prefer", "strong", "force"]);
	if (!next) return null;
	const key =
		choice === "Routing edit mode"
			? "editMode"
			: choice === "Routing codebase search mode"
				? "codebaseSearchMode"
				: "githubSearchMode";
	const path = saveMorphConfig({ routing: { [key]: next } }, cwd);
	return `Updated ${path}: routing.${key} = ${next}`;
}

export default async function morphExtension(pi) {
	const configFile = ensureMorphConfigFile();
	const config = getMorphConfig();
	const clients = await createClients(config);
	let modelContextTokens = 200000;
	const forceMorphCompactRef = { value: false };
	const morphCompactHandler = createMorphCompactHandler(
		forceMorphCompactRef,
		config,
	);

	if (config.fastApplyEnabled) {
		pi.registerTool(buildMorphFastApplyTool(config, clients));
	}
	if (config.warpgrepEnabled) {
		pi.registerTool(buildWarpGrepTool(config, clients));
	}
	if (config.warpgrepGithubEnabled) {
		pi.registerTool(buildWarpGrepGithubTool(config, clients));
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("morph", formatMorphFooterStatus(config));
			if (configFile.created && configFile.path) {
				ctx.ui.notify(`Created Morph config at ${configFile.path}`, "info");
			}
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("morph", undefined);
		}
	});

	pi.on("before_agent_start", async (event) => {
		const hint = buildMorphSystemRoutingHint(config);
		if (!hint || event.systemPrompt.includes("Morph plugin routing hints:")) {
			return;
		}
		return {
			systemPrompt: `${event.systemPrompt}\n\n${hint}`,
		};
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName === "morph_fastapply") {
			event.input.code_edit = normalizeCodeEditInput(
				event.input.code_edit || "",
			);
		}
	});

	pi.on("tool_result", async (event) => {
		if (
			![
				"morph_fastapply",
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
		const forceMorphCompact = forceMorphCompactRef.value;
		const result = await runMorphCompaction(
			event,
			ctx,
			config,
			clients,
			modelContextTokens,
			{ force: forceMorphCompact },
		);
		forceMorphCompactRef.value = false;
		if (!result) return;
		return {
			compaction: result.compaction,
		};
	});

	pi.registerCommand("morph_status", {
		description: "Show Morph plugin configuration status",
		handler: async (_args, ctx) => {
			const lines = buildStatusLines(config, clients, configFile);
			const message = formatStatusMessage(lines);
			if (ctx.hasUI) {
				ctx.ui.notify(message, "info");
			}
		},
	});

	pi.registerCommand("morph_settings", {
		description: "Interactively update Morph routing settings",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				return;
			}
			const result = await updateMorphSettingInteractively(ctx, process.cwd());
			if (result) {
				ctx.ui.notify(result, "info");
				ctx.ui.notify(
					"Restart or reload the extension/session to pick up updated Morph settings and refresh Morph clients if credentials or key files changed.",
					"info",
				);
			}
		},
	});

	pi.registerCommand("morph-compact", {
		description:
			config.routing?.forceMorphCompactCommand !== false
				? "Trigger Pi compaction immediately and force the Morph compaction path"
				: "Trigger Pi compaction immediately with Morph auto-compaction integration enabled",
		handler: morphCompactHandler,
	});
}
