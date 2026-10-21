import * as THREE from 'three';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// A camera-like finish for the whole frame, so the 3D people and the photographed sky share
// one "lens":
//  1. the scene renders once into a half-float target with a depth texture (HDR);
//  2. ambient occlusion is computed at half resolution from that depth alone (normals are
//     reconstructed from depth), so nothing is rendered twice and the crowd's custom GPU
//     skinning needs no special depth/normal material;
//  3. one final pass applies the AO, a gentle vignette and a hint of chromatic aberration
//     toward the corners, then tone-maps once (ACES + film grain, see main.js) into an 8-bit
//     sRGB target at screen resolution, scaling the scene up when dynamic resolution has
//     shrunk it;
//  4. SMAA antialiases that image onto the screen. FXAA (used before) smears texture detail
//     and leaves thin shapes such as arms, legs and their long shadows stair-stepped, which
//     read as a pixelated crowd.
// Measured on Iris Xe at 1024x768: a 4x multisampled float target cost ~7 ms and three.js'
// UnrealBloom ~3 ms, so neither is used.
const QUAD_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const AO_FS = /* glsl */`
  uniform sampler2D tDepth;
  uniform mat4 projInv;
  uniform float projScale; // proj[1][1] * 0.5: metres at 1 m depth -> uv units
  uniform float RADIUS;     // metres (quality.aoRadius)
  uniform float STRENGTH;   // quality.aoStrength
  uniform float aspect;
  uniform vec2 uvScale; // the scene fills [0, uvScale] of its target (dynamic resolution)
  varying vec2 vUv;
  vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, min(uv, 1.0) * uvScale).x;
    vec4 p = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  void main() {
    float depth = texture2D(tDepth, vUv * uvScale).x;
    if (depth >= 1.0) { gl_FragColor = vec4(1.0); return; }
    vec3 P = viewPos(vUv);
    vec3 N = normalize(cross(dFdx(P), dFdy(P)));
    if (dot(N, P) > 0.0) N = -N;
    float rUv = RADIUS * projScale / -P.z;
    // per-pixel rotation of the sample spiral (interleaved gradient noise), blurred later
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float occ = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i) + 0.5;
      float a = fi * 2.39996 + noise * 6.2831853;
      vec2 off = vec2(cos(a) / aspect, sin(a)) * rUv * sqrt(fi / 12.0);
      vec3 v = viewPos(vUv + off) - P;
      float d2 = dot(v, v);
      occ += max(0.0, dot(N, v) * inversesqrt(d2 + 1e-4) - 0.1) * (1.0 - smoothstep(0.0, RADIUS * RADIUS, d2));
    }
    gl_FragColor = vec4(vec3(clamp(1.0 - occ / 12.0 * STRENGTH, 0.0, 1.0)), 1.0);
  }`;

const FINAL_FS = /* glsl */`
  #include <tonemapping_pars_fragment>
  uniform sampler2D tColor;
  uniform sampler2D tAO;
  uniform vec2 texel;
  uniform vec2 aoTexel;
  uniform float aspect;
  uniform float sharpen;
  uniform vec2 uvScale;  // the scene fills [0, uvScale] of its target (dynamic resolution)
  uniform vec2 uvMax;    // half a texel inside that area, so bilinear reads never leave it
  uniform float aoOn;
  varying vec2 vUv;
  vec3 scene(vec2 uv) { return texture2D(tColor, min(uv * uvScale, uvMax)).rgb; }
  void main() {
    vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
    float r2 = dot(d, d);
    vec3 c = scene(vUv);
    // when the scene renders below screen resolution (dynamic resolution), win back some of
    // the detail lost to the upscale with a light unsharp mask
    if (sharpen > 0.0) {
      vec3 blur = 0.25 * (scene(vUv + vec2(texel.x, 0.0)) + scene(vUv - vec2(texel.x, 0.0))
        + scene(vUv + vec2(0.0, texel.y)) + scene(vUv - vec2(0.0, texel.y)));
      c = max(c + (c - blur) * sharpen, 0.0);
    }
    vec2 shift = (vUv - 0.5) * r2 * 0.004;
    c.r = mix(c.r, scene(vUv + shift).r, smoothstep(0.1, 0.5, r2));
    c.b = mix(c.b, scene(vUv - shift).b, smoothstep(0.1, 0.5, r2));
    // blurred half-resolution ambient occlusion (removes the sample-rotation noise)
    if (aoOn > 0.5) {
      float ao = 0.0;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) ao += texture2D(tAO, min((vUv + vec2(x, y) * aoTexel * 1.5) * uvScale, uvMax)).r;
      c *= mix(1.0, ao / 9.0, 0.8);
    }
    c *= mix(1.0, 0.74, smoothstep(0.15, 0.9, r2));
    // three only tone-maps when drawing to the screen; this pass draws into the SMAA input,
    // so it tone-maps (main.js' CustomToneMapping: ACES + grain) and encodes sRGB itself
    gl_FragColor = sRGBTransferOETF(vec4(CustomToneMapping(c), 1.0));
  }`;

export function createPost(renderer, scene, camera) {
  // depth with stencil: projected shadows use the stencil to darken each pixel once
  const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type);
  depthTexture.format = THREE.DepthStencilFormat;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture, stencilBuffer: true });
  const aoRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
  // the tone-mapped, sRGB-encoded frame (raw bytes: SMAA works on gamma-space colour)
  const ldrRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
  const smaa = new SMAAPass(1, 1);
  smaa.renderToScreen = true;

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const aoMat = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: sceneRT.depthTexture }, projInv: { value: new THREE.Matrix4() }, projScale: { value: 1 }, aspect: { value: 1 }, RADIUS: { value: 0.55 }, STRENGTH: { value: 2.8 },
      uvScale: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: QUAD_VS, fragmentShader: AO_FS, depthTest: false, depthWrite: false,
  });
  const finalMat = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: sceneRT.texture }, tAO: { value: aoRT.texture },
      texel: { value: new THREE.Vector2() }, aoTexel: { value: new THREE.Vector2() }, aspect: { value: 1 }, sharpen: { value: 0 },
      uvScale: { value: new THREE.Vector2(1, 1) }, uvMax: { value: new THREE.Vector2(1, 1) }, aoOn: { value: 1 },
      toneMappingExposure: { value: renderer.toneMappingExposure },
    },
    vertexShader: QUAD_VS, fragmentShader: FINAL_FS, depthTest: false, depthWrite: false,
  });
  finalMat.toneMapped = false;

  // Targets are allocated once at screen resolution (setSize, on window resize). Dynamic
  // resolution (setScale) only renders the scene into a smaller corner of them and has the
  // later passes read that corner: reallocating the targets at every step stalled the GPU, so
  // the frame hitched whenever the load changed, e.g. while running.
  let SW = 1, SH = 1, scale = 1;
  const setScale = (s) => {
    scale = s;
    const W = Math.max(1, Math.round(SW * s)), H = Math.max(1, Math.round(SH * s));
    sceneRT.viewport.set(0, 0, W, H);
    sceneRT.scissor.set(0, 0, W, H);
    sceneRT.scissorTest = s < 1;
    aoRT.viewport.set(0, 0, Math.max(1, W >> 1), Math.max(1, H >> 1));
    const u = finalMat.uniforms;
    u.uvScale.value.set(W / SW, H / SH);
    u.uvMax.value.set((W - 0.5) / SW, (H - 0.5) / SH);
    aoMat.uniforms.uvScale.value.set(W / SW, H / SH);
    // texel steps, in units of the visible area (the shader multiplies by uvScale)
    u.texel.value.set(1 / W, 1 / H);
    u.aoTexel.value.set(2 / W, 2 / H);
    // light: stronger sharpening rings around every edge of the upscaled picture
    u.sharpen.value = s < 0.999 ? (1 - s) * 0.6 : 0;
  };
  const setSize = (w, h, ratio) => {
    SW = Math.round(w * ratio); SH = Math.round(h * ratio);
    sceneRT.setSize(SW, SH);
    aoRT.setSize(Math.max(1, SW >> 1), Math.max(1, SH >> 1));
    ldrRT.setSize(SW, SH);
    smaa.setSize(SW, SH);
    finalMat.uniforms.aspect.value = aoMat.uniforms.aspect.value = w / h;
    setScale(scale);
  };
  const size = renderer.getSize(new THREE.Vector2());
  setSize(size.x, size.y, renderer.getPixelRatio());

  // quality switches: ambient occlusion and SMAA can be turned off on very weak GPUs;
  // aoRadius: how far occluders reach, metres (0.55 suits people outdoors, ~1 room corners);
  // aoStrength: how dark full occlusion gets (rooms lit only by bounce light take more)
  const quality = { ao: true, smaa: true, aoRadius: 0.55, aoStrength: 2.8 };
  return {
    setSize,
    setScale,
    quality,
    targets: { sceneRT, aoRT, ldrRT },
    render() {
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      finalMat.uniforms.aoOn.value = quality.ao ? 1 : 0;
      if (quality.ao) {
        aoMat.uniforms.projInv.value.copy(camera.projectionMatrixInverse);
        aoMat.uniforms.projScale.value = camera.projectionMatrix.elements[5] * 0.5;
        aoMat.uniforms.RADIUS.value = quality.aoRadius;
        aoMat.uniforms.STRENGTH.value = quality.aoStrength;
        quad.material = aoMat;
        renderer.setRenderTarget(aoRT);
        renderer.render(quadScene, quadCam);
      }
      quad.material = finalMat;
      finalMat.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(quality.smaa ? ldrRT : null);
      renderer.render(quadScene, quadCam);
      if (quality.smaa) smaa.render(renderer, null, ldrRT);
    },
  };
}
