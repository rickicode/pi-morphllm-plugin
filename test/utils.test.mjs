import assert from "node:assert/strict";
import test from "node:test";
import {
	buildMorphSystemRoutingHint,
	buildToolRuntimeNotes,
	compactThresholdToChars,
	formatWarpGrepResult,
	normalizeCodeEditInput,
} from "../extensions/morph/utils.js";

test("normalizeCodeEditInput strips fenced code blocks", () => {
	const input = "```ts\nconst x = 1;\n```";
	assert.equal(normalizeCodeEditInput(input), "const x = 1;");
});

test("formatWarpGrepResult renders valid contexts", () => {
	const output = formatWarpGrepResult({
		success: true,
		contexts: [
			{
				file: "src/index.ts",
				content: "export const ok = true;",
				lines: [[1, 1]],
			},
		],
	});

	assert.match(output, /Relevant context found:/);
	assert.match(output, /<file path="src\/index.ts"/);
});

test("buildMorphSystemRoutingHint includes routing modes and fallback guidance", () => {
	const hint = buildMorphSystemRoutingHint({
		apiKey: "sk-test",
		fastApplyEnabled: true,
		warpgrepEnabled: true,
		warpgrepGithubEnabled: true,
		allowReadonlyAgents: false,
		routing: {
			editMode: "force",
			codebaseSearchMode: "strong",
			githubSearchMode: "prefer",
			fallbackToNativeTools: true,
		},
	});

	assert.match(hint, /Use native edit for small exact replacements/);
	assert.match(hint, /Use morph_fastapply for large files, multi-location edits/);
	assert.match(hint, /strongest morph_fastapply-first guidance/);
	assert.match(hint, /Strongly prefer warpgrep_codebase_search/);
	assert.match(hint, /If warpgrep_github_search fails/);
});

test("buildToolRuntimeNotes includes routing mode and fallback guidance", () => {
	const notes = buildToolRuntimeNotes("warpgrep_codebase_search", {
		apiKey: undefined,
		routing: {
			codebaseSearchMode: "force",
			fallbackToNativeTools: true,
		},
	});

	assert.match(notes.join("\n"), /strongest warpgrep_codebase_search guidance/);
	assert.match(notes.join("\n"), /native search tools remain available/);
	assert.match(notes.join("\n"), /Fallback: use bash with rg/);
});

test("compactThresholdToChars respects token limit override", () => {
	const threshold = compactThresholdToChars(
		{
			compactTokenLimit: 1000,
			compactContextThreshold: 0.7,
		},
		200000,
	);

	assert.equal(threshold, 3000);
});
