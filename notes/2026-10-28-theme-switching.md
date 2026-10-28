# Light + dark themes for the mobile client

## Context

The client shipped dark-only. Semantic tokens covered most surfaces, but atmosphere gradients,
markdown/code, user bubbles, skeletons, shadows, sheet scrims, and toasts still used hardcoded dark
colors. A light theme needed both a designed palette and a reliable boot/toggle path.

## Options considered

1. **Tailwind `dark:` variants per component.** Rejected: hundreds of edits, easy to drift, and the
   existing semantic tokens are cleaner than duplicating every style.
2. **Invert the dark palette.** Rejected: warm paper with deep ink needs its own contrast decisions;
   inversion produces muddy borders and a washed-out signal accent.
3. **Theme-scoped CSS variables with `data-theme`.** Chosen: one component tree, one token contract,
   zero per-component theme conditionals.

## Decision

- `html[data-theme="light|dark"]` drives the theme. An inline script in `index.html` resolves
  `localStorage["dsh-mobile.theme"]` or `prefers-color-scheme` before React paints, preventing a
  flash; it also sets the initial `theme-color` and `color-scheme` meta values.
- `ThemeProvider` owns reactive state, persists explicit choices, follows system changes only when
  no explicit choice exists, and updates both meta tags on every change.
- Existing semantic tokens remain the contract. A light block redefines them as warm paper
  (`#efe9dc` page, `#fbf7ec` cards, `#1c211e` ink), and adds tokens for washes, scrims, bubbles,
  code, markdown, skeleton shimmer, atmosphere, and shadows.
- The light accent is deep olive-lime (`#58740f`) with paper foreground (`#fbf7ec`) so the signal
  language keeps AA contrast. Coral, amber, and ice are darkened for light surfaces.
- User messages flip from bone/dark-ink (dark) to deep-ink/paper (light) as the strongest surface.
- Theme controls: a compact `role="switch"` icon in settings, onboarding, connecting, and the
  catalog header (hidden below 360px so the 320px header still fits); a two-option `aria-pressed`
  picker in Settings. All targets are at least 44px.
- Sonner follows the active theme via CSS variables; its close button is repositioned inside.

## Tradeoffs / risks

- Token names (`ink-950`, `bone`) are semantic legacy names, not literal darkness. Renaming would
  touch the whole app for little user value.
- The web manifest is static: installed-PWA splash colors stay dark, while the in-app
  `meta[theme-color]` updates correctly.
- Micro metadata at `text-mute/70` (9px labels) is intentionally quiet and can fall below AA.
- Without localStorage, an explicit choice applies for the session but cannot persist.

## Verification

- `typecheck`, `build`, and `biome check apps/mobile` pass (Vite emits only a chunk-size warning).
- Playwright at 390×844 and 320×700 in both themes covered onboarding, connecting, catalog, chat,
  composer, Settings/MCP, lease sheet, permission sheet, and toast.
- Initial theme followed system light/dark; toggles updated `data-theme`, `meta[theme-color]`,
  `meta[color-scheme]`, and picker `aria-pressed` immediately; reload kept the explicit choice.
- No horizontal overflow; composer left the last timeline block visible; focus rings use the theme
  signal (2px, 3px offset); reduced-motion rules still apply. Normal flows had zero console errors.
- A stored token with no running Bridge produced the expected WebSocket errors on connecting.

## Follow-ups

- Decide static PWA manifest colors (or generate per-theme manifests) and revisit iOS status-bar
  styling.
- Add a lint guard against hardcoded hex/rgba outside `styles.css`, and screenshot regressions.
