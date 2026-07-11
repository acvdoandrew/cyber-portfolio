# Andrew Signal Console

A ground-up redesign of Andrew's cyberpunk portfolio. The build keeps the original terminal voice while shifting the visual language toward monochrome bitmap transmission, restrained mauve signal accents, and accessible technical storytelling.

![Signal Console preview](./preview.png)

## Run locally

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:4321`.

## Production check

```bash
npm run build
npm run preview
```

## Interface notes

- Press `Ctrl+K` (or `Cmd+K`) to open the command deck.
- The CRT filter and roaming Watcher can be toggled in the header; both preferences persist.
- Three.js/WebGL2 renders the Watcher, procedural capture plates, project portals, dithering, and feedback effects on supported hardware.
- A Canvas 2D renderer preserves the full containment/release interaction when WebGL is unavailable. Append `?renderer=canvas` to force this path during development.
- The active path is exposed through `data-renderer="webgl|canvas"`; quality is reported through `data-fx-quality="high|low|static"`.
- Reduced-motion and data-saver visitors receive a static GPU frame or the Canvas fallback without losing content or controls.
- All content and contact links remain available without the command deck or animation effects.
