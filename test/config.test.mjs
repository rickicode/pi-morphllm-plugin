import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadConfigWithEnv(env, cwd = process.cwd()) {
	const previous = new Map();
	for (const [key, value] of Object.entries(env)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}

	try {
		const mod = await import(
			`../extensions/morph/config.js?${Date.now()}-${Math.random()}`
		);
		return mod.getMorphConfig(cwd);
	} finally {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("defaults to public Morph API URL", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	const config = await loadConfigWithEnv(
		{
			MORPH_BASE_URL: undefined,
			MORPH_BASE_API: undefined,
		},
		tempDir,
	);
	assert.equal(config.baseUrl, "https://api.morphllm.com");
});

test("supports MORPH_BASE_URL override", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	const config = await loadConfigWithEnv(
		{
			MORPH_BASE_URL: "https://proxy.example.com/",
			MORPH_BASE_API: undefined,
		},
		tempDir,
	);
	assert.equal(config.baseUrl, "https://proxy.example.com");
});

test("supports MORPH_BASE_API alias override", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	const config = await loadConfigWithEnv(
		{
			MORPH_BASE_URL: undefined,
			MORPH_BASE_API: "https://alias.example.com/base/",
		},
		tempDir,
	);
	assert.equal(config.baseUrl, "https://alias.example.com/base");
});

test("loads config from .pi/morph.json", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	await mkdir(path.join(tempDir, ".pi"), { recursive: true });
	await writeFile(
		path.join(tempDir, ".pi", "morph.json"),
		JSON.stringify({
			apiKey: "json-key",
			baseUrl: "https://json.example.com/",
			compactEnabled: false,
			warpGrepTimeoutMs: 12345,
		}),
		"utf8",
	);

	const previousCwd = process.cwd();
	process.chdir(tempDir);
	try {
		const config = await loadConfigWithEnv(
			{
				MORPH_API_KEY: undefined,
				MORPH_BASE_URL: undefined,
				MORPH_BASE_API: undefined,
			},
			tempDir,
		);
		assert.equal(config.apiKey, "json-key");
		assert.equal(config.baseUrl, "https://json.example.com");
		assert.equal(config.compactEnabled, false);
		assert.equal(config.warpGrepTimeoutMs, 12345);
		assert.equal(config.configPath, path.join(tempDir, ".pi", "morph.json"));
	} finally {
		process.chdir(previousCwd);
	}
});

test("json config takes precedence over environment variables", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	await writeFile(
		path.join(tempDir, "morph.config.json"),
		JSON.stringify({
			baseUrl: "https://json-priority.example.com/",
			compactEnabled: false,
		}),
		"utf8",
	);

	const previousCwd = process.cwd();
	process.chdir(tempDir);
	try {
		const config = await loadConfigWithEnv(
			{
				MORPH_BASE_URL: "https://env.example.com/",
				MORPH_COMPACT: "true",
			},
			tempDir,
		);
		assert.equal(config.baseUrl, "https://json-priority.example.com");
		assert.equal(config.compactEnabled, false);
	} finally {
		process.chdir(previousCwd);
	}
});
