// The walker's shadow, flattened along the sun onto the ground under its feet. With it, the
// sun's shadow map (house, garden, furniture: all still) only has to be redrawn when a door
// moves, not every frame for one moving person; that pass was most of the frame on an Iris Xe.
// Indoors it is hidden: there the sun only reaches a few patches by the windows.
import * as THREE from 'three';

export function createWalkerShadow(skinnedMesh, sunDir) {
  const uniforms = { sunDir: { value: sunDir.clone().normalize() }, groundY: { value: 0 } };
  const material = new THREE.MeshBasicMaterial({ color: 0x0b1018, transparent: true, opacity: 0.42, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  // overlapping limbs would stack into darker patches: the stencil lets each pixel be darkened once
  Object.assign(material, {
    depthWrite: false, stencilWrite: true, stencilRef: 1,
    stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 sunDir;\nuniform float groundY;')
      .replace('#include <project_vertex>', /* glsl */`
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        wp.xz -= sunDir.xz * ((wp.y - groundY) / max(sunDir.y, 0.05));
        wp.y = groundY + 0.012;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => 'walker-shadow';
  const mesh = new THREE.SkinnedMesh(skinnedMesh.geometry, material);
  mesh.bind(skinnedMesh.skeleton, skinnedMesh.bindMatrix);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  skinnedMesh.parent.add(mesh);
  mesh.position.copy(skinnedMesh.position);
  mesh.quaternion.copy(skinnedMesh.quaternion);
  mesh.scale.copy(skinnedMesh.scale);
  return {
    mesh,
    update(groundY, visible) {
      uniforms.groundY.value = groundY;
      mesh.visible = visible;
    },
  };
}
