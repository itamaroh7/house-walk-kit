// Once a texture is on the GPU, three.js keeps its decoded image in memory only to upload it
// again, which never happens for the photos and maps of a finished scene: hundreds of them took
// more than a gigabyte in the tab. Upload every image texture in the scene now, then let the
// images go, leaving a stub with the size; a compressed (KTX2) texture lets its transcoded mip
// levels go. Textures whose data changes later (data, canvas and video textures, render
// targets) keep theirs.
export function releaseTextureMemory(renderer, scene) {
  const textures = new Set();
  const add = (v) => { if (v?.isTexture) textures.add(v); };
  const addMaterial = (m) => {
    for (const v of Object.values(m)) add(v);
    for (const u of Object.values(m.uniforms ?? {})) [].concat(u?.value).forEach(add);
  };
  scene.traverse((o) => { for (const m of o.material ? [].concat(o.material) : []) addMaterial(m); });
  add(scene.background);
  add(scene.environment);

  const sources = new Set(), compressed = new Set();
  for (const t of textures) {
    if (t.isCompressedTexture && t.mipmaps?.length) {
      renderer.initTexture(t);
      compressed.add(t);
      continue;
    }
    const d = t.source.data;
    if (t.isRenderTargetTexture || t.isDataTexture || t.isCubeTexture) continue;
    if (!(d instanceof ImageBitmap || d instanceof HTMLImageElement)) continue;
    renderer.initTexture(t);
    sources.add(t.source);
  }
  // a source is let go only when every texture drawing from it has been uploaded above
  for (const t of textures) if (!renderer.properties.get(t).__webglTexture) sources.delete(t.source);
  let bytes = 0;
  for (const t of compressed) {
    if (!renderer.properties.get(t).__webglTexture) continue;
    for (const m of t.mipmaps) bytes += m.data?.byteLength ?? 0;
    t.mipmaps = [];
  }
  for (const s of sources) {
    const d = s.data;
    bytes += d.width * d.height * 4;
    s.data = { width: d.width, height: d.height };
    d.close?.();
  }
  return { textures: textures.size, released: sources.size + compressed.size, bytes };
}
