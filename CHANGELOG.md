# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.6] - 2026-05-03

### Changed
- Manual `/morph-compact` now reports a clear warning when there are no older messages available to compact instead of surfacing a raw extension stack trace.
- Added test coverage for graceful manual compaction error handling.
- Bumped the package and internal plugin version to `0.1.6`.

## [0.1.5] - 2026-05-03

### Changed
- Added plugin version output to `/morph_status` so the active Morph plugin build is visible in the status summary.
- Added `/morph_selftest` to run real end-to-end checks for the Morph API probe, FastApply, local WarpGrep, GitHub WarpGrep, and compact using temporary files and sample queries.
- Tightened the GitHub self-test so it now requires actual `package.json` metadata to be found instead of treating any successful response as a pass.
- Bumped the package and internal plugin version to `0.1.5`.

## [0.1.4] - 2026-05-03

### Changed
- Switched the plugin to file-only configuration and removed runtime environment variable support so Morph settings always come from JSON config files.
- Added a live Morph API probe to `/morph_status`, including clearer failure categories for authentication, timeout, and network/base URL errors.
- Simplified manual compaction semantics so `/morph-compact` is always strict and Morph-only, while automatic compaction remains Morph-first with Pi fallback.
- Removed the `routing.forceMorphCompactCommand` setting from runtime config, interactive settings, tests, and documentation.
- Updated package metadata so the published author is `rickicode`.
- Bumped the package and internal plugin version to `0.1.4`.

## [0.1.3] - 2026-05-03

### Changed
- Removed `baseUrl` from generated default Morph config files so custom endpoints are only written when explicitly configured.
- Kept runtime fallback to the default Morph endpoint when no `baseUrl` override is provided.
- Renamed the default multi-key file from `~/.pi/agent/morph.txt` to `~/.pi/agent/morph.env` in runtime defaults, examples, and documentation.
- Renamed compaction config from `compactEnabled` to `autoCompactEnabled` and renamed related environment variables from `MORPH_COMPACT*` to `MORPH_AUTO_COMPACT*` across runtime code, docs, examples, and tests.
- Made `autoCompactEnabled` control automatic Morph compaction only, so disabling it stops auto Morph compaction without disabling the manual `/morph-compact` command.
- Kept automatic compaction Morph-first with Pi fallback when `autoCompactEnabled` is on.
- Kept `/morph-compact` strict and Morph-only, so the command still fails loudly instead of falling back to Pi compaction when Morph cannot be used.

## [0.1.2] - 2026-05-03

### Changed
- Improved package metadata for `pi.dev/packages` with a clearer description, bundled image assets, and `pi.image`.
- Updated `README.md` to use the published FastApply preview image URL.

## [0.1.1] - 2026-05-03

### Changed
- Bumped package version from `0.1.0` to `0.1.1`.
