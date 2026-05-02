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

function getConfigCandidatePaths(cwd = process.cwd()) {
	const configuredPath = process.env.MORPH_CONFIG;
	return [
		configuredPath,
		path.resolve(cwd, ".pi/morph.json"),
		path.resolve(cwd, "morph.config.json"),
		path.resolve(os.homedir(), ".pi/agent/morph.json"),
	].filter(Boolean);
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

function buildDefaultJsonConfig() {
	return {
		apiKey: "",
		baseUrl: DEFAULT_MORPH_BASE_URL,
		editEnabled: true,
		warpgrepEnabled: true,
		warpgrepGithubEnabled: true,
		compactEnabled: true,
		allowReadonlyAgents: false,
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

	const targetPath =
		process.env.MORPH_CONFIG || path.resolve(cwd, ".pi/morph.json");
	mkdirSync(path.dirname(targetPath), { recursive: true });
	writeFileSync(
		targetPath,
		`${JSON.stringify(buildDefaultJsonConfig(), null, 2)}\n`,
		"utf8",
	);
	return { created: true, path: targetPath };
}

export function getMorphConfig(cwd = process.cwd()) {
	const fileConfig = loadJsonConfig(cwd);
	const json = fileConfig.data || {};
	const envBaseUrl = process.env.MORPH_BASE_URL || process.env.MORPH_BASE_API;
	const configuredBaseUrl = json.baseUrl || json.baseApi || envBaseUrl;
	const morphBaseUrl = trimTrailingSlash(
		configuredBaseUrl || DEFAULT_MORPH_BASE_URL,
	);

	return {
		configPath: fileConfig.path,
		apiKey: json.apiKey ?? process.env.MORPH_API_KEY,
		baseUrl: morphBaseUrl,
		fastApplyEnabled: parseBoolValue(
			json.editEnabled ?? json.fastApplyEnabled ?? process.env.MORPH_EDIT,
			true,
		),
		warpgrepEnabled: parseBoolValue(
			json.warpgrepEnabled ?? process.env.MORPH_WARPGREP,
			true,
		),
		warpgrepGithubEnabled: parseBoolValue(
			json.warpgrepGithubEnabled ?? process.env.MORPH_WARPGREP_GITHUB,
			true,
		),
		compactEnabled: parseBoolValue(
			json.compactEnabled ?? process.env.MORPH_COMPACT,
			true,
		),
		allowReadonlyAgents: parseBoolValue(
			json.allowReadonlyAgents ?? process.env.MORPH_ALLOW_READONLY_AGENTS,
			false,
		),
		compactContextThreshold: parseNumberValue(
			json.compactContextThreshold ??
				process.env.MORPH_COMPACT_CONTEXT_THRESHOLD,
			0.7,
		),
		compactPreserveRecent: parseNumberValue(
			json.compactPreserveRecent ?? process.env.MORPH_COMPACT_PRESERVE_RECENT,
			1,
		),
		compactRatio: parseNumberValue(
			json.compactRatio ?? process.env.MORPH_COMPACT_RATIO,
			0.3,
		),
		compactTokenLimit:
			json.compactTokenLimit !== undefined
				? parseNumberValue(json.compactTokenLimit, null)
				: process.env.MORPH_COMPACT_TOKEN_LIMIT
					? parseNumberValue(process.env.MORPH_COMPACT_TOKEN_LIMIT, null)
					: null,
		timeoutMs: parseNumberValue(
			json.timeoutMs ?? process.env.MORPH_TIMEOUT,
			DEFAULT_TIMEOUT_MS,
		),
		warpGrepTimeoutMs: parseNumberValue(
			json.warpGrepTimeoutMs ?? process.env.MORPH_WARPGREP_TIMEOUT,
			DEFAULT_WARPGREP_TIMEOUT_MS,
		),
		compactTimeoutMs: parseNumberValue(
			json.compactTimeoutMs ?? process.env.MORPH_COMPACT_TIMEOUT,
			DEFAULT_COMPACT_TIMEOUT_MS,
		),
	};
}

export {
	DEFAULT_MORPH_BASE_URL,
	EXISTING_CODE_MARKER,
	MORPH_ROUTING_HINT_HEADER,
	READONLY_AGENTS,
};
