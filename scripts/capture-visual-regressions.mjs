#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(projectRoot, 'artifacts/visual-regression');
const chromeProfile = mkdtempSync(resolve(tmpdir(), 'minimal-signal-capture-'));
const devToolsPortFile = resolve(chromeProfile, 'DevToolsActivePort');
const localUrl = process.env.PORTFOLIO_PREVIEW_URL ?? 'http://127.0.0.1:4325/';
const liveUrl = 'https://www.aceandrew.com/';
const chromiumBinary = process.env.CHROMIUM_BIN ?? 'chromium';

mkdirSync(outputDirectory, { recursive: true });

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const waitForDevTools = async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const [port] = readFileSync(devToolsPortFile, 'utf8').trim().split('\n');
      if (port) return Number(port);
    } catch {
      // Chromium has not written its endpoint yet.
    }
    await delay(50);
  }
  throw new Error('Chromium did not expose a DevTools endpoint.');
};

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.commandId = 0;
    this.pending = new Map();
    this.listeners = new Map();

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }

      const listeners = this.listeners.get(message.method) ?? [];
      this.listeners.delete(message.method);
      listeners.forEach((resolveListener) => resolveListener(message.params));
    });
  }

  send(method, params = {}) {
    const id = ++this.commandId;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, {
        resolve: resolveCommand,
        reject: rejectCommand,
      });
    });
  }

  waitFor(method, timeout = 15_000) {
    return new Promise((resolveEvent, rejectEvent) => {
      const timer = setTimeout(() => {
        rejectEvent(new Error(`Timed out waiting for ${method}.`));
      }, timeout);
      const listeners = this.listeners.get(method) ?? [];
      listeners.push((params) => {
        clearTimeout(timer);
        resolveEvent(params);
      });
      this.listeners.set(method, listeners);
    });
  }
}

const connect = async (url) => {
  const socket = new WebSocket(url);
  await new Promise((resolveSocket, rejectSocket) => {
    socket.addEventListener('open', resolveSocket, { once: true });
    socket.addEventListener(
      'error',
      () => rejectSocket(new Error('Could not connect to Chromium DevTools.')),
      { once: true },
    );
  });
  return new CdpClient(socket);
};

const navigate = async (client, url) => {
  const loaded = client.waitFor('Page.loadEventFired');
  await client.send('Page.navigate', { url });
  await loaded;
};

const settlePage = async (client) => {
  await client.send('Runtime.evaluate', {
    expression: `
      Promise.all([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 240))
      ])
    `,
    awaitPromise: true,
    returnByValue: true,
  });
};

const setPalette = async (client, palette) => {
  const loaded = client.waitFor('Page.loadEventFired');
  await client.send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('portfolio.palette.v1', ${JSON.stringify(palette)});
      location.reload();
    `,
  });
  await loaded;
  await settlePage(client);
};

const setViewport = (client, width, height) =>
  client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

const capture = async (
  client,
  { name, url, width, height, palette, fullPage = false },
) => {
  await setViewport(client, width, height);
  await navigate(client, url);
  if (palette) await setPalette(client, palette);
  else await settlePage(client);

  if (url.startsWith(localUrl)) {
    const audit = await client.send('Runtime.evaluate', {
      expression: `({
        cls: globalThis.__minimalSignalCls ?? 0,
        canvases: document.querySelectorAll('canvas').length,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      })`,
      returnByValue: true,
    });
    const result = audit.result.value;
    if (result.cls >= 0.05) {
      throw new Error(`${name}: CLS ${result.cls} exceeds 0.05.`);
    }
    if (result.canvases !== 1) {
      throw new Error(`${name}: expected one canvas, saw ${result.canvases}.`);
    }
    if (result.overflow > 0) {
      throw new Error(`${name}: horizontal overflow is ${result.overflow}px.`);
    }
  }

  let clip;
  if (fullPage) {
    const metrics = await client.send('Page.getLayoutMetrics');
    clip = {
      x: 0,
      y: 0,
      width,
      height: Math.ceil(metrics.cssContentSize.height),
      scale: 1,
    };
  }

  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: fullPage,
    ...(clip ? { clip } : {}),
  });
  const destination = resolve(outputDirectory, `${name}.png`);
  writeFileSync(destination, Buffer.from(screenshot.data, 'base64'));
  console.log(`${name}.png`);
};

const chrome = spawn(
  chromiumBinary,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    `--user-data-dir=${chromeProfile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ],
  {
    cwd: projectRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  },
);

let client;

try {
  const port = await waitForDevTools();
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('Chromium did not expose a page target.');
  }

  client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      globalThis.__minimalSignalCls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              globalThis.__minimalSignalCls += entry.value;
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
    `,
  });
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });

  const palettes = [
    'archive',
    'carbon',
    'signal',
    'radiant',
    'field',
    'alloy',
  ];
  for (const palette of palettes) {
    await capture(client, {
      name: `hero-${palette}-1280x720`,
      url: localUrl,
      width: 1280,
      height: 720,
      palette,
    });
  }

  const pageWidths = [
    { width: 1440, height: 900, label: '1440x900' },
    { width: 768, height: 1024, label: '768x1024' },
    { width: 390, height: 844, label: '390x844' },
    { width: 320, height: 800, label: '320x800' },
  ];
  for (const palette of ['archive', 'carbon']) {
    for (const viewport of pageWidths) {
      await capture(client, {
        name: `page-${palette}-${viewport.label}`,
        url: localUrl,
        width: viewport.width,
        height: viewport.height,
        palette,
        fullPage: true,
      });
    }
  }

  await capture(client, {
    name: 'comparison-live-desktop-1440x900',
    url: liveUrl,
    width: 1440,
    height: 900,
  });
  await capture(client, {
    name: 'comparison-local-desktop-1440x900',
    url: localUrl,
    width: 1440,
    height: 900,
    palette: 'archive',
  });
  await capture(client, {
    name: 'comparison-live-mobile-390x844',
    url: liveUrl,
    width: 390,
    height: 844,
  });
  await capture(client, {
    name: 'comparison-local-mobile-390x844',
    url: localUrl,
    width: 390,
    height: 844,
    palette: 'archive',
  });
} finally {
  client?.socket.close();
  const chromeExited = new Promise((resolveExit) => {
    if (chrome.exitCode !== null) resolveExit();
    else chrome.once('exit', resolveExit);
  });
  chrome.kill('SIGTERM');
  await Promise.race([chromeExited, delay(1_500)]);
  rmSync(chromeProfile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
