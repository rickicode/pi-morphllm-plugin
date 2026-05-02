import assert from "node:assert/strict";
import test from "node:test";
import {
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
