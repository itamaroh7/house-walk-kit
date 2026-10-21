// GPU time per frame via EXT_disjoint_timer_query_webgl2: wrap the frame's draw calls in
// begin() / end(); `ms` is the average over the last 10 measured frames, or null when the
// browser hides the extension. Unlike the frame time, it is not inflated by vsync, a 30 Hz
// display or a throttled background tab, so dynamic resolution can trust it.
export function createGpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const t = { ms: null, begin() {}, end() {} };
  if (!ext) return t;
  const free = [], pending = [];
  let active = null, sum = 0, n = 0;
  t.begin = () => {
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { sum += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; n++; }
      free.push(q);
    }
    if (n >= 10) { t.ms = sum / n; sum = 0; n = 0; }
    if (pending.length > 4) return;
    active = free.pop() ?? gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
  };
  t.end = () => {
    if (!active) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push(active);
    active = null;
  };
  return t;
}
