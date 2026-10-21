// The name of a plan's light bake: the plan without what barely reaches the rooms' light, hashed,
// plus the bake's settings. The page uses it to find public/gi/<file>.bin, and the build
// (tools/prune-dist.mjs) to keep only the bakes the shipped plans use. Runs in Node too.
//   bakeFile(plan, { spacing, sky, lampPower }) -> 'example_1jp5ows_0.6_<sky>_n0_0.9_v8.bin'

// the street and garden (trees, bushes, bins, road patches, lamps, parked cars, edging, AC units)
// and furniture recolouring barely reach the rooms' light: left out of the key so dressing them
// doesn't cost a 3-minute rebake; nor do the pictures on the walls, the names (a plan reads the
// same bake in any language) or the kit's problem list
const OUTSIDE = new Set(['trees', 'bushes', 'bins', 'patches', 'edging', 'groundACs', 'streetLights', 'recolor', 'tint', 'mirror', 'name', 'problems']);
const decor = (v) => Array.isArray(v) && typeof v[0] === 'string' && /^street\/|picture_frame|wall_art/.test(v[0]);

function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export const BAKE_DEFAULTS = { spacing: 0.6, sky: 'kloofendal_48d_partly_cloudy', lampPower: 0.9 };

export function bakeKey(plan, { spacing, sky, lampPower } = BAKE_DEFAULTS) {
  const indoor = JSON.stringify(plan, (k, v) => (OUTSIDE.has(k) || decor(v) ? undefined : v));
  return `${plan.id}:${hashOf(indoor)}:${spacing}:${sky}:n${plan.site?.north ?? 0}:${lampPower}:v8`;
}

export const bakeFile = (plan, opts) => `${bakeKey(plan, opts).replace(/[^\w.-]/g, '_')}.bin`;
