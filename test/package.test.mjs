import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

test("package manifest exposes Pi extension entry and prompt", async () => {
	const pkg = await readJson(new URL("../package.json", import.meta.url));
	assert.equal(pkg.main, "./extensions/morph/index.js");
	assert.deepEqual(pkg.pi.extensions, ["./extensions/morph/index.js"]);
	assert.deepEqual(pkg.pi.prompts, ["./prompts/morph-tools.md"]);
});

test("README documents custom Morph base URL support", async () => {
	const readme = await readFile(
		new URL("../README.md", import.meta.url),
		"utf8",
	);
	assert.match(readme, /MORPH_BASE_URL/);
	assert.match(readme, /MORPH_BASE_API/);
	assert.match(readme, /https:\/\/api\.morphllm\.com/);
});

test("README documents package-first Pi usage", async () => {
	const readme = await readFile(
		new URL("../README.md", import.meta.url),
		"utf8",
	);
	assert.match(readme, /pi -e \./);
	assert.match(readme, /loads the package manifest from `package\.json`/);
	assert.match(readme, /Extension-only development shortcut/);
	assert.match(
		readme,
		/does not load the package prompt resource from `prompts\/morph-tools\.md`/,
	);
});
