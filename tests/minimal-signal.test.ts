import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  capabilities,
  paletteOrder,
  palettes,
  projects,
} from '../src/data/portfolio';

const root = join(import.meta.dir, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

const pngDimensions = (path: string) => {
  const bytes = readFileSync(join(root, path));
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
};

describe('minimal signal document', () => {
  test('the active page is the direct editorial experience', () => {
    const page = source('src/pages/index.astro');
    const layout = source('src/layouts/BaseLayout.astro');

    expect(page).toContain("import AmbientField from '../components/AmbientField.astro'");
    expect(page).toContain('<div class="site-frame" data-site-frame>');
    expect(page).toContain('<AmbientField />');
    expect(page).toContain('<TopBar />');
    expect(page).toContain('<Hero />');
    expect(page).toContain('<Projects />');
    expect(page).toContain('<Capabilities />');
    expect(page).toContain('<Contact />');
    expect(page).not.toMatch(/Principles|CommandDeck|welcome|entry gate/i);

    expect(layout).toContain("import '../styles/editorial.css'");
    expect(layout).not.toMatch(/global\.css|minimal\.css/);
    expect(layout).not.toMatch(
      /signal-compositor|gpu-stage|braille-entity|signal-rain|crt-layer|noise-layer/,
    );
    expect(layout).not.toMatch(
      /compositor\.js|interface\.js|gpu-runtime|entity\/canvas-renderer|three-adapter/,
    );
    expect(source('package.json')).not.toMatch(/"three"|"@types\/three"/);
  });

  test('there is exactly one contained live canvas in the active component graph', () => {
    const activeSources = [
      source('src/pages/index.astro'),
      source('src/layouts/BaseLayout.astro'),
      source('src/components/Hero.astro'),
      source('src/components/Projects.astro'),
      source('src/components/Capabilities.astro'),
      source('src/components/Contact.astro'),
      source('src/components/TopBar.astro'),
      source('src/components/Footer.astro'),
      source('src/components/AmbientField.astro'),
    ].join('\n');

    expect((activeSources.match(/<canvas/g) ?? []).length).toBe(1);
    expect((activeSources.match(/data-recursive-field/g) ?? []).length).toBe(1);
    expect(activeSources).not.toMatch(/from ['"]three['"]|gpu-runtime|entity-runtime/);
    expect(activeSources).not.toMatch(/roaming-layer|data-roaming|roaming-entity/);
  });

  test('heading structure, skip link, landmarks, and figure text are explicit', () => {
    const page = source('src/pages/index.astro');
    const layout = source('src/layouts/BaseLayout.astro');
    const hero = source('src/components/Hero.astro');
    const projectsSource = source('src/components/Projects.astro');
    const capabilitiesSource = source('src/components/Capabilities.astro');
    const contact = source('src/components/Contact.astro');
    const ambient = source('src/components/AmbientField.astro');

    expect(layout).toContain('href="#main-content"');
    expect(page).toContain('<main id="main-content" tabindex="-1">');
    expect(hero).toContain('<h1 id="hero-title">');
    expect(projectsSource).toContain('<h2 id="work-title">');
    expect(capabilitiesSource).toContain('<h2 id="capabilities-title">');
    expect(contact).toContain('<h2 id="contact-title">');
    expect(hero).toContain('aria-label="Live ordered 1-bit recursive field visualization"');
    expect(hero).toContain('alt="Ordered 1-bit study of a folded recursive field');
    expect(ambient.match(/aria-hidden="true"/g)).toHaveLength(1);
    expect(contact).not.toMatch(/entity-cameo|signal cartographer/i);
  });
});

describe('typed portfolio data', () => {
  test('all six palettes match the current semantic anchors and order', () => {
    expect(paletteOrder).toEqual([
      'archive',
      'carbon',
      'signal',
      'radiant',
      'field',
      'alloy',
    ]);
    expect(
      palettes.map(({ id, paper, ink, accent }) => ({
        id,
        paper: paper.toUpperCase(),
        ink: ink.toUpperCase(),
        accent: accent.toUpperCase(),
      })),
    ).toEqual([
      { id: 'archive', paper: '#E7E4DC', ink: '#182521', accent: '#8E2148' },
      { id: 'carbon', paper: '#090A09', ink: '#F0EEE2', accent: '#D85D3F' },
      { id: 'signal', paper: '#050806', ink: '#E6F2E9', accent: '#00D985' },
      { id: 'radiant', paper: '#0B0905', ink: '#F2D66C', accent: '#F05A2A' },
      { id: 'field', paper: '#061008', ink: '#9FD19D', accent: '#D6F06C' },
      { id: 'alloy', paper: '#B4BCC1', ink: '#111314', accent: '#D14E32' },
    ]);
  });

  test('project copy, status, links, and artwork stay centralized and truthful', () => {
    expect(projects.map((project) => project.title)).toEqual([
      'ARES',
      'Rust Edge Compute Node',
      'High-Performance Physics Engine',
      'Speculative Inference Proxy',
    ]);
    expect(projects[0].links).toEqual([]);
    expect(projects[0].summary).toMatch(/eight passing tests/);
    expect(projects[1].links[0].href).toBe(
      'https://github.com/acvdoandrew/rust-edge-compute',
    );
    expect(projects[2].links[0].href).toBe(
      'https://github.com/acvdoandrew/high-performance-physics-engine',
    );
    expect(projects[3].links[0].href).toBe(
      'https://github.com/acvdoandrew/speculative-inference-proxy',
    );
    expect(projects.every((project) => project.artwork.kind === 'mask')).toBe(true);
    expect(
      projects.every((project) =>
        project.artwork.src?.startsWith('/assets/dither/'),
      ),
    ).toBe(true);
    expect(
      projects.every((project) =>
        project.artwork.underlaySrc?.startsWith('/assets/dither/'),
      ),
    ).toBe(true);
    expect(
      projects.every(
        (project) => project.artwork.src !== project.artwork.underlaySrc,
      ),
    ).toBe(true);
    expect(
      projects.map(({ artwork }) => ({
        src: artwork.src,
        underlaySrc: artwork.underlaySrc,
      })),
    ).toEqual([
      {
        src: '/assets/dither/ares-frontier-engraving.png',
        underlaySrc: '/assets/dither/ares-frontier.png',
      },
      {
        src: '/assets/dither/edge-node-engraving.png',
        underlaySrc: '/assets/dither/edge-network.png',
      },
      {
        src: '/assets/dither/physics-engine-engraving.png',
        underlaySrc: '/assets/dither/physics-particles.png',
      },
      {
        src: '/assets/dither/inference-proxy-engraving.png',
        underlaySrc: '/assets/dither/inference-latency.png',
      },
    ]);
    expect(
      projects.every((project) => /1-bit engraved/i.test(project.artwork.alt)),
    ).toBe(true);
  });

  test('capabilities remain a compact five-row index', () => {
    expect(capabilities).toHaveLength(5);
    expect(capabilities.map((capability) => capability.title)).toEqual([
      'Systems programming',
      'AI infrastructure',
      'Distributed infrastructure',
      'Security labs',
      'Interfaces',
    ]);
  });

  test('visible copy keeps the original build-log voice', () => {
    const visibleCopy = [
      source('src/components/Hero.astro'),
      source('src/components/Projects.astro'),
      source('src/components/Capabilities.astro'),
      source('src/components/Contact.astro'),
    ].join('\n');

    expect(visibleCopy).toContain('Built, broken, still running.');
    expect(visibleCopy).toContain('The source is there. So are the rough edges.');
    expect(visibleCopy).toContain('What I use to build.');
    expect(visibleCopy).toContain('Email me.');
    expect(visibleCopy).not.toMatch(
      /compact index|tools are indexed|a direct line|explore selected work|email andrew/i,
    );
  });
});

describe('centered frame and static ambient artwork', () => {
  const page = source('src/pages/index.astro');
  const ambient = source('src/components/AmbientField.astro');
  const contact = source('src/components/Contact.astro');
  const css = source('src/styles/editorial.css');

  test('the page is centered inside one semantic outer frame', () => {
    expect(page.indexOf('<AmbientField />')).toBeLessThan(
      page.indexOf('<TopBar />'),
    );
    expect(css).toMatch(
      /\.site-frame\s*\{[\s\S]*?isolation:\s*isolate;[\s\S]*?width:\s*min\([^;]+;[\s\S]*?border:\s*1px solid var\(--frame-accent\)/,
    );
    expect(css).toMatch(
      /body\s*\{[\s\S]*?padding:\s*var\(--frame-gap\);[\s\S]*?background:\s*var\(--frame-field\)/,
    );
    expect(css).toMatch(
      /\.site-frame > main,[\s\S]*?\.site-frame > \.site-footer\s*\{[\s\S]*?z-index:\s*1;/,
    );
    expect(css).not.toMatch(/\.site-frame\s*\{[^}]*overflow:/);
  });

  test('the ambient field contains only static decorative engravings', () => {
    expect(ambient.match(/aria-hidden="true"/g)).toHaveLength(1);
    expect(ambient.match(/class="ambient-engraving /g)).toHaveLength(3);
    expect(ambient).not.toMatch(
      /<(?:a|button|canvas|input|script|select|textarea)\b|tabindex=|role=|data-roaming|roaming-layer|roaming-entity/i,
    );
    expect(css).toMatch(
      /\.ambient-engraving-field\s*\{[\s\S]*?z-index:\s*0;[\s\S]*?pointer-events:\s*none;/,
    );
    expect(css).toContain(
      "url('/assets/dither/ares-frontier-engraving.png')",
    );
    expect(css).toContain(
      "url('/assets/dither/edge-node-engraving.png')",
    );
    expect(css).toContain(
      "url('/assets/dither/physics-engine-engraving.png')",
    );
    expect(css).not.toMatch(/\.roaming-|data-roaming/);
    expect(existsSync(join(root, 'src/scripts/roaming-entity.ts'))).toBe(false);

    const ambientRule =
      css.match(/\.ambient-engraving\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(ambientRule).not.toMatch(/animation|transition/);
  });

  test('ENTITY_07 is a static, uncaged Contact engraving', () => {
    expect(contact).not.toMatch(
      /entity-07|signal cartographer|data-roaming|<figure|<canvas/i,
    );
    expect(css).toMatch(
      /\.contact-section::before\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?pointer-events:\s*none;[\s\S]*?url\('\/assets\/dither\/entity-07-signal-cartographer\.png'\)/,
    );
    const entityRule =
      css.match(/\.contact-section::before\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(entityRule).not.toMatch(/animation|transition|border:/);
  });

  test('work and contact merge into the frame field around an inset paper box', () => {
    expect(page.indexOf('<Projects />')).toBeLessThan(
      page.indexOf('<Capabilities />'),
    );
    expect(page.indexOf('<Capabilities />')).toBeLessThan(
      page.indexOf('<Contact />'),
    );

    const fieldSections =
      css.match(
        /\.work-section,\s*\.contact-section\s*\{([\s\S]*?)\}/,
      )?.[1] ?? '';
    expect(fieldSections).toMatch(/color:\s*var\(--frame-ink\)/);
    expect(fieldSections).not.toMatch(/background/);
    expect(css).toMatch(
      /\.capabilities-section\s*\{[\s\S]*?width:\s*min\(calc\(100% - var\(--stage-inset\) \* 2\), var\(--content-width\)\);[\s\S]*?margin:\s*var\(--stage-inset\) auto;[\s\S]*?border:\s*1px solid var\(--rule\);[\s\S]*?background:\s*var\(--paper\)/,
    );
  });

  test('static engravings scale down on mobile and disappear in forced colors', () => {
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.ambient-engraving\s*\{[\s\S]*?width:\s*110%;[\s\S]*?opacity:\s*0\.024;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.contact-section::before\s*\{[\s\S]*?width:\s*min\(76vw, 20rem\);[\s\S]*?opacity:\s*0\.06;/,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.ambient-engraving-field\s*\{[\s\S]*?display:\s*none;[\s\S]*?\.contact-section::before\s*\{[\s\S]*?content:\s*none;/,
    );
  });
});

describe('palette interface', () => {
  test('palette cycling persists, updates metadata, and announces current and next', () => {
    const runtime = source('src/scripts/editorial-interface.ts');
    const layout = source('src/layouts/BaseLayout.astro');

    expect(runtime).toContain("const STORAGE_KEY = 'portfolio.palette.v1'");
    expect(runtime).toMatch(/document\.documentElement\.dataset\.palette/);
    expect(runtime).toMatch(/meta\[name="theme-color"\]/);
    expect(runtime).toMatch(/meta\[name="color-scheme"\]/);
    expect(runtime).toContain('Current palette ${id}. Activate for ${next}.');
    expect(runtime).toMatch(/event\.key !== 'Enter' && event\.key !== ' '/);
    expect(runtime).toMatch(/new CustomEvent\('palettechange'/);
    expect(layout).toContain('data-palette="archive"');
    expect(layout).toContain("localStorage.getItem('portfolio.palette.v1')");
    expect(source('src/styles/editorial.css')).toMatch(
      /html\[data-palette='alloy'\][\s\S]*?--accent-readable:/,
    );
  });

  test('project preview parity covers hover, focus, click, and arrow keys', () => {
    const runtime = source('src/scripts/editorial-interface.ts');
    const projectsSource = source('src/components/Projects.astro');

    expect(runtime).toMatch(/addEventListener\('pointerenter'/);
    expect(runtime).toMatch(/addEventListener\('focus'/);
    expect(runtime).toMatch(/addEventListener\('click'/);
    expect(runtime).toMatch(/ArrowDown|ArrowUp/);
    expect(projectsSource).toContain('role="list"');
    expect(projectsSource).toContain('role="region"');
    expect(projectsSource).toContain('aria-pressed=');
  });
});

describe('recursive field runtime', () => {
  const shader = source('src/scripts/recursive-field.ts');

  test('ports the inverse-fold field and ordered Bayer threshold into raw WebGL2', () => {
    expect(shader).toContain("canvas[data-recursive-field]");
    expect(shader).toContain("getContext('webgl2'");
    expect(shader).toMatch(/position = abs\(position\)/);
    expect(shader).toMatch(
      /position \/ clamp\(dot\(position, position\), 0\.12, 4\.0\)/,
    );
    expect(shader).toContain('float bayer4(vec2 pixel)');
    expect(shader).toContain('bayer4(fragment) * 0.86 + 0.07');
    expect(shader).toContain('const POINTER_DISPLACEMENT = 0.055');
  });

  test('keeps the render small, capped, and adaptive', () => {
    expect(shader).toContain('const MAX_DPR = 1.25');
    expect(shader).toContain('const MAX_BUFFER_EDGE = 960');
    expect(shader).toContain('const STANDARD_RENDER_SCALE = 0.64');
    expect(shader).toContain("type FieldQuality = 'standard' | 'reduced'");
    expect(shader).toMatch(/slowFrames/);
  });

  test('pauses or falls back for every requested lifecycle constraint', () => {
    expect(shader).toMatch(/IntersectionObserver/);
    expect(shader).toMatch(/visibilitychange/);
    expect(shader).toMatch(/prefers-reduced-motion: reduce/);
    expect(shader).toMatch(/saveData/);
    expect(shader).toMatch(/webglcontextlost/);
    expect(shader).toMatch(/webglcontextrestored/);
    expect(shader).toContain('STATIC_TIME_SECONDS = 8');
    expect(shader).toMatch(/palettechange/);
    expect(shader).toMatch(/programBuilds/);
  });
});

describe('art and typography assets', () => {
  const expectedMasks = [
    ['public/assets/dither/ares-frontier.png', 960, 640],
    ['public/assets/dither/edge-network.png', 960, 640],
    ['public/assets/dither/physics-particles.png', 960, 640],
    ['public/assets/dither/inference-latency.png', 960, 640],
    ['public/assets/dither/ares-frontier-engraving.png', 960, 640],
    ['public/assets/dither/edge-node-engraving.png', 960, 640],
    ['public/assets/dither/physics-engine-engraving.png', 960, 640],
    ['public/assets/dither/inference-proxy-engraving.png', 960, 640],
    ['public/assets/dither/entity-07-signal-cartographer.png', 800, 1000],
    ['public/assets/dither/recursive-field-poster.png', 640, 480],
  ] as const;

  test('all deterministic masks exist at the expected dimensions below 250 KB', () => {
    for (const [path, width, height] of expectedMasks) {
      expect(existsSync(join(root, path))).toBe(true);
      expect(statSync(join(root, path)).size).toBeLessThan(250 * 1024);
      expect(pngDimensions(path)).toEqual({ width, height });
    }
    expect(source('scripts/generate-dither-assets.mjs')).toMatch(
      /BAYER_4X4|bayer/i,
    );
  });

  test('project engravings preserve their sources and technical underlays', () => {
    const illustrationSources = [
      'ares-frontier-engraving-source.png',
      'edge-node-engraving-source.png',
      'physics-engine-engraving-source.png',
      'inference-proxy-engraving-source.png',
    ];
    for (const filename of illustrationSources) {
      expect(
        existsSync(
          join(root, 'artwork-source/project-illustrations', filename),
        ),
      ).toBe(true);
      expect(
        existsSync(join(root, 'public/assets/source', filename)),
      ).toBe(false);
    }

    const generator = source('scripts/generate-dither-assets.mjs');
    const figure = source('src/components/ResearchFigure.astro');
    const projectsSource = source('src/components/Projects.astro');

    expect(generator).toContain('drawProjectEngraving');
    expect(generator).toContain("'project-illustrations'");
    expect(figure).toContain('artwork.underlaySrc');
    expect(figure).toContain('research-figure__technical-mask');
    expect(figure).toMatch(
      /\.research-figure__technical-mask\s*\{[\s\S]*?z-index:\s*1;[\s\S]*?opacity:\s*0\.18;/,
    );
    expect(figure).toMatch(
      /\.research-figure__mask\s*\{[\s\S]*?z-index:\s*2;/,
    );
    expect(projectsSource).toContain(
      'variant={project.id as ResearchFigureVariant}',
    );
  });

  test('the original ENTITY_07 source is preserved but not publicly shipped', () => {
    expect(
      existsSync(join(root, 'artwork-source/entity-07-signal-cartographer.png')),
    ).toBe(true);
    expect(
      existsSync(
        join(root, 'public/assets/source/entity-07-signal-cartographer.png'),
      ),
    ).toBe(false);
  });

  test('the bespoke social card is wired at the expected dimensions', () => {
    expect(pngDimensions('public/og.png')).toEqual({
      width: 1200,
      height: 630,
    });
    expect(statSync(join(root, 'public/og.png')).size).toBeLessThan(250 * 1024);
    const layout = source('src/layouts/BaseLayout.astro');
    expect(layout).toContain("new URL('/og.png', Astro.site)");
    expect(layout).toContain('content="1200"');
    expect(layout).toContain('content="630"');
  });

  test('licensed Bodoni Moda and IBM Plex Mono are self-hosted', () => {
    const css = source('src/styles/editorial.css');
    const fonts = [
      'public/fonts/BodoniModa-Variable-Latin.woff2',
      'public/fonts/IBMPlexMono-Regular-Latin.woff2',
      'public/fonts/IBMPlexMono-Medium-Latin.woff2',
      'public/fonts/IBMPlexMono-SemiBold-Latin.woff2',
    ];

    for (const font of fonts) {
      expect(existsSync(join(root, font))).toBe(true);
      expect(statSync(join(root, font)).size).toBeLessThan(100 * 1024);
    }
    expect(css).toMatch(/font-family: 'Bodoni Moda'/);
    expect(css).toMatch(/font-family: 'IBM Plex Mono'/);
    expect(source('public/fonts/OFL-BodoniModa.txt')).toMatch(
      /SIL OPEN FONT LICENSE/i,
    );
    expect(source('public/fonts/OFL-IBMPlex.txt')).toMatch(
      /SIL OPEN FONT LICENSE/i,
    );
  });

  test('body copy and metadata respect the minimum type sizes', () => {
    const css = source('src/styles/editorial.css');
    expect(css).toMatch(/body\s*\{[\s\S]*?font-size:\s*16px/);
    expect(css).not.toMatch(/font-size:\s*(?:[0-9]|1[01])px/);
    expect(css).toMatch(/\.section-label[\s\S]*?font-size:\s*12px/);
  });

  test('legacy watcher art remains unreferenced by the active implementation', () => {
    const active = [
      source('src/pages/index.astro'),
      source('src/layouts/BaseLayout.astro'),
      source('src/components/Hero.astro'),
      source('src/components/Projects.astro'),
      source('src/components/Contact.astro'),
      source('src/components/AmbientField.astro'),
      source('src/styles/editorial.css'),
    ].join('\n');
    expect(active).not.toMatch(/watcher-face-v[23]\.webp/);
    expect(
      existsSync(join(root, 'artwork-source/unverified/watcher-face-v2.webp')),
    ).toBe(true);
    expect(
      existsSync(join(root, 'artwork-source/unverified/watcher-face-v3.webp')),
    ).toBe(true);
    expect(existsSync(join(root, 'public/assets/watcher-face-v2.webp'))).toBe(
      false,
    );
  });
});

describe('built payload', () => {
  test('the built initial document stays below one megabyte when dist exists', () => {
    const dist = join(root, 'dist');
    if (!existsSync(dist)) return;

    const assetDir = join(dist, '_astro');
    const bundled = existsSync(assetDir)
      ? readdirSync(assetDir)
          .filter((name) => /\.(?:css|js)$/.test(name))
          .reduce((sum, name) => sum + statSync(join(assetDir, name)).size, 0)
      : 0;
    const initial =
      statSync(join(dist, 'index.html')).size +
      bundled +
      statSync(join(dist, 'fonts/BodoniModa-Variable-Latin.woff2')).size +
      statSync(join(dist, 'fonts/IBMPlexMono-Regular-Latin.woff2')).size +
      statSync(join(dist, 'assets/dither/recursive-field-poster.png')).size;

    expect(initial).toBeLessThan(1024 * 1024);

    const builtScripts = existsSync(assetDir)
      ? readdirSync(assetDir)
          .filter((name) => name.endsWith('.js'))
          .map((name) => source(`dist/_astro/${name}`))
          .join('\n')
      : '';
    expect(builtScripts).not.toMatch(/THREE\.REVISION|WebGLRenderer/);
  });
});
