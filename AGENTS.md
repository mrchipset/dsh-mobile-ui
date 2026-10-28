# AGENTS.md

Instructions for coding agents in this repository. Prefer code and tests over prose.

## Project

DSH Mobile UI: a mobile-first web client plus a Node bridge for DeepSeek Harness over ACP.

- `packages/protocol` — shared types, zod wire schemas, pure `fold` projection. No Node built-ins.
- `apps/bridge` — Fastify + ws + ACP supervisor + SQLite.
- `apps/mobile` — Vite + React 19 + Tailwind v4 + shadcn-style UI.
- `doc/` — architecture and implementation spec.
- `notes/` — committed design decisions and tradeoffs.

## Commands

- `pnpm install`
- `pnpm dev` — bridge :8787 + mobile :5173
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`, `pnpm format`
- `pnpm build`
- `pnpm smoke:acp` — requires `.env` and a local DSH build

## Verification

- After implementing a feature or fix, add sensible unit tests for testable behavior and make them pass. Cover the happy path plus the important edge cases; do not add tests that only mirror implementation details.
- Run the narrowest relevant test first, then `pnpm test` when the change can affect other packages.
- For UI/design tasks, when the environment allows, start the real dev server and verify with Playwright at 320px and 390×844. Check layout, overflow, safe-area, focus, and the main interactions. Do not claim visual correctness from code alone.
- For Bridge/ACP changes, unit tests do not prove integration. Run `pnpm smoke:acp` against a real DSH build when `.env` is configured.
- Record what was actually verified, and what was not, in the design note and final report.

## Non-negotiables

- TypeScript strict, ESM. No `any`, `@ts-ignore`, or unchecked `JSON.parse` of protocol data.
- `packages/protocol` stays runtime-agnostic: no `node:*` imports.
- Unknown ACP `sessionUpdate` variants must pass through; never throw on them.
- The Bridge fixes `cwd` to `WORKSPACE_ROOT` and always sends `mcpServers: []`.
- Never log prompt text, absolute paths, tokens, env, or full MCP URLs.
- Persist ACP updates before fan-out.
- Validate all device input with zod before use.
- Do not edit another agent's lane without explicit coordination.

## Workflow

1. Read `doc/` and relevant `notes/`.
2. Make a short plan; keep changes scoped.
3. Implement and unit-test together. Add focused tests for new behavior whenever it is testable.
4. Verify: narrow tests, then `pnpm typecheck && pnpm test` (and `pnpm build` when relevant). For UI, exercise the running app with Playwright. For Bridge/ACP, run the real smoke test when configured.
5. Write a design note (below).
6. Commit the coherent milestone (below).
7. Report: changes, verification (including what was not verified), remaining risk.

## Commits (required per milestone)

Commit after each coherent milestone, not only at the end of a large task. A milestone means: feature/fix + unit tests pass + typecheck passes + note written.

- Stage only intended files with `git add <paths>`. Never stage `.env`, `node_modules`, `dist`, `data/`, logs, or unrelated agent work.
- Use Conventional Commits: `feat(bridge): ...`, `fix(mobile): ...`, `test(protocol): ...`, `docs(notes): ...`, `chore: ...`.
- One logical change per commit. Do not rewrite a committed milestone; add a follow-up commit.
- If a check is intentionally deferred, say so in the commit body and note. Do not claim "done".
- Before committing: inspect `git status` and `git diff --staged`, and run the narrowest relevant checks.

## Notes (required)

Every non-trivial change gets a committed note under `notes/`.

- File: `notes/YYYY-MM-DD-<slug>.md` (for example `notes/2026-10-28-lease-state-machine.md`).
- Keep it 20–60 lines. Record:
  - Context / problem
  - Options considered (2–4)
  - Decision and why
  - Tradeoffs / risks / v1 limits
  - Verification (commands + result)
  - Follow-ups
- Append to an existing note when continuing the same design; create a new note for a new decision.
- Start from `notes/TEMPLATE.md`. Notes are part of the deliverable, not optional.

## Delegation (orchestrators)

When dispatching work to a subagent, include:

- exact write scope and non-overlapping ownership
- required verification commands, including unit tests for testable behavior
- for UI work: Playwright verification against the real dev server when the environment allows
- for Bridge/ACP work: the real `pnpm smoke:acp` check when `.env` is configured
- “write a note under `notes/` and commit the milestone when tests pass”
- the expected commit type/scope

Do not accept a delegate's “done” without a commit hash, note path, and verification output. “Builds” is not a substitute for tests or browser verification.

## UI

- Mobile-first. Check 320px width and 390×844; respect safe-area insets; 44px touch targets.
- Preserve designer intent: do not flatten spacing, motion, or hierarchy in follow-up refactors.
- UI copy is Chinese unless the file is documentation.
