# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
