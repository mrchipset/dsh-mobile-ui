# Bilingual README and MIT license

- Date: 2026-10-28
- Scope: repository root
- Status: implemented

## Context

The project needs a README that works for both Chinese and English readers, plus an explicit open-source license. GitHub and Gitee handle localized READMEs differently.

## Options

1. One bilingual README with both languages — simple, but long and not automatically selected by either platform.
2. `README.md` (English) + `README.zh-CN.md` (Chinese) with a language switcher — Gitee selects by browser language; GitHub keeps English and links to Chinese.
3. An HTML redirect — not rendered or supported by GitHub README pages.

## Decision

Use option 2. `README.md` is the English landing page and Gitee English fallback; `README.zh-CN.md` is the Chinese version. Both start with a switcher and keep identical structure, commands, environment variable names, and links.

Add the standard MIT license with copyright `2026 Zouyu`, and declare `"license": "MIT"` in the root `package.json`.

Positioning: the project is explicitly framed as a **demo mobile UI**, not a production client. The README introduction, Chinese introduction, and root package description all state this.

## Tradeoffs / risks

- GitHub cannot auto-switch README language; the switcher is the only path to Chinese there.
- Gitee auto-selection depends on the viewer's browser language, not repository settings.
- The two READMEs must be updated together when features or commands change.
- The copyright holder may need a legal name; `Zouyu` is the current project owner label.

## Verification

- `README.md`, `README.zh-CN.md`, and `LICENSE` exist and decode as strict UTF-8 with no replacement characters.
- Both language switchers link to the other file.
- Commands, paths, environment variables, and code blocks match between versions.
- `package.json` parses with the MIT license field.
- `git diff --check` reports no whitespace errors.
- Not verified: GitHub/Gitee remote rendering (no remote is configured yet).

## Follow-ups

- Update the copyright holder if a different legal name is required.
- Keep both READMEs in sync; push to both remotes when they are configured.
