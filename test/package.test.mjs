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

test("package manifest includes publish-facing metadata", async () => {
	const pkg = await readJson(new URL("../package.json", import.meta.url));
	assert.equal(pkg.author, "rickicode");
	assert.equal(pkg.homepage, "https://github.com/rickicode/pi-morphllm-plugin");
	assert.equal(pkg.bugs.url, "https://github.com/rickicode/pi-morphllm-plugin/issues");
	assert.equal(pkg.repository.type, "git");
	assert.equal(
		pkg.repository.url,
		"git+https://github.com/rickicode/pi-morphllm-plugin.git",
	);
	assert.equal(pkg.engines.node, ">=20");
});

test("README documents file-based custom Morph base URL support", async () => {
	const readme = await readFile(
		new URL("../README.md", import.meta.url),
		"utf8",
	);
	assert.match(readme, /baseUrl/);
	assert.match(readme, /baseApi/);
	assert.match(readme, /https:\/\/api\.morphllm\.com/);
	assert.doesNotMatch(readme, /MORPH_BASE_URL/);
	assert.doesNotMatch(readme, /MORPH_BASE_API/);
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
	assert.match(readme, /Small exact replacements should use native `edit`/);
	assert.match(readme, /Brand new files should use native `write`/);
	assert.match(readme, /Large files, multi-location edits, and whitespace-sensitive merges should use `morph_fastapply`/);
	assert.match(readme, /prompt-level Morph-first routing guidance without blocking native Pi tools/i);
	assert.match(readme, /~\/\.pi\/agent\/morph\.json/);
	assert.match(readme, /auto-creates that global file on first runtime load/i);
	assert.match(readme, /Installing the package alone does not create the file/);
	assert.match(readme, /routing\.editMode/);
	assert.match(readme, /Morph FastApply-first guidance active: true/);
	assert.match(readme, /Morph-first local search guidance active: true/);
	assert.match(readme, /Morph-first GitHub search guidance active: true/);
	assert.match(readme, /Fallback to native tools: true/);
	assert.match(readme, /not during `pi install`/);
	assert.match(readme, /\/morph_settings/);
	assert.match(
		readme,
		/`\/morph_status` is the main summary view\. Use `\/morph_settings`/i,
	);
	assert.match(readme, /## Editing Policy/);
	assert.match(readme, /## Commands/);
	assert.match(readme, /## Tools/);
	assert.match(readme, /## Hooks And Compaction/);
});
