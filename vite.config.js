import { defineConfig } from 'vite';
import { cp, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

// dev only: the page posts its light bake here and it is saved as public/gi/<name>.bin, so every
// browser (and the built site) loads it instead of baking it again
const bakeStore = {
  name: 'bake-store',
  configureServer(server) {
    server.middlewares.use('/__bake/', async (req, res) => {
      const name = decodeURIComponent(req.url.slice(1)).replace(/[^\w.-]/g, '_');
      if (req.method !== 'POST' || !name) { res.statusCode = 400; res.end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const dir = path.resolve('public', 'gi');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${name}.bin`), Buffer.concat(chunks));
      res.end('saved');
    });
  },
};

// the KTX2 textures need three.js's Basis transcoder at /basis/: copied from the installed three
// package into public/basis (git-ignored) when it is not there yet
const basis = {
  name: 'basis-transcoder',
  async config() {
    const dst = path.resolve('public', 'basis');
    if (await stat(path.join(dst, 'basis_transcoder.wasm')).catch(() => null)) return;
    await cp(path.resolve('node_modules', 'three', 'examples', 'jsm', 'libs', 'basis'), dst, { recursive: true });
  },
};

export default defineConfig({
  plugins: [bakeStore, basis],
  // three.js and the tree generator (its bark and leaf images inline) make a ~5 MB app chunk
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  worker: { format: 'es' },
  // the bakes written into public/gi while the page runs must not reload it
  server: { watch: { ignored: ['**/public/gi/**'] } },
});
