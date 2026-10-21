import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { ktx2Loader } from './lib/load-model.js';

// the sky photo and the lawn: a project that re-encoded them as KTX2 next to the JPEGs (and called
// useKTX2 in lib/load-model.js) gets those, which stay compressed on the GPU
const loadImage = (url) => (ktx2Loader() ? ktx2Loader().loadAsync(url.replace(/\.\w+$/, '.ktx2')) : new THREE.TextureLoader().loadAsync(url));

// Outdoor world lit by a real photographed sky (Poly Haven, CC0): <name>_2k.hdr for the light and
// <name>_4k_bg.jpg (or .ktx2) for the background, in public/models/env.
const HDRI = 'kloofendal_48d_partly_cloudy';
// The HDRI is the background and, prefiltered once, the image-based lighting; the sun light
// and its shadows are aimed at the brightest point of the photo, so they agree with it.
// opts.hdri: another Poly Haven sky, its two files added to public/models/env
// opts.rotate: turn the whole sky (photo, light and sun) about the vertical by this angle in
// radians, to bring the sun round to the side a scene should be lit from
// opts.lawn: [x0, z0, x1, z1] a watered garden lawn (green, no dry patches) inside a plot,
// whatever the field in the photo looks like; opts.lawnTint: [r, g, b] its colour on the field's
export async function createWorld(renderer, scene, { hdri = HDRI, rotate = 0, lawn, lawnTint } = {}) {
  if (lawn) LAWN.value.set(...lawn);
  if (lawnTint) LAWN_TINT.value.set(...lawnTint);
  const hdr = await new RGBELoader().setDataType(THREE.HalfFloatType).loadAsync(`/models/env/${hdri}_2k.hdr`);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const { sunDir, horizon, field } = analyseSky(hdr);
  sunDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotate);

  // Background: the 4K version of the photo (the 2K HDR is 3.5x blurrier than the 3D people
  // at 1080p, which made them look pasted onto it), shipped as a JPEG already tone-mapped
  // offline with the same ACES curve. The frame is tone-mapped once at the end of the post
  // chain (main.js), so the dome undoes that curve exactly and the photo comes out unchanged
  // while sharing bloom, vignette and grain with the 3D scene.
  const bg = await loadImage(`/models/env/${hdri}_4k_bg.jpg`);
  bg.colorSpace = THREE.SRGBColorSpace;
  bg.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const dome = createSkyDome(bg, renderer.toneMappingExposure, field.clone().multiplyScalar(BG_INTENSITY));
  dome.rotation.y = rotate;
  scene.add(dome);
  scene.environmentRotation.y = rotate;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 1.1;
  pmrem.dispose();

  // a low sun (15 deg) is warm and a little softer; brighter made white clothes clip
  const sun = new THREE.DirectionalLight(0xffd9b0, 2.5);
  sun.position.copy(sunDir).multiplyScalar(30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  // wide enough for the long shadow of a low sun (15 deg: 3.7x a person's height)
  sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // distant people fade into the photo's horizon colour
  scene.fog = new THREE.Fog(horizon.clone().multiplyScalar(0.8), 10, 230);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), await createGroundMaterial(renderer, hdr, BG_INTENSITY, field, rotate));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return {
    sun,
    sunDir,
    groundMaterial: ground.material,
    // keep the shadow frustum centred on the player so a small map stays sharp; `back` is how
    // far toward the sun shadow casters are caught (raise it with a wider shadow camera)
    follow(target, back = 30) {
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(sunDir, back);
    },
  };
}

// Inverse of three.js' ACESFilmicToneMapping (fitted RRT+ODT and its colour matrices), so a
// pre-tone-mapped sRGB photo yields linear radiance that tone-maps back to itself.
function createSkyDome(texture, exposure, field) {
  const acesIn = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777);
  const acesOut = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      invIn: { value: acesIn.clone().invert() },
      invOut: { value: acesOut.clone().invert() },
      exposure: { value: exposure },
      field: { value: field },
      height: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane, behind everything
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      uniform mat3 invIn, invOut;
      uniform float exposure;
      uniform vec3 field;
      uniform float height;
      varying vec3 vDir;
      vec3 invRRT(vec3 y) {
        // y = (x (x + a) - b) / (x (c x + d) + e)  ->  quadratic in x, positive root
        const float a = 0.0245786, b = 0.000090537, c = 0.983729, d = 0.4329510, e = 0.238081;
        y = min(y, vec3(0.999));
        vec3 A = y * c - 1.0, B = y * d - a, C = y * e + b;
        return (-B - sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
      }
      void main() {
        vec3 dir = normalize(vDir);
        vec2 uv = vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        // explicit level 0: at the panorama seam (u wraps 1 -> 0) automatic mip selection
        // jumps to the smallest mip and draws a line; at 4K the photo is ~1:1 with the screen
        vec3 shown = textureLod(map, uv, 0.0).rgb;    // linear, after the offline ACES
        vec3 radiance = invIn * invRRT(invOut * shown) / (exposure / 0.6);
        // seen from high up (a helicopter), the photo's own ground below the horizon (the road
        // the photographer stood on) would show past the edge of the ground plane: fields instead
        radiance = mix(radiance, field, smoothstep(3.0, 30.0, height) * smoothstep(-0.004, -0.02, dir.y));
        gl_FragColor = vec4(max(radiance, 0.0), 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  dome.onBeforeRender = (r, s, camera) => {
    dome.position.copy(camera.position);
    mat.uniforms.height.value = camera.position.y;
    // follow the exposure (eye adaptation changes it), so the photo shows as photographed;
    // capped, so from a dark room the sky through a window still reads brighter than the room
    mat.uniforms.exposure.value = Math.min(r.toneMappingExposure, 1.2);
  };
  return dome;
}

// Sun direction = brightest pixel of the equirectangular HDRI (using three.js' equirect
// mapping, flipY), and the average colour just above the horizon for the fog.
function analyseSky(tex) {
  const { data: half, width: w, height: h } = tex.image;
  const data = new Float32Array(half.length);
  for (let i = 0; i < half.length; i++) data[i] = THREE.DataUtils.fromHalfFloat(half[i]);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < h >> 1; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const l = data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722;
      if (l > best) { best = l; bx = x; by = y; }
    }
  }
  const u = (bx + 0.5) / w, v = 1 - (by + 0.5) / h;
  const lon = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).normalize();

  const horizon = new THREE.Color(0, 0, 0);
  const row0 = Math.floor(h * 0.47), row1 = Math.floor(h * 0.49);
  let n = 0;
  for (let y = row0; y < row1; y++) {
    for (let x = 0; x < w; x += 4) {
      const o = (y * w + x) * 4;
      horizon.r += Math.min(data[o], 4); horizon.g += Math.min(data[o + 1], 4); horizon.b += Math.min(data[o + 2], 4);
      n++;
    }
  }
  horizon.multiplyScalar(0.85 / n);
  // the photographed far fields just below the horizon, averaged all around: the colour far
  // ground hazes into when seen from above
  const field = new THREE.Color(0, 0, 0);
  n = 0;
  for (let y = Math.floor(h * 0.503); y < Math.floor(h * 0.515); y++) {
    for (let x = 0; x < w; x += 4) {
      const o = (y * w + x) * 4;
      field.r += Math.min(data[o], 4); field.g += Math.min(data[o + 1], 4); field.b += Math.min(data[o + 2], 4);
      n++;
    }
  }
  field.multiplyScalar(1 / n);
  return { sunDir, horizon, field };
}

export const GROUND_SIZE = 2000;
const BG_INTENSITY = 0.85; // the background photo's brightness against the HDR light
const TILE = 2.5; // metres per texture tile
const GRASS_NDL = 0.45;

// ground colour lookup, shared with the 3D grass blades (grass.js) so they match exactly.
// GROUND_NOISE goes at file scope (after <common>), GROUND_MAP_FRAGMENT replaces <map_fragment>.
// the watered lawn rectangle (x0, z0, x1, z1); empty (x0 > x1) by default
export const LAWN = { value: new THREE.Vector4(1, 1, 0, 0) };
export const LAWN_TINT = { value: new THREE.Vector3(0.86, 0.98, 0.7) };
export const GROUND_NOISE = /* glsl */`
  uniform vec4 lawnRect;
  uniform vec3 lawnTint;
  float gHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float gNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;
export const GROUND_MAP_FRAGMENT = /* glsl */`
  vec4 g1 = texture2D(map, vMapUv);
  vec4 g2 = texture2D(map, mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.43 + 0.31);
  float blend = smoothstep(0.35, 0.65, texture2D(map, vMapUv * 0.061 + 0.2).g * 2.2);
  float macro = smoothstep(0.15, 0.4, texture2D(map, vMapUv * 0.013 + 0.5).g);
  vec4 g = mix(g1, g2, blend);
  g.rgb *= mix(vec3(0.82, 0.86, 0.8), vec3(1.1, 1.08, 1.0), macro);
  diffuseColor *= g;
  // a real lawn is never uniform: worn, dry, yellowed patches (tens of metres, ragged edges)
  // and a little less saturation overall, to match the grass in the photo
  {
    vec2 gw = vec2(vMapUv.x * ${TILE.toFixed(1)} - ${(GROUND_SIZE / 2).toFixed(1)}, ${(GROUND_SIZE / 2).toFixed(1)} - vMapUv.y * ${TILE.toFixed(1)});
    float lawn = step(lawnRect.x, gw.x) * step(gw.x, lawnRect.z) * step(lawnRect.y, gw.y) * step(gw.y, lawnRect.w);
    float n = gNoise(vMapUv * 0.09) * 0.65 + gNoise(vMapUv * 0.31 + 7.3) * 0.25 + gNoise(vMapUv * 1.7 + 3.1) * 0.1;
    float worn = smoothstep(0.5, 0.68, n);
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, 0.86 + 0.14 * lawn);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(1.2, 1.02, 0.68), worn * 0.85 * (1.0 - lawn));
    diffuseColor.rgb *= mix(vec3(1.0), lawnTint, lawn);
    // even a watered lawn varies: soft patches lighter and yellower or darker and lusher (at
    // +-17% it still read as one flat carpet)
    float patchy = gNoise(vMapUv * 0.35 + 11.7) * 0.6 + gNoise(vMapUv * 1.3 + 2.9) * 0.4 - 0.5;
    diffuseColor.rgb *= 1.0 + lawn * patchy * vec3(0.62, 0.46, 0.12);
  }
`;

async function createGroundMaterial(renderer, sky, skyIntensity, field, skyRotate = 0) {
  const [map, normalMap, roughnessMap] = await Promise.all(
    ['grass_diff.jpg', 'grass_nor_gl.jpg', 'grass_rough.jpg'].map((f) => loadImage('/models/env/' + f)),
  );
  map.colorSpace = THREE.SRGBColorSpace;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.setScalar(GROUND_SIZE / TILE);
    t.anisotropy = aniso;
  }
  // the scan is darker and browner than the lawn in the photo; lift and green it so it meets
  // the photographed field at the same brightness (with the grass sunlight term below)
  const mat = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, metalness: 0, fog: false });
  mat.color.setRGB(1.65, 2.3, 1.0, THREE.LinearSRGBColorSpace);
  // 1. hide the tiling: blend in a rotated second sample at another scale, and modulate
  //    brightness and hue with very low-frequency lookups of the same texture
  // 2. toward the horizon, cross-fade into the photo itself (its own ground in the same view
  //    direction), so the plane melts into the real horizon instead of ending at a fog band
  // 3. a lawn is not a flat floor: its blades stand up and catch a low sun far better than
  //    the plane's normal says, so direct sunlight counts as if it came at least GRASS_NDL
  //    from the surface (without it the field seen from above was dark next to the people)
  const grassNdl = { value: GRASS_NDL };
  mat.userData.grassNdl = grassNdl;
  const lights = THREE.ShaderChunk.lights_fragment_begin;
  const dirAt = lights.indexOf('RE_Direct(', lights.indexOf('getDirectionalLightInfo'));
  const grassLights = lights.slice(0, dirAt)
    + 'directLight.color *= max(dot(geometryNormal, directLight.direction), grassNdl) / max(dot(geometryNormal, directLight.direction), 1e-3);\n\t\t'
    + lights.slice(dirAt);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.grassNdl = grassNdl;
    shader.uniforms.lawnRect = LAWN;
    shader.uniforms.lawnTint = LAWN_TINT;
    shader.uniforms.skyMap = { value: sky };
    shader.uniforms.skyIntensity = { value: skyIntensity };
    shader.uniforms.fieldColor = { value: field };
    shader.uniforms.skyRotate = { value: skyRotate };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nuniform sampler2D skyMap;\nuniform float skyIntensity;\nuniform vec3 fieldColor;\nuniform float grassNdl;\nuniform float skyRotate;\n' + GROUND_NOISE)
      .replace('#include <tonemapping_fragment>', /* glsl */`
        vec3 viewDir = normalize(vWorld - cameraPosition);
        // the photo turned with the sky (opts.rotate): look it up in its own frame
        float cr = cos(skyRotate), sr = sin(skyRotate);
        vec3 photoDir = vec3(cr * viewDir.x - sr * viewDir.z, viewDir.y, sr * viewDir.x + cr * viewDir.z);
        vec3 photo = texture2D(skyMap, equirectUv(photoDir)).rgb * skyIntensity;
        // by the angle below the horizon, not the distance: from eye height this is the same
        // 45-260 m band, but from a helicopter or a high camera only the strip just under the
        // horizon comes from the photo (its own ground right below would show at the wrong scale);
        // farther ground hazes toward the photo's average field colour instead
        float below = -viewDir.y;
        float high = smoothstep(3.0, 30.0, cameraPosition.y);
        float far = length(vWorld - cameraPosition);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fieldColor * skyIntensity, high * (smoothstep(60.0, 500.0, far) * 0.85 + smoothstep(500.0, 950.0, far) * 0.15));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, photo, smoothstep(mix(0.036, 0.012, high), mix(0.006, 0.002, high), below));
        #include <tonemapping_fragment>`)
      .replace('#include <map_fragment>', GROUND_MAP_FRAGMENT)
      .replace('#include <lights_fragment_begin>', grassLights);
  };
  return mat;
}
