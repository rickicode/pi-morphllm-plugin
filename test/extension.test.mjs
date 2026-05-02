import assert from "node:assert/strict";
import test from "node:test";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";

async function loadExtensionWithEnv(env = {}) {
	const previous = {};
	for (const [key, value] of Object.entries(env)) {
		previous[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = String(value);
	}

	const module = await import(
		`../extensions/morph/index.js?test=${Date.now()}-${Math.random()}`
	);

	for (const [key] of Object.entries(env)) {
		if (previous[key] === undefined) delete process.env[key];
		else process.env[key] = previous[key];
	}

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
	const extension = await loadExtensionWithEnv({
		MORPH_API_KEY: undefined,
	});
	const pi = createFakePi();
	await extension(pi);

	const handler = pi.handlers.get("before_agent_start");
	assert.ok(handler);

	const withHint = [
		"Base system prompt",
		"Morph plugin routing hints:",
		"- Morph remote tools are unavailable because MORPH_API_KEY is not configured.",
		"- Use native Pi tools until Morph credentials are configured.",
	].join("\n");

	const result = await handler({
		systemPrompt: withHint,
		prompt: "hi",
		systemPromptOptions: {},
	});

	assert.equal(result, undefined);
});

test("session_before_compact reads messages from branchEntries", async () => {
	const extension = await loadExtensionWithEnv({
		MORPH_API_KEY: undefined,
		MORPH_COMPACT: "true",
	});
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

test("morph_status command is safe without UI", async () => {
	const extension = await loadExtensionWithEnv({
		MORPH_API_KEY: undefined,
	});
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

test("extension still registers Morph tools without API key", async () => {
	const extension = await loadExtensionWithEnv({
		MORPH_API_KEY: undefined,
	});
	const pi = createFakePi();
	await extension(pi);

	assert.deepEqual(pi.tools.map((tool) => tool.name).sort(), [
		"morph_edit",
		"warpgrep_codebase_search",
		"warpgrep_github_search",
	]);
	assert.ok(pi.commands.has("morph_status"));
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
		assert.ok(session.getAllTools().some((tool) => tool.name === "morph_edit"));
		assert.ok(
			session
				.getAllTools()
				.some((tool) => tool.name === "warpgrep_codebase_search"),
		);
		assert.match(
			session.systemPrompt,
			/morph_edit: Fast apply for large or scattered edits using lazy existing-code markers\./,
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
	const extension = await loadExtensionWithEnv({
		MORPH_API_KEY: undefined,
	});
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
