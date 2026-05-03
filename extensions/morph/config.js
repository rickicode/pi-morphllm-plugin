import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_MORPH_BASE_URL = "https://api.morphllm.com";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_WARPGREP_TIMEOUT_MS = 60000;
const DEFAULT_COMPACT_TIMEOUT_MS = 60000;
const EXISTING_CODE_MARKER = "// ... existing code ...";
const MORPH_ROUTING_HINT_HEADER = "Morph plugin routing hints:";
const READONLY_AGENTS = ["plan", "explore"];
const MULTI_API_KEY_SENTINEL = "multiple";
const DEFAULT_MULTI_API_KEY_FILE = path.resolve(
	os.homedir(),
	".pi/agent/morph.env",
);
const MORPH_FASTAPPLY_AGENT_BLOCK_START = "<!-- pi-morphllm-plugin:fastapply:start -->";
const MORPH_FASTAPPLY_AGENT_BLOCK_END = "<!-- pi-morphllm-plugin:fastapply:end -->";
const MORPH_FASTAPPLY_AGENT_INSTRUCTION_BLOCK = [
	MORPH_FASTAPPLY_AGENT_BLOCK_START,
	"Morph FastApply: For existing-file edits, always use morph_fastapply first. Use native write only for brand new files, and use native edit only as a fallback when morph_fastapply is unavailable or clearly unsuitable.",
	MORPH_FASTAPPLY_AGENT_BLOCK_END,
].join("\n");

function parseBoolValue(value, fallback = true) {
	if (value === undefined || value === null) return fallback;
	if (typeof value === "boolean") return value;
	return String(value) !== "false";
}

function parseNumberValue(value, fallback) {
	if (value === undefined || value === null || value === "") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function trimTrailingSlash(url) {
	return url.replace(/\/+$/, "");
}

function parseEnumValue(value, allowedValues, fallback) {
	if (typeof value !== "string") return fallback;
	return allowedValues.includes(value) ? value : fallback;
}

function getConfigCandidatePaths(cwd = process.cwd()) {
	return [
		path.resolve(os.homedir(), ".pi/agent/morph.json"),
		path.resolve(cwd, ".pi/morph.json"),
		path.resolve(cwd, "morph.config.json"),
	];
}

function loadJsonConfig(cwd = process.cwd()) {
	const candidatePaths = getConfigCandidatePaths(cwd);

	for (const candidatePath of candidatePaths) {
		if (!existsSync(candidatePath)) continue;
		const raw = readFileSync(candidatePath, "utf8");
		return {
			path: candidatePath,
			data: JSON.parse(raw),
		};
	}

	return { path: null, data: {} };
}

function resolveWritableConfigPath() {
	return path.resolve(os.homedir(), ".pi/agent/morph.json");
}

function resolveGlobalAgentsPath() {
	return path.resolve(os.homedir(), ".pi/agent/AGENTS.md");
}

export function ensureGlobalMorphAgentInstruction() {
	const agentsPath = resolveGlobalAgentsPath();
	mkdirSync(path.dirname(agentsPath), { recursive: true });

	const existing = existsSync(agentsPath)
		? readFileSync(agentsPath, "utf8")
		: "";
	if (
		existing.includes(MORPH_FASTAPPLY_AGENT_BLOCK_START) &&
		existing.includes(MORPH_FASTAPPLY_AGENT_BLOCK_END)
	) {
		return { updated: false, path: agentsPath };
	}

	const next = existing.trim().length
		? `${existing.replace(/\s*$/, "")}\n\n${MORPH_FASTAPPLY_AGENT_INSTRUCTION_BLOCK}\n`
		: `${MORPH_FASTAPPLY_AGENT_INSTRUCTION_BLOCK}\n`;
	writeFileSync(agentsPath, next, "utf8");
	return { updated: true, path: agentsPath };
}

function resolveConfigRelativePath(configPath, targetPath, cwd = process.cwd()) {
	if (!targetPath) return null;
	if (targetPath.startsWith("~/")) {
		return path.resolve(os.homedir(), targetPath.slice(2));
	}
	if (path.isAbsolute(targetPath)) return targetPath;
	if (configPath) return path.resolve(path.dirname(configPath), targetPath);
	return path.resolve(cwd, targetPath);
}

function parseApiKeyLine(line) {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) return null;
	const parts = trimmed.split("|");
	if (parts.length >= 3) {
		return parts[2].trim() || null;
	}
	return trimmed;
}

function loadApiKeysFromFile(apiKeyFilePath) {
	if (!apiKeyFilePath || !existsSync(apiKeyFilePath)) return [];
	return readFileSync(apiKeyFilePath, "utf8")
		.split(/\r?\n/)
		.map(parseApiKeyLine)
		.filter(Boolean);
}

function buildDefaultJsonConfig() {
	return {
		apiKey: "",
		apiKeyFile: DEFAULT_MULTI_API_KEY_FILE,
		apiKeyStrategy: "round-robin",
		editEnabled: true,
		warpgrepEnabled: true,
		warpgrepGithubEnabled: true,
		autoCompactEnabled: true,
		allowReadonlyAgents: false,
		routing: {
			editMode: "force",
			codebaseSearchMode: "force",
			githubSearchMode: "force",
			fallbackToNativeTools: true,
		},
		compactContextThreshold: 0.7,
		compactPreserveRecent: 1,
		compactRatio: 0.3,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		warpGrepTimeoutMs: DEFAULT_WARPGREP_TIMEOUT_MS,
		compactTimeoutMs: DEFAULT_COMPACT_TIMEOUT_MS,
	};
}

export function ensureMorphConfigFile(cwd = process.cwd()) {
	const candidatePaths = getConfigCandidatePaths(cwd);
	for (const candidatePath of candidatePaths) {
		if (existsSync(candidatePath)) {
			return { created: false, path: candidatePath };
		}
	}

	const targetPath = resolveWritableConfigPath(cwd);
	mkdirSync(path.dirname(targetPath), { recursive: true });
	writeFileSync(
		targetPath,
		`${JSON.stringify(buildDefaultJsonConfig(), null, 2)}\n`,
		"utf8",
	);
	return { created: true, path: targetPath };
}

export function saveMorphConfig(configPatch, cwd = process.cwd()) {
	const ensured = ensureMorphConfigFile(cwd);
	const targetPath = ensured.path || resolveWritableConfigPath(cwd);
	const current = existsSync(targetPath)
		? JSON.parse(readFileSync(targetPath, "utf8"))
		: buildDefaultJsonConfig();
	const next = {
		...current,
		...configPatch,
		routing: {
			...(current.routing || {}),
			...(configPatch.routing || {}),
		},
	};
	mkdirSync(path.dirname(targetPath), { recursive: true });
	writeFileSync(targetPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return targetPath;
}

export function getMorphConfig(cwd = process.cwd()) {
	const fileConfig = loadJsonConfig(cwd);
	const json = fileConfig.data || {};
	const configuredBaseUrl = json.baseUrl || json.baseApi;
	const morphBaseUrl = trimTrailingSlash(
		configuredBaseUrl || DEFAULT_MORPH_BASE_URL,
	);

	const routing = json.routing || {};
	const singleApiKey = json.apiKey;
	const useMultipleApiKeys =
		typeof singleApiKey === "string" &&
		singleApiKey.trim().toLowerCase() === MULTI_API_KEY_SENTINEL;
	const configuredApiKeyFile = useMultipleApiKeys
		? json.apiKeyFile ?? DEFAULT_MULTI_API_KEY_FILE
		: json.apiKeyFile ?? null;
	const resolvedApiKeyFile = resolveConfigRelativePath(
		fileConfig.path,
		configuredApiKeyFile,
		cwd,
	);
	const apiKeys = loadApiKeysFromFile(resolvedApiKeyFile);

	if (singleApiKey && !useMultipleApiKeys) {
		apiKeys.unshift(singleApiKey);
	}

	const uniqueApiKeys = [...new Set(apiKeys.filter(Boolean))];

	return {
		configPath: fileConfig.path,
		apiKey: uniqueApiKeys[0] || null,
		apiKeys: uniqueApiKeys,
		apiKeyFile: resolvedApiKeyFile,
		apiKeyStrategy: parseEnumValue(
			json.apiKeyStrategy,
			["random", "round-robin"],
			"round-robin",
		),
		baseUrl: morphBaseUrl,
		fastApplyEnabled: parseBoolValue(
			json.editEnabled ?? json.fastApplyEnabled,
			true,
		),
		warpgrepEnabled: parseBoolValue(json.warpgrepEnabled, true),
		warpgrepGithubEnabled: parseBoolValue(json.warpgrepGithubEnabled, true),
		autoCompactEnabled: parseBoolValue(json.autoCompactEnabled, true),
		allowReadonlyAgents: parseBoolValue(json.allowReadonlyAgents, false),
		routing: {
			editMode: parseEnumValue(
				routing.editMode,
				["prefer", "strong", "force"],
				"force",
			),
			codebaseSearchMode: parseEnumValue(
				routing.codebaseSearchMode,
				["prefer", "strong", "force"],
				"force",
			),
			githubSearchMode: parseEnumValue(
				routing.githubSearchMode,
				["prefer", "strong", "force"],
				"force",
			),
			fallbackToNativeTools: parseBoolValue(
				routing.fallbackToNativeTools,
				true,
			),
		},
		compactContextThreshold: parseNumberValue(
			json.compactContextThreshold,
			0.7,
		),
		compactPreserveRecent: parseNumberValue(json.compactPreserveRecent, 1),
		compactRatio: parseNumberValue(json.compactRatio, 0.3),
		compactTokenLimit:
			json.compactTokenLimit !== undefined
				? parseNumberValue(json.compactTokenLimit, null)
				: null,
		timeoutMs: parseNumberValue(json.timeoutMs, DEFAULT_TIMEOUT_MS),
		warpGrepTimeoutMs: parseNumberValue(
			json.warpGrepTimeoutMs,
			DEFAULT_WARPGREP_TIMEOUT_MS,
		),
		compactTimeoutMs: parseNumberValue(
			json.compactTimeoutMs,
			DEFAULT_COMPACT_TIMEOUT_MS,
		),
	};
}

export {
	DEFAULT_MORPH_BASE_URL,
	EXISTING_CODE_MARKER,
	MORPH_ROUTING_HINT_HEADER,
	READONLY_AGENTS,
	MORPH_FASTAPPLY_AGENT_BLOCK_END,
	MORPH_FASTAPPLY_AGENT_BLOCK_START,
	MORPH_FASTAPPLY_AGENT_INSTRUCTION_BLOCK,
};
