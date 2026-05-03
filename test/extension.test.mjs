import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";

async function loadExtension() {
	const module = await import(
		`../extensions/morph/index.js?test=${Date.now()}-${Math.random()}`
	);
	return module.default;
}

function createFakePi() {
	const tools = [];
	const commands = new Map();
	const handlers = new Map();

	return {
		tools,
		commands,
		handlers,
		registerTool(tool) {
			tools.push(tool);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
		on(event, handler) {
			handlers.set(event, handler);
		},
	};
}

test("before_agent_start does not duplicate Morph routing hints", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempCwd = await mkdtemp(path.join(os.tmpdir(), "pi-morph-cwd-"));
	const previousHome = process.env.HOME;
	const previousCwd = process.cwd();
	process.env.HOME = tempHome;
	process.chdir(tempCwd);
	try {
		const extension = await loadExtension();
		const pi = createFakePi();
		await extension(pi);

		const handler = pi.handlers.get("before_agent_start");
		assert.ok(handler);

		const withHint = [
			"Base system prompt",
			"Morph plugin routing hints:",
			"- Morph remote tools are unavailable because MORPH_API_KEY is not configured.",
			"- Use native Pi tools until Morph credentials are configured.",
			"- If morph_fastapply is unavailable, fall back to native edit for exact replacements or write for new files.",
		].join("\n");

		const result = await handler({
			systemPrompt: withHint,
			prompt: "hi",
			systemPromptOptions: {},
		});

		assert.equal(result, undefined);
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempCwd, { recursive: true, force: true });
	}
});

test("session_before_compact reads messages from branchEntries", async () => {
	const extension = await loadExtension();
	const pi = createFakePi();
	await extension(pi);

	const handler = pi.handlers.get("session_before_compact");
	assert.ok(handler);

	const result = await handler(
		{
			branchEntries: [
				{
					type: "message",
					message: {
						role: "user",
						content: [{ type: "text", text: "hello" }],
					},
				},
			],
			preparation: {
				firstKeptEntryId: "abc",
				tokensBefore: 100,
			},
		},
		{
			hasUI: false,
			ui: { notify() {} },
		},
	);

	assert.equal(result, undefined);
});

test("extension auto-creates global config on load when none exists", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempCwd = await mkdtemp(path.join(os.tmpdir(), "pi-morph-cwd-"));
	const previousHome = process.env.HOME;
	const previousCwd = process.cwd();
	process.env.HOME = tempHome;
	process.chdir(tempCwd);
	try {
		const extension = await loadExtension();
		const pi = createFakePi();
		await extension(pi);
		const configPath = path.join(tempHome, ".pi", "agent", "morph.json");
		const raw = await readFile(configPath, "utf8");
		const json = JSON.parse(raw);
		assert.equal("baseUrl" in json, false);
		const command = pi.commands.get("morph_status");
		await assert.doesNotReject(() =>
			command.handler("", {
				hasUI: false,
				ui: {
					notify() {
						throw new Error("should not notify without UI");
					},
				},
			}),
		);
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempCwd, { recursive: true, force: true });
	}
});

test("morph_fastapply tool exposes dry_run parameter", async () => {
	const extension = await loadExtension();
	const pi = createFakePi();
	await extension(pi);

	const tool = pi.tools.find((item) => item.name === "morph_fastapply");
	assert.ok(tool);
	assert.ok(tool.parameters.properties.dry_run);
});

test("morph_status command is safe without UI", async () => {
	const extension = await loadExtension();
	const pi = createFakePi();
	await extension(pi);

	const command = pi.commands.get("morph_status");
	assert.ok(command);

	await assert.doesNotReject(() =>
		command.handler("", {
			hasUI: false,
			ui: {
				notify() {
					throw new Error("should not notify without UI");
				},
			},
		}),
	);
});

test("morph_status reports live API probe result", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempCwd = await mkdtemp(path.join(os.tmpdir(), "pi-morph-cwd-"));
	const previousHome = process.env.HOME;
	const previousCwd = process.cwd();
	process.env.HOME = tempHome;
	process.chdir(tempCwd);
	await mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
	await writeFile(
		path.join(tempHome, ".pi", "agent", "morph.json"),
		`${JSON.stringify({ apiKey: "test-key" }, null, 2)}\n`,
		"utf8",
	);

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ output: "ok" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});

	try {
		const extension = await loadExtension();
		const pi = createFakePi();
		await extension(pi);

		const command = pi.commands.get("morph_status");
		assert.ok(command);

		const notifications = [];
		await command.handler("", {
			hasUI: true,
			ui: {
				notify(message, level) {
					notifications.push({ message, level });
				},
			},
		});

		assert.equal(notifications[0].message, "Running Morph API live test...");
		assert.match(notifications[1].message, /Morph plugin version: 0\.1\.4/);
		assert.match(notifications[1].message, /Morph API live test: ok/);
	} finally {
		globalThis.fetch = originalFetch;
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempCwd, { recursive: true, force: true });
	}
});

test("morph_status classifies authentication probe failures", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempCwd = await mkdtemp(path.join(os.tmpdir(), "pi-morph-cwd-"));
	const previousHome = process.env.HOME;
	const previousCwd = process.cwd();
	process.env.HOME = tempHome;
	process.chdir(tempCwd);
	await mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
	await writeFile(
		path.join(tempHome, ".pi", "agent", "morph.json"),
		`${JSON.stringify({ apiKey: "bad-key" }, null, 2)}\n`,
		"utf8",
	);

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response("unauthorized", {
			status: 401,
			headers: { "Content-Type": "text/plain" },
		});

	try {
		const extension = await loadExtension();
		const pi = createFakePi();
		await extension(pi);

		const command = pi.commands.get("morph_status");
		assert.ok(command);

		const notifications = [];
		await command.handler("", {
			hasUI: true,
			ui: {
				notify(message, level) {
					notifications.push({ message, level });
				},
			},
		});

		assert.match(
			notifications[1].message,
			/Morph API live test: failed \(authentication error:/,
		);
	} finally {
		globalThis.fetch = originalFetch;
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempCwd, { recursive: true, force: true });
	}
});

test("morph_status classifies network probe failures", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempCwd = await mkdtemp(path.join(os.tmpdir(), "pi-morph-cwd-"));
	const previousHome = process.env.HOME;
	const previousCwd = process.cwd();
	process.env.HOME = tempHome;
	process.chdir(tempCwd);
	await mkdir(path.join(tempHome, ".pi", "agent"), { recursive: true });
	await writeFile(
		path.join(tempHome, ".pi", "agent", "morph.json"),
		`${JSON.stringify({ apiKey: "test-key" }, null, 2)}\n`,
		"utf8",
	);

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("fetch failed");
	};

	try {
		const extension = await loadExtension();
		const pi = createFakePi();
		await extension(pi);

		const command = pi.commands.get("morph_status");
		assert.ok(command);

		const notifications = [];
		await command.handler("", {
			hasUI: true,
			ui: {
				notify(message, level) {
					notifications.push({ message, level });
				},
			},
		});

		assert.match(
			notifications[1].message,
			/Morph API live test: failed \(network\/base URL error:/,
		);
	} finally {
		globalThis.fetch = originalFetch;
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempCwd, { recursive: true, force: true });
	}
});

test("extension still registers Morph tools without API key", async () => {
	const extension = await loadExtension();
	const pi = createFakePi();
	await extension(pi);

	assert.deepEqual(pi.tools.map((tool) => tool.name).sort(), [
		"morph_fastapply",
		"warpgrep_codebase_search",
		"warpgrep_github_search",
	]);
	assert.ok(pi.commands.has("morph_status"));
	assert.ok(pi.commands.has("morph_settings"));
	assert.ok(pi.commands.has("morph-compact"));
});

test("createAgentSession loads Morph tools and Morph prompt guidance", async () => {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: true },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: process.cwd(),
		noSkills: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		cwd: process.cwd(),
		agentDir: process.cwd(),
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
		settingsManager,
		authStorage,
		modelRegistry,
	});

	try {
		assert.ok(session.getAllTools().some((tool) => tool.name === "morph_fastapply"));
		assert.ok(
			session
				.getAllTools()
				.some((tool) => tool.name === "warpgrep_codebase_search"),
		);
		assert.match(
			session.systemPrompt,
			/morph_fastapply: Fast apply for large or scattered edits using lazy existing-code markers\./,
		);
		assert.match(
			session.systemPrompt,
			/Use warpgrep_github_search for public GitHub source questions about external libraries or SDKs\./,
		);
	} finally {
		session.dispose();
	}
});

test("morph-compact command triggers ctx.compact", async () => {
	const extension = await loadExtension();
	const pi = createFakePi();
	await extension(pi);

	const command = pi.commands.get("morph-compact");
	assert.ok(command);

	let called = 0;
	const ctx = {
		hasUI: false,
		compact(options) {
			called += 1;
			assert.equal(typeof options?.onComplete, "function");
			assert.equal(typeof options?.onError, "function");
		},
		ui: { notify() {} },
	};

	await command.handler("", ctx);

	assert.equal(called, 1);
});

test("morph-compact requires Morph compaction instead of silently falling back", async () => {
	const extension = await loadExtension();
	const pi = createFakePi();
	await extension(pi);

	const compactCommand = pi.commands.get("morph-compact");
	const compactHandler = pi.handlers.get("session_before_compact");
	assert.ok(compactCommand);
	assert.ok(compactHandler);

	await compactCommand.handler("", {
		hasUI: false,
		compact() {},
		ui: { notify() {} },
	});

	await assert.rejects(() =>
		compactHandler(
			{
				branchEntries: [
					{
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "small message" }],
						},
					},
				],
				preparation: {
					firstKeptEntryId: "abc",
					tokensBefore: 100,
				},
			},
			{
				hasUI: false,
				ui: { notify() {} },
			},
		),
	);
});

test("morph-compact always forces Morph when auto compaction is disabled", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempCwd = await mkdtemp(path.join(os.tmpdir(), "pi-morph-cwd-"));
	const previousHome = process.env.HOME;
	const previousCwd = process.cwd();
	process.chdir(tempCwd);
	await writeFile(
		path.join(tempCwd, "morph.config.json"),
		`${JSON.stringify({ apiKey: "test-key", autoCompactEnabled: false }, null, 2)}\n`,
		"utf8",
	);
	process.env.HOME = tempHome;
	try {
		const extension = await loadExtension();
		const pi = createFakePi();
		await extension(pi);

		const compactCommand = pi.commands.get("morph-compact");
		const compactHandler = pi.handlers.get("session_before_compact");
		assert.ok(compactCommand);
		assert.ok(compactHandler);

		await compactCommand.handler("", {
			hasUI: false,
			compact() {},
			ui: { notify() {} },
		});

		await assert.rejects(
			() =>
				compactHandler(
					{
						branchEntries: [
							{
								type: "message",
								message: {
									role: "user",
									content: [{ type: "text", text: "small message" }],
								},
							},
						],
						preparation: {
							firstKeptEntryId: "abc",
							tokensBefore: 100,
						},
					},
					{
						hasUI: false,
						ui: { notify() {} },
					},
				),
			/Conversation is below the Morph compaction threshold/,
		);
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempCwd, { recursive: true, force: true });
	}
});

test("auto compaction skips Morph when auto compaction is disabled", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempCwd = await mkdtemp(path.join(os.tmpdir(), "pi-morph-cwd-"));
	const previousHome = process.env.HOME;
	const previousCwd = process.cwd();
	process.chdir(tempCwd);
	await writeFile(
		path.join(tempCwd, "morph.config.json"),
		`${JSON.stringify({ apiKey: "test-key", autoCompactEnabled: false }, null, 2)}\n`,
		"utf8",
	);
	process.env.HOME = tempHome;
	try {
		const extension = await loadExtension();
		const pi = createFakePi();
		await extension(pi);

		const compactHandler = pi.handlers.get("session_before_compact");
		assert.ok(compactHandler);

		const result = await compactHandler(
			{
				branchEntries: [
					{
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "hello".repeat(5000) }],
						},
					},
				],
				preparation: {
					firstKeptEntryId: "abc",
					tokensBefore: 100,
				},
			},
			{
				hasUI: false,
				ui: { notify() {} },
			},
		);

		assert.equal(result, undefined);
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempCwd, { recursive: true, force: true });
	}
});

test("force edit mode keeps native edit and write available", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-morph-edit-"));
	const previousCwd = process.cwd();
	process.chdir(tempDir);
	try {
		await writeFile(path.join(tempDir, "existing.txt"), "hello", "utf8");

		const extension = await loadExtension();
		const pi = createFakePi();
		await extension(pi);

		const toolCallHandler = pi.handlers.get("tool_call");
		assert.ok(toolCallHandler);

		const nativeEdit = await toolCallHandler(
			{ toolName: "edit", input: { path: "existing.txt" } },
			{ cwd: tempDir, hasUI: false, ui: { notify() {} } },
		);
		assert.equal(nativeEdit, undefined);

		const nativeWrite = await toolCallHandler(
			{ toolName: "write", input: { path: "existing.txt" } },
			{ cwd: tempDir, hasUI: false, ui: { notify() {} } },
		);
		assert.equal(nativeWrite, undefined);
	} finally {
		process.chdir(previousCwd);
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("force search modes keep native search tools available", async () => {
	const extension = await loadExtension();
	const pi = createFakePi();
	await extension(pi);

	const toolCallHandler = pi.handlers.get("tool_call");
	assert.ok(toolCallHandler);

	const nativeLocalSearch = await toolCallHandler(
		{ toolName: "bash", input: { command: "rg TODO src" } },
		{ cwd: process.cwd(), hasUI: false, ui: { notify() {} } },
	);
	assert.equal(nativeLocalSearch, undefined);

	const nativeGithubSearch = await toolCallHandler(
		{ toolName: "github_search_code", input: { query: "repo:foo/bar thing" } },
		{ cwd: process.cwd(), hasUI: false, ui: { notify() {} } },
	);
	assert.equal(nativeGithubSearch, undefined);
});

test("morph_settings updates routing config through interactive flow", async () => {
	const tempHome = await mkdtemp(path.join(os.tmpdir(), "pi-morph-home-"));
	const tempCwd = await mkdtemp(path.join(os.tmpdir(), "pi-morph-cwd-"));
	const previousHome = process.env.HOME;
	const previousCwd = process.cwd();
	process.env.HOME = tempHome;
	process.chdir(tempCwd);
	try {
		const extension = await loadExtension();
		const pi = createFakePi();
		await extension(pi);

		const command = pi.commands.get("morph_settings");
		assert.ok(command);

		const notifications = [];
		const selections = ["Routing edit mode", "strong"];
		await command.handler("", {
			hasUI: true,
			ui: {
				async select() {
					return selections.shift() ?? null;
				},
				notify(message, level) {
					notifications.push({ message, level });
				},
			},
		});

		const configPath = path.join(tempHome, ".pi", "agent", "morph.json");
		const raw = await readFile(configPath, "utf8");
		const json = JSON.parse(raw);
		assert.equal(json.routing.editMode, "strong");
		assert.equal(notifications.length, 2);
		assert.match(notifications[0].message, /routing\.editMode = strong/);
		assert.match(
			notifications[1].message,
			/refresh Morph clients if credentials or key files changed/,
		);
	} finally {
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(tempHome, { recursive: true, force: true });
		await rm(tempCwd, { recursive: true, force: true });
	}
});
