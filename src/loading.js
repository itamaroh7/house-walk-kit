// The page's words in its language, and the loading progress: the bytes of every finished
// download (resource timing, so it sees the script bundle, models, textures and fetches alike)
// against the total a full load took, measured once on the built site (public/load-size.json);
// the time left comes from the rate so far. Its own small entry, so it runs while main.js and
// three.js are still downloading.
import { t, applyPage } from './i18n.js';

applyPage();
const t0 = performance.now();
const title = document.getElementById('load-title'), bar = document.querySelector('#load-bar i'), info = document.getElementById('load-info');
let total = 0, bytes = 0, stage = null, finished = false;
fetch('/load-size.json').then((r) => (r.ok ? r.json() : null)).then((j) => { total = j?.bytes ?? 0; }).catch(() => {});
try { performance.setResourceTimingBufferSize(20000); } catch { /* an older browser keeps its default */ }
const seen = new Set();
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    bytes += e.decodedBodySize || e.encodedBodySize || 0;
  }
});
obs.observe({ type: 'resource', buffered: true });
const mb = (b) => (b / 1048576).toFixed(0);
const time = (s) => (s < 90 ? t('seconds', { n: Math.max(5, Math.round(s / 5) * 5) }) : t('minutes', { n: Math.round(s / 60) }));
const show = () => {
  if (finished || !document.getElementById('loading')) return;
  if (stage) {
    title.textContent = stage.text;
    bar.style.width = `${stage.f * 100}%`;
    info.textContent = `${Math.round(stage.f * 100)}%`;
  } else if (total) {
    const f = Math.min(bytes / total, 0.99), secs = (performance.now() - t0) / 1000;
    bar.style.width = `${f * 100}%`;
    const left = bytes > 0 && secs > 3 && f < 0.97 ? t('timeLeft', { t: time(((total - bytes) * secs) / bytes) }) : '';
    info.textContent = f >= 0.97 ? t('preparing', { p: Math.round(f * 100) }) : t('loadedOf', { p: Math.round(f * 100), a: mb(bytes), b: mb(total) }) + left;
  } else {
    info.textContent = t('downloaded', { mb: mb(bytes) });
  }
  setTimeout(show, 250);
};
show();
// main.js: a stage with its own progress (the one-time light bake), and the end
window.__loading = {
  stage(text, f) { stage = { text, f }; },
  done() { finished = true; obs.disconnect(); return bytes; },
};

// the app itself, as its own download (about 5 MB with three.js and the tree generator), so this
// small script and its progress bar run first
import('./main.js').catch((e) => {
  console.error(e);
  if (!document.getElementById('load-box')?.querySelector('p')) document.getElementById('load-box').innerHTML = `<p>${t('failed')} ${String(e.message ?? e).replace(/</g, '&lt;')}</p>`;
});
