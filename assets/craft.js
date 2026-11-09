// 우주선: 텍스처 구 대신 NASA 3D 모델을 물리 기반 조명으로 — 금속이 비칠 우주 환경맵과 태양 하나
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FIXED_WORLD } from 'app/bodies.js';

const MSAA_SAMPLES = 4;
const MIN_METAL_ROUGHNESS = 0.42;     // 은박 반사가 뭉쳐 하얗게 번지지 않게

// 가는 구조물은 MSAA 없이는 끊어진다. 컴포저 타깃에 켜면 배경까지 표본을 저장하고 패스마다 풀어 프레임이 두 배로 든다.
// 우주선만 표본 타깃에 따로 그려 배경 위에 합성한다
export class SampledPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: MSAA_SAMPLES });
    this.quad = new FullScreenQuad(new THREE.MeshBasicMaterial({
      map: this.target.texture, depthTest: false, depthWrite: false, toneMapped: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, // 비운 타깃에 그려 이미 알파가 곱해져 있다
    }));
    this.clearColor = new THREE.Color();
  }
  setSize(width, height) { this.target.setSize(width, height); }
  render(renderer, writeBuffer, readBuffer) {
    const clearAlpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    renderer.getClearColor(this.clearColor);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.setRenderTarget(readBuffer);
    renderer.autoClear = false;
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }
}

function spaceEnvironment(renderer, sun) {
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: { uSun: { value: sun } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD; uniform vec3 uSun;
      void main(){
        vec3 n = normalize(vD); float a = max(dot(n, uSun), 0.0);
        vec3 c = vec3(.012, .018, .035) + vec3(.05, .08, .16) * (.5 + .5 * n.y) * .35;
        c += vec3(1., .95, .86) * (pow(a, 900.) * 90. + pow(a, 20.) * .5);
        gl_FragColor = vec4(c, 1.);
      }`,
  })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const { texture } = pmrem.fromScene(envScene, 0.01);
  pmrem.dispose();
  return texture;
}

export function createCraft({ body, renderer, scene, parent, radius, envSun, file, reduced, fade, onReady }) {
  const root = new THREE.Group();
  root.rotation.set(...body.pose);
  parent.add(root);
  const sun = new THREE.DirectionalLight(0xfff4e6, body.sun ?? 4);
  scene.add(sun, sun.target, new THREE.AmbientLight(0x8fa8d0, 0.06));
  scene.environment = spaceEnvironment(renderer, envSun);

  const fading = [];                  // 불투명 재질도 나타나는 동안만 투명 패스로 돌린다
  // 모델 파일(file)은 bodies.js 가 천체를 고를 때 이미 받기 시작 → 로더·디코더 모듈과 겹쳐 받음
  // - 모델 기하는 meshopt 압축(gltfpack) → 디코더 필요
  Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
    file,
  ]).then(([{ GLTFLoader }, { MeshoptDecoder }, data]) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data, '')).then(({ scene: model }) => {
    const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
    model.position.sub(sphere.center);
    root.scale.setScalar(radius / sphere.radius);
    root.add(model);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      if (o.material.metalness > 0.8) o.material.roughness = Math.max(o.material.roughness, MIN_METAL_ROUGHNESS);
      if (!reduced && !o.material.transparent) { o.material.transparent = true; o.material.opacity = 0; fading.push(o.material); }
    });
    onReady();
  }).catch((err) => {
    console.error(err);
    if (navigator.onLine && !FIXED_WORLD) location.reload();    // 셔플 백이 이미 넘어갔으니 다음 천체가 나온다
  });

  return {
    update(et) {
      // 무중력의 느린 자세 변화 — 주기가 다른 사인을 겹쳐 반복이 느껴지지 않게
      root.rotation.y = body.pose[1] + Math.sin(et * 0.061) * 0.14 + Math.sin(et * 0.037 + 1.3) * 0.09;
      root.rotation.x = body.pose[0] + Math.sin(et * 0.043 + 0.6) * 0.05;
      for (const m of fading) { m.opacity = fade.value; if (fade.value === 1) m.transparent = false; }
      if (fade.value === 1) fading.length = 0;
    },
    aimSun(dir) { sun.position.copy(dir).multiplyScalar(4000); },
  };
}
