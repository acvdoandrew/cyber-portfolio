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
  channels,
  paletteOrder,
  palettes,
  projects,
} from '../src/data/portfolio';

const root = join(import.meta.dir, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

const allStyles = () =>
  readdirSync(join(root, 'src/styles'))
    .filter((name) => name.endsWith('.css'))
    .map((name) => source(`src/styles/${name}`))
    .join('\n');

const pngDimensions = (path: string) => {
  const bytes = readFileSync(join(root, path));
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
};

describe('control deck', () => {
  const page = source('src/pages/index.astro');
  const layout = source('src/layouts/BaseLayout.astro');
  const header = source('src/components/ConsoleHeader.astro');
  const deckCss = source('src/styles/deck.css');

  test('one screen: header, a stage holding four views, and a status strip', () => {
    const stage = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
    expect(page).toContain('<div class="deck" data-deck>');
    expect(stage).toContain('id="main-content"');
    expect(stage.indexOf('<Hero />')).toBeLessThan(stage.indexOf('<Projects />'));
    expect(stage.indexOf('<Projects />')).toBeLessThan(stage.indexOf('<Capabilities />'));
    expect(stage.indexOf('<Capabilities />')).toBeLessThan(stage.indexOf('<Contact />'));
    expect(page.indexOf('<ConsoleHeader />')).toBeLessThan(page.indexOf('<main'));
    expect(page.indexOf('</main>')).toBeLessThan(page.indexOf('<ConsoleBar />'));
    expect(page).toContain('<TitleCard />');
    expect(layout).toContain("import '../styles/console.css'");
    expect(layout).toContain('<div class="display-filter" aria-hidden="true"></div>');
    expect(layout).toContain('href="#main-content"');
  });

  test('four channels, and the channel keys are the only navigation', () => {
    expect(channels.map(({ id, number }) => `${number}:${id}`)).toEqual([
      '00:home',
      '01:work',
      '02:tools',
      '03:contact',
    ]);
    expect(header.match(/<nav/g)).toHaveLength(1);
    expect(header).toContain('aria-label="Channels"');
    expect(header).toContain('data-channel-link={channel.id}');
    expect(header).not.toMatch(/menu-toggle|data-menu/);
    const bar = source('src/components/ConsoleBar.astro');
    expect(bar).not.toMatch(/<nav|data-bar-track|scroll/);
    for (const [component, id] of [
      ['Hero', 'home'],
      ['Projects', 'work'],
      ['Capabilities', 'tools'],
      ['Contact', 'contact'],
    ]) {
      const markup = source(`src/components/${component}.astro`);
      expect(markup).toContain(`id="${id}"`);
      expect(markup).toContain(`data-view="${id}"`);
      expect(markup).toMatch(/<h[12][^>]*tabindex="-1"/);
    }
  });

  test('the deck owns the viewport and shows only the current channel', () => {
    const base = source('src/styles/base.css');
    expect(base).toMatch(/html\.js,\s*html\.js body\s*\{[\s\S]*?overflow:\s*hidden/);
    expect(deckCss).toMatch(/html\.js \.deck\s*\{[\s\S]*?height:\s*100dvh/);
    expect(deckCss).toMatch(/html\.js \.view\s*\{[\s\S]*?display:\s*none/);
    for (const { id } of channels) {
      expect(deckCss).toContain(`html.js[data-channel='${id}'] .view--${id}`);
    }
    // Without the runtime it is simply one document.
    expect(deckCss).toContain('html:not(.js) .view + .view');
  });

  test('the channel is chosen before first paint, from the same hashes the router reads', () => {
    expect(layout).toContain('define:vars={{ channelIds, unitIds }}');
    expect(layout).toContain('data-channel="home"');
    expect(layout).toMatch(/capabilities: 'tools'/);
    expect(layout.indexOf('channelIds.includes(name)')).toBeGreaterThan(-1);
    const work = source('src/components/Projects.astro');
    expect(work).toContain('html.js[data-unit="${project.id}"] [data-unit-panel="${project.id}"]{display:grid}');
  });

  test('projects are an accessible vertical tablist with one panel each', () => {
    const work = source('src/components/Projects.astro');
    expect(work).toContain('role="tablist"');
    expect(work).toContain('aria-orientation="vertical"');
    expect(work).toContain('role="tab"');
    expect(work).toContain('aria-controls={project.id}');
    expect(work).toContain('role="tabpanel"');
    expect(work).toContain("aria-selected={index === 0 ? 'true' : 'false'}");
    expect(work).toContain('<ProjectArtwork artwork={project.artwork} index={index} variant={project.id} />');
  });

  test('inspired, not borrowed: no franchise names, and no colors from outside the palette', () => {
    const everything = [
      ...readdirSync(join(root, 'src/components')).map((name) => source(`src/components/${name}`)),
      source('src/pages/index.astro'),
      source('src/layouts/BaseLayout.astro'),
      source('src/scripts/contact-intelligence.ts'),
      source('src/scripts/entity/forms.ts'),
      source('src/scripts/console/interface.ts'),
      allStyles(),
    ].join('\n');
    expect(everything).not.toMatch(/magi|evangelion|nerv\b|melchior|balthasar|casper/i);
    // Status is carried by the palette's own tones; the alarm tokens are gone.
    expect(allStyles()).not.toMatch(/var\(--(?:ok|hot)\)|^\s*--(?:ok|hot):/m);
  });

  test('motion is optional: the title card and power-on sequences stand down', () => {
    const ambient = source('src/styles/ambient.css');
    const reduced = ambient.slice(ambient.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.cut\s*\{[\s\S]*?display:\s*none/);
    expect(reduced).toContain('.view[data-entering] > *');
    expect(reduced).toContain('.entity-tag');
    expect(source('src/scripts/console/interface.ts')).toContain('if (!cut || reducedMotion.matches) return;');
    expect(source('src/scripts/contact-intelligence.ts')).toContain('if (this.stillPreference) this.still();');
  });

  test('the entity lives on the contact channel with a still poster and a text alternative', () => {
    const entity = source('src/components/ContactIntelligence.astro');
    expect(entity).toContain('role="img"');
    expect(entity).toMatch(/aria-label="[^"]*bytes[^"]*"/);
    expect(entity).toContain('width={ENTITY_WIDTH} height={ENTITY_HEIGHT}');
    expect(source('src/styles/views.css')).toContain("url('/assets/dither/entity-bytes.png')");
    expect(pngDimensions('public/assets/dither/entity-bytes.png')).toEqual({ width: 480, height: 320 });
    expect(source('src/components/Contact.astro')).toContain('<ReviewPanel />');
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
      source('src/components/ReviewPanel.astro'),
    ].join('\n');

    expect(visibleCopy).toMatch(/data-text="hi, i’m">hi, i’m<\/span>\{' '\}\s*<span[^>]*>andrew\.</);
    expect(visibleCopy).toMatch(/data-text="a few">a few<\/span>\{' '\}\s*<span[^>]*>projects\.</);
    expect(visibleCopy).toMatch(/data-text="usually">usually<\/span>\{' '\}\s*<span[^>]*>within reach\.</);
    expect(visibleCopy).toContain('is this a person?');
    expect(visibleCopy).not.toContain('Send a signal.');
    expect(visibleCopy).not.toMatch(
      /compact index|tools are indexed|a direct line|explore selected work|email andrew/i,
    );
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

  test('IBM Plex Mono is self-hosted and sets every line, headings included', () => {
    const css = source('src/styles/base.css');
    for (const font of [
      'public/fonts/IBMPlexMono-Regular-Latin.woff2',
      'public/fonts/IBMPlexMono-Medium-Latin.woff2',
      'public/fonts/IBMPlexMono-SemiBold-Latin.woff2',
    ]) {
      expect(existsSync(join(root, font))).toBe(true);
      expect(statSync(join(root, font)).size).toBeLessThan(100 * 1024);
    }
    expect(css).toMatch(/font-family: 'IBM Plex Mono'/);
    expect(css).toContain('--font-display: var(--font-mono);');
    expect(allStyles()).not.toMatch(/Bodoni/);
    expect(source('public/fonts/OFL-IBMPlex.txt')).toMatch(/SIL OPEN FONT LICENSE/i);
  });

  test('body copy and metadata respect the minimum type sizes', () => {
    const css = allStyles();
    expect(source('src/styles/base.css')).toMatch(/body\s*\{[\s\S]*?font-size:\s*16px/);
    expect(css).not.toMatch(/font-size:\s*(?:[0-9]|1[01])px/);
    expect(css).not.toMatch(/font:\s*\d{3}\s+(?:[0-9]|1[01])px/);
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
      source('src/components/ReviewPanel.astro'),
      allStyles(),
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
      statSync(join(dist, 'fonts/IBMPlexMono-Regular-Latin.woff2')).size +
      statSync(join(dist, 'fonts/IBMPlexMono-SemiBold-Latin.woff2')).size +
      statSync(join(dist, 'assets/dither/recursive-field-poster.png')).size +
      statSync(join(dist, 'assets/dither/entity-bytes.png')).size;

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
