import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadConfig(cwd = process.cwd()) {
	const mod = await import(
		`../extensions/morph/config.js?${Date.now()}-${Math.random()}`
	);
	return mod.getMorphConfig(cwd);
}

test("defaults to public Morph API URL", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const previousHome = process.env.HOME;
	process.env.HOME = tempHome;
	try {
		const config = await loadConfig(tempDir);
		assert.equal(config.baseUrl, "https://api.morphllm.com");
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("supports baseUrl from JSON config", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const previousHome = process.env.HOME;
	process.env.HOME = tempHome;
	await writeFile(
		path.join(tempDir, "morph.config.json"),
		JSON.stringify({ baseUrl: "https://proxy.example.com/" }),
		"utf8",
	);
	try {
		const config = await loadConfig(tempDir);
		assert.equal(config.baseUrl, "https://proxy.example.com");
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("supports baseApi alias from JSON config", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const previousHome = process.env.HOME;
	process.env.HOME = tempHome;
	await writeFile(
		path.join(tempDir, "morph.config.json"),
		JSON.stringify({ baseApi: "https://alias.example.com/base/" }),
		"utf8",
	);
	try {
		const config = await loadConfig(tempDir);
		assert.equal(config.baseUrl, "https://alias.example.com/base");
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("prefers global ~/.pi/agent/morph.json over project files", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	await mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
	await mkdir(path.join(tempDir, ".pi"), { recursive: true });
	await writeFile(
		path.join(tempHome, ".pi", "agent", "morph.json"),
		JSON.stringify({
			apiKey: "global-key",
			baseUrl: "https://global.example.com/",
			autoCompactEnabled: false,
		}),
		"utf8",
	);
	await writeFile(
		path.join(tempDir, ".pi", "morph.json"),
		JSON.stringify({
			apiKey: "project-key",
			baseUrl: "https://project.example.com/",
			autoCompactEnabled: true,
			warpGrepTimeoutMs: 12345,
		}),
		"utf8",
	);

	const previousHome = process.env.HOME;
	process.env.HOME = tempHome;
	try {
		const config = await loadConfig(tempDir);
		assert.equal(config.apiKey, "global-key");
		assert.equal(config.baseUrl, "https://global.example.com");
		assert.equal(config.autoCompactEnabled, false);
		assert.equal(config.routing.editMode, "force");
		assert.equal(config.routing.codebaseSearchMode, "force");
		assert.equal(config.routing.githubSearchMode, "force");
		assert.equal(config.routing.fallbackToNativeTools, true);
		assert.equal(
			config.configPath,
			path.join(tempHome, ".pi", "agent", "morph.json"),
		);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("loads config from .pi/morph.json when global config is absent", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	await mkdir(path.join(tempDir, ".pi"), { recursive: true });
	await writeFile(
		path.join(tempDir, ".pi", "morph.json"),
		JSON.stringify({
			apiKey: "json-key",
			baseUrl: "https://json.example.com/",
			autoCompactEnabled: false,
			warpGrepTimeoutMs: 12345,
		}),
		"utf8",
	);

	const previousCwd = process.cwd();
	process.chdir(tempDir);
	const previousHome = process.env.HOME;
	process.env.HOME = tempHome;
	try {
		const config = await loadConfig(tempDir);
		assert.equal(config.apiKey, "json-key");
		assert.equal(config.baseUrl, "https://json.example.com");
		assert.equal(config.autoCompactEnabled, false);
		assert.equal(config.warpGrepTimeoutMs, 12345);
		assert.equal(config.routing.editMode, "force");
		assert.equal(config.routing.codebaseSearchMode, "force");
		assert.equal(config.routing.githubSearchMode, "force");
		assert.equal(config.configPath, path.join(tempDir, ".pi", "morph.json"));
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		process.chdir(previousCwd);
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("json config is the only source of truth", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	await writeFile(
		path.join(tempDir, "morph.config.json"),
		JSON.stringify({
			baseUrl: "https://json-priority.example.com/",
			autoCompactEnabled: false,
			routing: {
				editMode: "force",
				fallbackToNativeTools: false,
			},
		}),
		"utf8",
	);

	const previousCwd = process.cwd();
	process.chdir(tempDir);
	const previousHome = process.env.HOME;
	process.env.HOME = tempHome;
	try {
		const config = await loadConfig(tempDir);
		assert.equal(config.baseUrl, "https://json-priority.example.com");
		assert.equal(config.autoCompactEnabled, false);
		assert.equal(config.routing.editMode, "force");
		assert.equal(config.routing.fallbackToNativeTools, false);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		process.chdir(previousCwd);
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("ensureMorphConfigFile creates global config by default", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	const mod = await import(
		`../extensions/morph/config.js?${Date.now()}-${Math.random()}`
	);
	const targetPath = path.join(tempHome, ".pi", "agent", "morph.json");

	const previousHome = process.env.HOME;
	process.env.HOME = tempHome;
	try {
		const result = mod.ensureMorphConfigFile(tempDir);
		assert.equal(result.created, true);
		assert.equal(result.path, targetPath);
		const raw = await readFile(targetPath, "utf8");
		const json = JSON.parse(raw);
		assert.equal("baseUrl" in json, false);
		assert.equal(json.routing.editMode, "force");
		assert.equal(json.routing.codebaseSearchMode, "force");
		assert.equal(json.routing.githubSearchMode, "force");
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("invalid routing modes fall back to safe defaults", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-config-"));
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	await writeFile(
		path.join(tempDir, "morph.config.json"),
		JSON.stringify({
			routing: {
				editMode: "aggressive",
				codebaseSearchMode: "sometimes",
				githubSearchMode: "always",
			},
		}),
		"utf8",
	);

	const previousCwd = process.cwd();
	process.chdir(tempDir);
	const previousHome = process.env.HOME;
	process.env.HOME = tempHome;
	try {
		const config = await loadConfig(tempDir);
		assert.equal(config.routing.editMode, "force");
		assert.equal(config.routing.codebaseSearchMode, "force");
		assert.equal(config.routing.githubSearchMode, "force");
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		process.chdir(previousCwd);
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempDir, { recursive: true, force: true });
	}
});
