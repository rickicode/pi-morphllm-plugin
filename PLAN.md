# Plan: Plugin Morph untuk Pi Coding Agent / pi.dev

## Context

- Tujuan: membuat plugin bergaya `opencode-morph-plugin`, tetapi untuk Pi Coding Agent / `pi.dev`.
- Target implementasi sekarang jelas: repo baru dari nol, bukan menempel ke repo yang sudah ada.
- Scope v1 sudah disetujui: lengkap seperti referensi, mencakup `morph_edit`, `warpgrep_codebase_search`, `warpgrep_github_search`, dan compaction.
- Kebutuhan utama yang sudah jelas: dukungan `custom base URL` / `custom base API` untuk Morph.
- Dari dokumentasi Pi, bentuk integrasi yang paling tepat adalah extension/package TypeScript yang mendaftarkan custom tools via `pi.registerTool()` dan bisa di-auto-discover dari `.pi/extensions/` atau dipaketkan sebagai Pi package.

## Approach

- Bangun repo baru sebagai Pi package/extension TypeScript dengan satu entry extension yang meniru alur `opencode-morph-plugin`: register tools Morph, tambahkan prompt guidance, dan expose konfigurasi lewat environment variables.
- Pertahankan perilaku default seperti referensi: `MORPH_API_KEY` wajib untuk tool remote, tool bisa diaktif/nonaktifkan via feature flags, dan request Morph lewat client SDK yang sama.
- Tambahkan lapisan konfigurasi endpoint Morph yang eksplisit untuk Pi, misalnya `MORPH_BASE_URL` / `MORPH_BASE_API`, lalu teruskan override itu ke semua client Morph (`MorphClient`, `WarpGrepClient`, `CompactClient`) tanpa memecah fallback ke `https://api.morphllm.com`.
- Map konsep OpenCode ke event Pi yang paling dekat: `pi.registerTool()` untuk ekspos tool, `promptSnippet`/`promptGuidelines` plus `before_agent_start` untuk routing hint, `tool_call`/`tool_result` untuk guard dan rendering metadata, serta `session_before_compact` atau `context` untuk integrasi compaction kustom.
- Karena Pi mendukung TypeScript extension via jiti dan Pi package manifest, repo akan dirancang agar bisa dipakai dua mode: lokal via `pi -e` untuk pengembangan, dan installable package via `pi install` untuk distribusi.

## Files to modify

- `PLAN.md`
- `package.json` dengan manifest `pi`, dependency Morph SDK, peer dependency Pi, dan metadata package.
- `extensions/morph/index.ts` sebagai entry extension utama.
- File helper seperti `extensions/morph/config.ts`, `extensions/morph/tools.ts`, atau `extensions/morph/compact.ts` bila implementasi dipecah.
- `README.md` untuk instalasi, env var, custom base URL/API, dan contoh penggunaan.
- `skills/` atau `prompts/` untuk policy/routing guidance bila dipilih sebagai resource terpisah.
- Test file setara `index.test.ts` untuk config, tool registration, dan compaction hooks.

## Reuse

- `morphllm/opencode-morph-plugin/index.ts`: pola registrasi plugin, definisi tool `morph_edit`, `warpgrep_codebase_search`, `warpgrep_github_search`, feature flags, runtime hints, override `morphApiUrl` per request, dan alur compaction dengan `CompactClient`.
- `morphllm/opencode-morph-plugin/index.test.ts`: pola pengujian env-based config, tool exposure, validasi perilaku hook/plugin, serta helper test untuk compaction dan normalisasi input.
- `morphllm/opencode-morph-plugin/README.md`: pola instalasi, registrasi plugin, daftar env var, dan verifikasi manual.
- `pi.dev` docs `Extensions`: `pi.registerTool()`, `promptSnippet`, `promptGuidelines`, `before_agent_start`, `context`, `tool_call`, `tool_result`, `session_before_compact`, `withFileMutationQueue`, dan mekanisme override built-in tools.
- `pi.dev` docs `Pi Packages`: manifest `pi` di `package.json`, struktur package, dependency strategy, dan jalur distribusi `pi install`.
- `pi.dev` docs `SDK`: cara load extension lewat `DefaultResourceLoader` dan jalur pengujian programatik untuk session/tool lifecycle.
- Reuse lokal belum ada karena workspace masih kosong.

## Steps

- [x] Baca referensi plugin Morph dan catat pola integrasinya.
- [x] Tentukan target implementasi: scaffold repo baru untuk Pi package/extension.
- [x] Putuskan scope v1: lengkap seperti referensi, termasuk compaction.
- [ ] Definisikan kontrak konfigurasi endpoint Morph untuk Pi: default `https://api.morphllm.com`, plus override `MORPH_BASE_URL` / `MORPH_BASE_API` yang dipakai konsisten di semua tool.
- [ ] Tentukan struktur repo final: package installable dengan manifest `pi`, entry extension di `extensions/morph/index.ts`, dan helper modules untuk tools/config/compaction.
- [ ] Implementasikan tool `morph_edit`, `warpgrep_codebase_search`, dan `warpgrep_github_search` sebagai custom tools Pi, termasuk prompt metadata dan guard yang relevan.
- [ ] Implementasikan compaction integration dengan event Pi yang paling cocok, sambil menjaga perilaku aman saat `MORPH_API_KEY` tidak tersedia atau saat compact gagal.
- [ ] Tambahkan prompt guidance/routing hints agar Pi lebih memilih tool Morph pada kasus yang sama seperti referensi.
- [ ] Tambahkan dokumentasi setup, pengembangan lokal via `pi -e`, instalasi package via `pi install`, dan contoh konfigurasi custom endpoint.
- [ ] Tambahkan test untuk default endpoint, custom endpoint, tool registration, loading extension, dan perilaku compaction.

## Verification

- Verifikasi package bisa dimuat sebagai extension Pi, baik lewat `pi -e` maupun lewat manifest package.
- Verifikasi tool `morph_edit`, `warpgrep_codebase_search`, dan `warpgrep_github_search` terdaftar dan aktif di session Pi.
- Verifikasi config default tetap mengarah ke `https://api.morphllm.com`.
- Verifikasi override `baseUrl` / `baseApi` dipropagasikan ke `MorphClient`, `WarpGrepClient`, dan `CompactClient`.
- Verifikasi compaction custom hanya aktif saat konfigurasi memenuhi syarat, dan fallback aman saat API gagal.
- Verifikasi request auth/header/body tetap kompatibel dengan API Morph yang dituju.
- Verifikasi dokumentasi instalasi dan contoh env untuk custom endpoint bisa diikuti end-to-end.
