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
    expect(page).toContain('<div class="hero-stage" data-hero-stage>');
    expect(page).toContain('<Hero />');
    expect(page).toContain('data-portfolio-journey');
    expect(page).toContain('data-journey-enhanced="false"');
    expect(page).toContain('<div class="portfolio-card__track" data-journey-track>');
    expect(page.indexOf('<Projects />')).toBeLessThan(
      page.indexOf('<Capabilities />'),
    );
    expect(page.indexOf('<Capabilities />')).toBeLessThan(
      page.indexOf('<Contact />'),
    );
    expect(page).toContain(
      '<div class="portfolio-journey__contact" data-contact-reveal>',
    );
    expect(page).toContain('<Capabilities />\n              </div>');
    expect(page).toContain(
      '<div class="portfolio-journey__contact" data-contact-reveal>\n            <Contact />',
    );
    expect(page).not.toMatch(/Principles|CommandDeck|welcome|entry gate/i);

    expect(layout).toContain("import '../styles/editorial.css'");
    expect(layout).toContain(
      '<div class="display-filter" aria-hidden="true"></div>',
    );
    expect(layout).not.toMatch(/global\.css|minimal\.css/);
    expect(layout).not.toMatch(
      /signal-compositor|gpu-stage|braille-entity|signal-rain|crt-layer|noise-layer/,
    );
    expect(layout).not.toMatch(
      /compositor\.js|interface\.js|gpu-runtime|entity\/canvas-renderer|three-adapter/,
    );
    expect(source('package.json')).not.toMatch(/"three"|"@types\/three"/);
  });

  test('the display filter is visual-only, static, and motion-aware', () => {
    const css = source('src/styles/editorial.css');

    expect(css).toMatch(
      /\.display-filter\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?pointer-events:\s*none;/,
    );
    expect(css).toContain('repeating-linear-gradient(');
    expect(css).not.toContain('@keyframes display-sweep');
    expect(css).not.toContain('animation: display-sweep');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.display-filter::after\s*\{[\s\S]*?animation:\s*none;/,
    );
  });

  test('the navbar CRT toggle is minimal, accessible, and persistent', () => {
    const topBar = source('src/components/TopBar.astro');
    const layout = source('src/layouts/BaseLayout.astro');
    const runtime = source('src/scripts/editorial-interface.ts');

    expect(topBar).toContain('class="display-mode-toggle"');
    expect(topBar).toContain('data-display-filter-toggle');
    expect(topBar).toContain('aria-pressed="false"');
    expect(layout).toContain('data-display-filter="off"');
    expect(layout).toContain("localStorage.getItem('portfolio.display-filter.v1')");
    expect(runtime).toContain(
      "const DISPLAY_FILTER_STORAGE_KEY = 'portfolio.display-filter.v1'",
    );
    expect(runtime).toContain("root.dataset.displayFilter = enabled ? 'on' : 'off'");
    expect(runtime).toContain("button.setAttribute('aria-pressed', String(enabled))");
  });

  test('each animated artwork has one independently contained canvas', () => {
    const activeSources = [
      source('src/pages/index.astro'),
      source('src/layouts/BaseLayout.astro'),
      source('src/components/Hero.astro'),
      source('src/components/Projects.astro'),
      source('src/components/ProjectArtwork.astro'),
      source('src/components/Capabilities.astro'),
      source('src/components/Contact.astro'),
      source('src/components/ContactIntelligence.astro'),
      source('src/components/TopBar.astro'),
      source('src/components/Footer.astro'),
      source('src/components/AmbientField.astro'),
    ].join('\n');

    expect((activeSources.match(/<canvas/g) ?? []).length).toBe(3);
    expect((activeSources.match(/data-study-canvas/g) ?? []).length).toBe(1);
    expect((activeSources.match(/data-intelligence-canvas/g) ?? []).length).toBe(1);
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
    expect(contact).toContain('<h2 id="contact-title"');
    expect(hero).toContain('aria-label="Live ordered 1-bit recursive field visualization"');
    expect(hero).toContain('alt="Ordered 1-bit study of a folded recursive field');
    expect(ambient.match(/aria-hidden="true"/g)).toHaveLength(1);
    expect(contact).toContain('<ContactIntelligence />');
    const intelligence = source('src/components/ContactIntelligence.astro');
    expect(intelligence).toContain('role="img"');
    expect(intelligence).toContain('aria-label="An uploaded intelligence leaning');
    expect(intelligence).toContain('aria-describedby="intelligence-invitation"');
    expect(source('src/components/ContactTerminal.astro')).toContain('data-intelligence-pause');
    expect(contact).not.toMatch(/entity-cameo|<canvas/i);
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
      { id: 'archive', paper: '#F2F3EE', ink: '#202621', accent: '#A3422B' },
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
    expect(projects[0].summary).toMatch(/Rust checks.*world changes/);
    expect(projects[1].links[0].href).toBe(
      'https://github.com/acvdoandrew/rust-edge-compute',
    );
    expect(projects[2].links[0].href).toBe(
      'https://github.com/acvdoandrew/high-performance-physics-engine',
    );
    expect(projects[3].links[0].href).toBe(
      'https://github.com/acvdoandrew/speculative-inference-proxy',
    );
    expect(projects[2].stack).toContain('O(n²) contacts');
    expect(projects[2].summary).toMatch(/Spatial hashing and benchmarks are next/);
    expect(projects[3].flow[1].detail).toContain('vLLM');
    expect(projects.every((project) => project.flow.length === 3)).toBe(true);
    expect(projects.every((project) => project.artwork.kind === 'pixels')).toBe(true);
    expect(
      projects.every((project) =>
        project.artwork.src?.startsWith('/assets/dither/studies/'),
      ),
    ).toBe(true);
    expect(
      projects.every((project) => project.artwork.underlaySrc === undefined),
    ).toBe(true);
    expect(projects.map(({ artwork }) => artwork.src)).toEqual([
      '/assets/dither/studies/ares.png',
      '/assets/dither/studies/rust-edge-compute.png',
      '/assets/dither/studies/physics-engine.png',
      '/assets/dither/studies/inference-proxy.png',
    ]);
    for (const { artwork } of projects) {
      expect(artwork.alt).toContain('1-bit');
      const path = join(root, 'public', artwork.src!);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeLessThan(20 * 1024);
      expect(pngDimensions(join('public', artwork.src!))).toEqual({ width: 288, height: 192 });
    }
    expect(source('src/components/ProjectArtwork.astro')).not.toContain('<img');
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
      source('src/components/ProjectArtwork.astro'),
      source('src/components/Capabilities.astro'),
      source('src/components/Contact.astro'),
      source('src/components/ContactIntelligence.astro'),
    ].join('\n');

    expect(visibleCopy).toContain('hi, i’m andrew.');
    expect(visibleCopy).toContain('a few projects.');
    expect(visibleCopy).toContain('usually within reach.');
    expect(visibleCopy).not.toContain('Send a signal.');
    expect(visibleCopy).not.toMatch(
      /compact index|tools are indexed|a direct line|explore selected work|email andrew/i,
    );
  });
});

describe('full-viewport scroll world and contained artwork', () => {
  const page = source('src/pages/index.astro');
  const ambient = source('src/components/AmbientField.astro');
  const contact = source('src/components/Contact.astro');
  const css = source('src/styles/editorial.css');
  const fullViewportCss = css.slice(
    css.indexOf('/* Full-viewport scroll world'),
  );

  test('the hero occupies the viewport instead of sitting inside a centered frame', () => {
    expect(page.indexOf('<AmbientField />')).toBeLessThan(
      page.indexOf('<TopBar />'),
    );
    expect(fullViewportCss).toMatch(
      /body\s*\{\s*padding:\s*0;\s*\}/,
    );
    expect(fullViewportCss).toMatch(
      /\.site-frame\s*\{[\s\S]*?width:\s*100%;[\s\S]*?margin:\s*0;[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*none;/,
    );
    expect(fullViewportCss).toMatch(
      /\.hero-stage\s*\{[\s\S]*?height:\s*135svh;/,
    );
    expect(fullViewportCss).toMatch(
      /\.hero-stage__pin\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?height:\s*100svh;[\s\S]*?overflow:\s*clip;/,
    );
    expect(fullViewportCss).toMatch(
      /\.hero-plate\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*100svh;[\s\S]*?border:\s*0;/,
    );
  });

  test('the ambient field contains only static decorative engravings', () => {
    expect(ambient.match(/aria-hidden="true"/g)).toHaveLength(1);
    expect(ambient.match(/class="ambient-engraving /g)).toHaveLength(4);
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
    expect(css).toContain(
      "url('/assets/dither/inference-proxy-engraving.png')",
    );
    expect(css).not.toMatch(/\.roaming-|data-roaming/);
    expect(existsSync(join(root, 'src/scripts/roaming-entity.ts'))).toBe(false);

    const ambientRule =
      css.match(/\.ambient-engraving\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(ambientRule).not.toMatch(/animation|transition/);
  });

  test('the uploaded intelligence is contained in Contact with an accessible still fallback', () => {
    const intelligence = source('src/components/ContactIntelligence.astro');
    expect(contact).toContain('<ContactIntelligence />');
    expect(intelligence.match(/<canvas/g)).toHaveLength(1);
    expect(intelligence).toContain('data-intelligence-pose="terminal"');
    expect(intelligence).not.toContain('<img');
    expect(intelligence).toContain('/assets/dither/intelligence-terminal.png');
    expect(intelligence).toContain('image-rendering: pixelated');
    expect(source('src/scripts/contact-intelligence.ts')).toContain('prefers-reduced-motion: reduce');
    expect(intelligence).not.toMatch(/data-roaming/);
    expect(pngDimensions('public/assets/dither/intelligence-terminal.png')).toEqual({ width: 384, height: 256 });
    expect(source('src/scripts/contact-intelligence.ts')).not.toMatch(/texImage2D|sampler2D|becoming\.webp/);
  });

  test('one wide card pins Work and Stack while Contact fades underneath its release', () => {
    const projectsSource = source('src/components/Projects.astro');
    const capabilitiesSource = source('src/components/Capabilities.astro');

    expect(page).toContain(
      '<article class="portfolio-card" data-journey-card>',
    );
    expect(page).toContain(
      '<div class="portfolio-card__viewport" data-journey-viewport>',
    );
    expect(projectsSource).toContain('data-journey-label="WORK"');
    expect(projectsSource).toContain('data-journey-index="01"');
    expect(capabilitiesSource).toContain('data-journey-label="STACK"');
    expect(capabilitiesSource).toContain('data-journey-index="02"');
    expect(contact).toContain('data-journey-label="CONTACT"');
    expect(contact).toContain('data-journey-index="03"');
    expect(contact).toContain('data-contact-field');
    expect(contact).not.toContain('data-journey-section');
    expect(projectsSource).not.toMatch(
      /work-scroll-stage|work-scroll-panel|work-rail-marker/,
    );
    expect(fullViewportCss).toMatch(
      /\.portfolio-journey__pin\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?height:\s*100svh;[\s\S]*?overflow:\s*clip;/,
    );
    expect(fullViewportCss).toMatch(
      /\.portfolio-card\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*calc\(var\(--masthead-height\) \+ var\(--journey-inset\)\);[\s\S]*?right:\s*var\(--journey-inset\);[\s\S]*?bottom:\s*var\(--journey-inset\);[\s\S]*?left:\s*var\(--journey-inset\);/,
    );
    expect(fullViewportCss).toMatch(
      /\.portfolio-card__viewport\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(fullViewportCss).toMatch(
      /\.portfolio-journey__contact\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?opacity:\s*var\(--contact-reveal\);[\s\S]*?transform:\s*translate3d\(0, var\(--contact-shift\), 0\);/,
    );
    expect(fullViewportCss).toMatch(
      /\.portfolio-card\s*\{[\s\S]*?z-index:\s*2;/,
    );
  });

  test('mobile and reduced-motion users get direct document flow', () => {
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.ambient-engraving\s*\{[\s\S]*?width:\s*110%;[\s\S]*?opacity:\s*0\.024;/,
    );
    expect(fullViewportCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.portfolio-journey__pin\s*\{[\s\S]*?position:\s*relative;[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/,
    );
    expect(fullViewportCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.portfolio-card__track\s*\{[\s\S]*?transform:\s*none !important;/,
    );
    expect(fullViewportCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.contact-composition\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(fullViewportCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.portfolio-journey__contact\s*\{[\s\S]*?position:\s*relative;[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*none;/,
    );
    expect(fullViewportCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.portfolio-journey\s*\{[\s\S]*?height:\s*auto !important;/,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.ambient-engraving-field\s*\{[\s\S]*?display:\s*none;/,
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

  test('portfolio journey maps body scroll onto the pinned card track', () => {
    const runtime = source('src/scripts/editorial-interface.ts');
    const projectsSource = source('src/components/Projects.astro');
    const css = source('src/styles/editorial.css');

    expect(runtime).toContain('const initializePortfolioJourney = () =>');
    expect(runtime).toContain("'[data-portfolio-journey]'");
    expect(runtime).toContain("'[data-journey-track]'");
    expect(runtime).toMatch(/requestAnimationFrame/);
    expect(runtime).toMatch(/new ResizeObserver/);
    expect(runtime).toMatch(
      /addEventListener\('scroll', schedule, \{ passive: true \}\)/,
    );
    expect(runtime).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(runtime).toContain('measuredWidth >= 900 && !reducedMotion.matches');
    expect(runtime).toContain(
      'trackTravel = Math.max(0, track.scrollHeight - viewportHeight)',
    );
    expect(runtime).toContain(
      'track.style.transform = `translate3d(0, ${-trackOffset.toFixed(2)}px, 0)`',
    );
    expect(runtime).toContain("state?.replaceChildren('CARD APPROACH')");
    expect(runtime).toContain(
      "state?.replaceChildren('SCROLL / INTERNAL FIELD')",
    );
    expect(runtime).toContain("state?.replaceChildren('STACK / HOLD')");
    expect(runtime).toContain("state?.replaceChildren('CONTACT / REVEAL')");
    expect(runtime).toContain('const scrollToSection = (section: HTMLElement');
    expect(runtime).toContain('const scrollToContact = (focus = false)');
    expect(runtime).toContain("'--contact-reveal'");
    expect(runtime).toContain('releaseDistance * 0.72');
    expect(runtime).not.toMatch(/(?:wheel|touchmove)[\s\S]{0,100}preventDefault/);
    expect(projectsSource).toContain('data-journey-section');
    expect(projectsSource).toContain('data-project-card');
    expect(projectsSource).toContain('class="project-flow"');
    expect(projectsSource.match(/<article[\s\S]*?>/)?.[0]).not.toContain('aria-pressed=');
    expect(css).toMatch(
      /\.project-atlas\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.project-atlas\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(
      /\.portfolio-journey:not\(\[data-journey-enhanced='true'\]\)[\s\S]*?\.portfolio-card__track\s*\{[\s\S]*?transform:\s*none !important/,
    );
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
    ['public/assets/dither/ares-validation-plate.png', 960, 640],
    ['public/assets/dither/edge-lease-control-plate.png', 960, 640],
    ['public/assets/dither/physics-verlet-plate.png', 960, 640],
    ['public/assets/dither/inference-routing-plate.png', 960, 640],
    ['public/assets/dither/entity-08-solar-ghost-cartographer.png', 800, 1000],
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

  test('project plates preserve source art while old engravings remain ambient', () => {
    const illustrationSources = [
      'ares-frontier-engraving-source.png',
      'edge-node-engraving-source.png',
      'physics-engine-engraving-source.png',
      'inference-proxy-engraving-source.png',
      'ares-system-plate-source.png',
      'edge-control-plane-plate-source.png',
      'physics-solver-plate-source.png',
      'inference-measurement-plate-source.png',
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
    expect(generator).toContain('ares-validation-plate.png');
    expect(generator).toContain('edge-lease-control-plate.png');
    expect(generator).toContain('physics-verlet-plate.png');
    expect(generator).toContain('inference-routing-plate.png');
    expect(figure).toContain('artwork.underlaySrc');
    expect(figure).toContain('research-figure__technical-mask');
    expect(figure).toMatch(
      /\.research-figure__technical-mask\s*\{[\s\S]*?z-index:\s*1;[\s\S]*?opacity:\s*0\.18;/,
    );
    expect(figure).toMatch(
      /\.research-figure__mask-source\s*\{[\s\S]*?z-index:\s*2;[\s\S]*?opacity:\s*1;[\s\S]*?mix-blend-mode:\s*difference;/,
    );
    expect(figure).toMatch(
      /\.research-figure__mask\s*\{[\s\S]*?display:\s*none;/,
    );
    expect(projectsSource).toContain(
      '<ProjectArtwork artwork={project.artwork} index={index} variant={project.id} />',
    );
  });

  test('the original and solar-ghost entity sources stay private', () => {
    expect(
      existsSync(join(root, 'artwork-source/entity-07-signal-cartographer.png')),
    ).toBe(true);
    expect(
      existsSync(
        join(root, 'artwork-source/entity-08-solar-ghost-cartographer.png'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(root, 'public/assets/source/entity-07-signal-cartographer.png'),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(root, 'public/assets/source/entity-08-solar-ghost-cartographer.png'),
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
      source('src/components/ProjectArtwork.astro'),
      source('src/components/Contact.astro'),
      source('src/components/ContactIntelligence.astro'),
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
