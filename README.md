# Andrew / Minimal Signal

A minimal portfolio for Andrew’s systems and AI work. Self-hosted IBM Plex Mono, four
procedural 1-bit project animations, and a live WebGL2 recursive field.
The connected hero, pinned Work → Stack sequence, and Contact reveal share the
existing scroll runtime. CRT remains available as an optional display filter.

## Run locally

Requires Bun 1.2.23. Deployment tooling is pinned to Node.js 22.x.

```bash
bun install
bun run dev
```

Open the URL Astro prints in the terminal.

## Verify

```bash
bun run build
bun test
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
the live portfolio. The run also asserts six contained canvases, no horizontal overflow, and
CLS below 0.05.

## Implementation notes

- Palette choice persists to `portfolio.palette.v1` and is exposed through
  `html[data-palette]`.
- The hero fills the opening viewport beneath a fixed masthead. Its type and
  recursive field move subtly with page scroll before a wide paper card rises
  from the surrounding field.
- Desktop body scroll pins that card and translates the Work → Stack track
  through its clipped viewport. At the end, the paper card lifts away while a
  separate dark Contact scene fades in underneath it. There is no nested
  scrollbar or wheel capture.
- Mobile widths and reduced-motion preferences restore direct document flow,
  preserving the same Work → Stack → Contact order without pinned transforms.
- Work is a personal notebook of four projects, with notes beside procedural
  pixel studies. Each study uses the hero’s ordered 4×4 Bayer threshold and
  the active palette’s ink and paper. All pixels are either ink or transparent.
- The studies show an evolving isometric settlement, rerouting network packets,
  bounded particles, and converging token streams. They are illustrative studies,
  not live project telemetry. One shared 24 fps scheduler draws only visible
  studies, suspends in the background, and honors reduced motion / data saver.
  “Pause studies” freezes all four. The connected scroll sequence is unchanged.
- `src/scripts/project-studies/` owns the drawings, dithering, and shared runtime.
  Run `bun run art:studies` to rebuild tiny static PNG masks from the same code
  for use when JavaScript is unavailable. The superseded generated renders are
  retained in `artwork-source/project-studies/` and are not displayed.
- Project source links and three-step system notes remain available under
  “notes.” The scroll runtime remeasures when those details expand.
- The default Archive palette uses pale paper, charcoal type, and a rust
  accent. All six palette options and saved preferences remain available.
- CRT is off for first-time visitors; existing saved choices are respected.
- Contact is a small terminal that types `cat contact.txt` and the real contact
  links. Typing runs once on entry, can be skipped or replayed, suspends offscreen,
  and completes immediately for reduced motion or keyboard focus on a link.
  The links remain semantic anchors throughout; no text is sent anywhere.
- Contact’s `ENTITY_08` keeps the procedural face and dithered point model in a
  new leaning pose. Both hands rest over the terminal rim, the body is occluded
  behind the window, and the head follows typing or the cursor. Its native
  384×256 drawing uses the same 4×4 Bayer threshold as the project studies.
- `src/scripts/intelligence-geometry.ts` contains both portrait and terminal
  poses. `contact-intelligence.ts` owns motion and `contact-terminal.ts` owns
  typing. The connected scroll reveal and art pause remain available.
  `bun run art:intelligence` regenerates both static fallback masks.
- The previous image-based contact artwork remains archived in
  `artwork-source/contact-intelligence/`; it is no longer displayed.
- `src/data/portfolio.ts` is the single typed source for project, stack,
  palette, and contact data.
- `src/scripts/recursive-field.ts` owns the hero canvas. It caps DPR and
  buffer size, adapts resolution, pauses offscreen or when hidden, renders one
  deterministic frame for reduced motion, and falls back to a pre-rendered
  poster for WebGL failure, data saver, or context loss.
- `scripts/generate-dither-assets.mjs` deterministically rebuilds four
  procedural study masks, four ambient engravings, four accurate project
  plates, the recursive poster, the `ENTITY_08` mask, and the optimized social
  card. The transparent art masks share one 4×4 Bayer pipeline.
- Licensed Bodoni Moda and IBM Plex Mono files and their OFL notices are
  self-hosted under `public/fonts/`.
- Original generated sources and unverified legacy watcher artwork live outside
  `public/` under `artwork-source/`.

Vercel deploys the production site from `main`.
