// Frame rate on this computer, measured the way a visitor sees it: launches Chrome or Edge in the
// background (a fresh temporary profile, the real GPU, no 60 fps cap), opens a plan in the running
// dev server, and lets the page's own loop run for a few seconds at two views: inside the house
// and from the street.
//
//   npm run dev                       (in another terminal)
//   npm run bench                     the example plan, quality "balanced"
//   npm run bench -- --plan my-house --quality fast --seconds 6
//   npm run bench -- --compare        the engine's speed-ups on and off (?fast=0), alternately
//   npm run bench -- --profile        where the CPU time of a frame goes (top functions)
//   npm run bench -- --url http://127.0.0.1:5181/   a build served by `npm run preview`
//
// Prints frames per second (from the median frame), the 90th-percentile frame and the page's own
// GPU time. CHROME=<path to chrome or msedge> picks the browser.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const base = opt('url', 'http://127.0.0.1:5180/');
const plan = opt('plan', 'example');
const quality = opt('quality', 'balanced');
const seconds = +opt('seconds', 4);

function findBrowser() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = {
    win32: [
      `${process.env.PROGRAMFILES}/Google/Chrome/Application/chrome.exe`, `${process.env['PROGRAMFILES(X86)']}/Google/Chrome/Application/chrome.exe`,
      `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`, `${process.env['PROGRAMFILES(X86)']}/Microsoft/Edge/Application/msedge.exe`,
      `${process.env.PROGRAMFILES}/Microsoft/Edge/Application/msedge.exe`,
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
  }[process.platform] ?? [];
  return candidates.find((p) => p && existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// one browser session on one page: load, wait for the house, run `steps`
async function session(url, steps) {
  const browser = findBrowser();
  if (!browser) throw new Error('no Chrome or Edge found: set CHROME=<path>');
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = mkdtempSync(path.join(os.tmpdir(), 'house-walk-bench-'));
  const gpuFlags = process.platform === 'win32' ? ['--use-angle=d3d11'] : [];
  const proc = spawn(browser, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--window-size=1280,720',
    '--enable-gpu', '--ignore-gpu-blocklist', ...gpuFlags, '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });
  let ws, seq = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(250);
      target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
    }
    if (!target) throw new Error('the browser did not start');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      const p = m.id && pending.get(m.id);
      if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('house-walk-quality', ${JSON.stringify(quality)}); } catch {}` });
    await send('Page.navigate', { url });
    const t0 = Date.now();
    while (!(await evaluate('!!window.__house').catch(() => false))) {
      if (Date.now() - t0 > 300000) throw new Error(`${url} did not load in 5 minutes (is \`npm run dev\` running? the first visit bakes the light)`);
      await sleep(1000);
    }
    await evaluate(`window.__frames = (ms) => new Promise((res) => { const t = []; let last = performance.now(); const start = last;
      const f = (now) => { t.push(now - last); last = now; if (now - start < ms) requestAnimationFrame(f); else res(t); }; requestAnimationFrame(f); });
      window.__views = () => { const b = __house.house.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
        return [['inside', [cx, cz, b.minX, b.minZ]], ['street', [cx, b.maxZ + 8, cx, cz]]]; };
      true`);
    return await steps({ send, evaluate });
  } finally {
    try { ws?.close(); } catch {}
    proc.kill();
    await sleep(600);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

const stats = (t) => {
  const s = t.slice(5).sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { fps: Math.round(1000 / q(0.5)), median: q(0.5), p90: q(0.9) };
};

async function measure(url) {
  return session(url, async ({ evaluate }) => {
    const info = await evaluate(`(() => { const gl = __house.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown', canvas: __house.renderer.domElement.width + 'x' + __house.renderer.domElement.height }; })()`);
    const rows = [];
    for (const [name, at] of await evaluate('__views()')) {
      await evaluate(`__house.view(${at.join(',')}).then(() => true)`);
      await evaluate('__frames(1500)');
      const s = stats(await evaluate(`__frames(${seconds * 1000})`));
      const hud = await evaluate("document.getElementById('perf')?.textContent ?? ''");
      rows.push({ name, ...s, gpu: (hud.match(/gpu ([\d.]+) ms/) ?? [])[1] ?? '?' });
    }
    return { info, rows };
  });
}

const url = (extra = '') => `${base}${base.includes('?') ? '&' : '?'}plan=${encodeURIComponent(plan)}${extra}`;
const line = (r) => `${r.name.padEnd(7)} ${String(r.fps).padStart(4)} fps   median ${r.median.toFixed(1).padStart(5)} ms   90% ${r.p90.toFixed(1).padStart(5)} ms   gpu ${r.gpu} ms`;

if (flag('profile')) {
  await session(url(), async ({ send, evaluate }) => {
    const [[, at]] = await evaluate('__views()');
    await evaluate(`__house.view(${at.join(',')}).then(() => true)`);
    await evaluate('__frames(1500)');
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 200 });
    await send('Profiler.start');
    await evaluate(`__frames(${seconds * 1000})`);
    const { profile } = await send('Profiler.stop');
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    for (const id of profile.samples) {
      const f = byId.get(id).callFrame;
      const key = `${f.functionName || '(anonymous)'}  ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + 1);
    }
    console.log(`CPU time of the frame loop inside the house (${profile.samples.length} samples):`);
    for (const [k, n] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(100 * n / profile.samples.length).toFixed(1).padStart(5)}%  ${k}`);
  });
} else if (flag('compare')) {
  const runs = { off: [], on: [] };
  let info;
  for (const mode of ['off', 'on', 'off', 'on']) {
    const r = await measure(url(mode === 'off' ? '&fast=0' : ''));
    info = r.info;
    runs[mode].push(r.rows);
  }
  console.log(`${info.gpu}, canvas ${info.canvas}, quality ${quality}`);
  for (const mode of ['off', 'on']) {
    console.log(mode === 'off' ? 'speed-ups off (?fast=0):' : 'speed-ups on:');
    for (let v = 0; v < runs[mode][0].length; v++) {
      const rows = runs[mode].map((r) => r[v]);
      const best = rows.reduce((a, b) => (b.median < a.median ? b : a));
      console.log(`  ${line(best)}   (best of ${rows.length})`);
    }
  }
} else {
  const { info, rows } = await measure(url());
  console.log(`${info.gpu}, canvas ${info.canvas}, quality ${quality}`);
  for (const r of rows) console.log(`  ${line(r)}`);
  const worst = rows.reduce((a, b) => (b.median > a.median ? b : a));
  console.log(worst.median <= 16.7 ? 'smooth: 60 fps or better at every view' : `below 60 fps at "${worst.name}": try --profile, docs/performance.md`);
}
