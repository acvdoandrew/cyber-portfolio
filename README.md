# Andrew Signal Console

A ground-up redesign of my cyberpunk portfolio. I kept the original terminal voice, but pushed the visuals toward monochrome bitmap transmissions, restrained mauve signal accents, and clearer technical storytelling.

![Signal Console preview](./preview.png)

## Run locally

Requires Bun 1.2.23. Deployment tooling is pinned to Node.js 22.x.

```bash
bun install
bun run dev
```

Open `http://localhost:4321`.

## Production check

```bash
bun run build
bun run preview
```

## Interface notes

- Press `Ctrl+K` (or `Cmd+K`) to open the command deck.
- The CRT filter and emergent signal entity can be toggled in the header; both preferences persist.
- The entity moves through Dormant, Observing, Curious, Inspecting, Thinking, Fragmenting, and Reforming states. Noise, interaction memory, section focus, project hover, scrolling, and inactivity bias transitions rather than timeline loops.
- ENTITY_07 has one session-seeded runtime, bounded perception stream, decaying memory map, attention/behavior controller, and active particle pool across sealed, releasing, free, relocating, returning, and hidden modes. The contained view is a live mask over the global renderer rather than a second entity.
- Three.js/WebGL2 runs the motion field in float-texture ping-pong passes and draws a generated SDF glyph atlas with one instanced call. The ultra pool contains 135,424 glyphs; high/medium/low/mobile/static tiers expose 65,536 / 36,864 / 16,384 / 9,216 / 5,184 active glyphs without rebuilding the runtime.
- A lazily allocated Canvas 2D fallback uses the same runtime, seed, abstract symbolic topology, containment state, gaze, entropy, and interaction memory when WebGL is unavailable. Append `?renderer=canvas` to force this path during development.
- The active path is exposed through `data-renderer="webgl|canvas"`; quality is reported through `data-fx-quality="high|low|static"`, and `data-fx-reason` explains why that mode was selected.
- Append `?quality=ultra|high|medium|low|mobile|static` to lock the entity tier while profiling. Automatic quality changes alter the active prefix of the existing pool and never recreate behavior state.
- Append `?entityDebug=1&skipGate=1` for the development overlay. Add `&entitySeed=707`, `&entityMode=free`, and `&theme=light|dark` for deterministic state, placement, and theme checks.
- Reduced-motion and data-saver visitors receive a static GPU frame or the Canvas fallback without losing content or controls.
- All content and contact links remain available without the command deck or animation effects.
