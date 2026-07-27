# Andrew / Minimal Signal

An alternate, editorial homepage for Andrew’s systems and AI portfolio. This
branch keeps the existing project and contact facts while replacing the former
terminal HUD with a sparse research-plate interface, ordered 1-bit artwork, and
one contained raw-WebGL2 recursive field.

![Six palette studies](./artifacts/visual-regression/hero-palettes-contact-sheet.png)

## Run locally

Requires Bun 1.2.23. Deployment tooling is pinned to Node.js 22.x.

```bash
bun install
bun run dev
```

Open the URL Astro prints in the terminal.

## Verify

```bash
bun test
bun run build
bun run preview
```

The regression capture script expects a local preview at
`http://127.0.0.1:4325/` by default. Override it with
`PORTFOLIO_PREVIEW_URL` when needed.

```bash
bun run visual:regression
```

It captures all six 1280×720 hero palettes; complete `archive` and `carbon`
pages at 1440, 768, 390, and 320px widths; and desktop/mobile comparisons with
the live portfolio. The run also asserts one canvas, no horizontal overflow, and
CLS below 0.05.

## Implementation notes

- Palette choice persists to `portfolio.palette.v1` and is exposed through
  `html[data-palette]`.
- The centered outer frame is the continuous field. Work and Contact dissolve
  into it, while the hero, project preview, and Stack become deliberate paper
  objects instead of four equally boxed sections.
- `ENTITY_07` is a static, non-interactive engraving in Contact. There is no
  roaming entity, cage, animation runtime, or second canvas.
- `src/data/portfolio.ts` is the single typed source for project, stack,
  palette, and contact data.
- `src/scripts/recursive-field.ts` owns the only live canvas. It caps DPR and
  buffer size, adapts resolution, pauses offscreen or when hidden, renders one
  deterministic frame for reduced motion, and falls back to a pre-rendered
  poster for WebGL failure, data saver, or context loss.
- `scripts/generate-dither-assets.mjs` deterministically rebuilds four original
  project engravings, their four technical underlays, the recursive poster, the
  `ENTITY_07` mask, and the optimized social card. The transparent art masks
  share one 4×4 Bayer pipeline.
- Licensed Bodoni Moda and IBM Plex Mono files and their OFL notices are
  self-hosted under `public/fonts/`.
- Original generated sources and unverified legacy watcher artwork live outside
  `public/` under `artwork-source/`.

This branch is a comparison artifact only; it does not deploy or alter the live
site by itself.
