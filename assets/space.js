import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ------------------------------------------------------------------ *
 *  gaerae.com — 우주 항해 랜딩 (Three.js / WebGL)
 *  사실적 딥스페이스 · 성간 먼지 · 지구형 행성 · 워프 스타필드
 * ------------------------------------------------------------------ */

const canvas = document.getElementById('space');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.body.classList.add('no-webgl');
  throw e;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x01020a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 8000);
const clock = new THREE.Clock();

// 태양(광원) 방향 — 화면 왼쪽 위에서 비추는 느낌 (뷰 공간 고정)
const LIGHT_DIR = new THREE.Vector3(-0.72, 0.28, 0.35).normalize();

/* ============================================================
 *  1. 성간 배경 (딥스페이스 먼지 + 사실적 별)
 * ============================================================ */
const nebulaUniforms = { uTime: { value: 0 } };

const nebula = new THREE.Mesh(
  new THREE.SphereGeometry(6000, 64, 64),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: nebulaUniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vDir;
      uniform float uTime;

      float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0;
        return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){
        vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                       mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                       mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<6;i++){v+=a*noise(p);p*=2.03;a*=0.5;} return v; }

      // 별 한 층: 셀 안 랜덤 위치에 점을 찍고 색온도/광도를 부여
      vec3 starLayer(vec3 dir, float scale, float thresh){
        vec3 p = dir * scale;
        vec3 id = floor(p);
        vec3 f = fract(p) - 0.5;
        float h = hash(id);
        if(h < thresh) return vec3(0.0);
        // 셀 내부 미세 위치로 점 형태
        vec2 off = vec2(hash(id+3.1), hash(id+7.7)) - 0.5;
        float d = length(f - vec3(off, 0.0).xyz*0.6);
        float mag = (h - thresh) / (1.0 - thresh);          // 0..1 광도
        float core = smoothstep(0.06 + 0.10*mag, 0.0, d);   // 밝은 별일수록 큼
        float tw = 0.75 + 0.25 * sin(uTime*2.5 + h*120.0);
        float temp = hash(id + 13.3);
        vec3 warm = vec3(1.0, 0.82, 0.66);
        vec3 cool = vec3(0.72, 0.82, 1.0);
        vec3 col = mix(vec3(1.0), mix(warm, cool, temp), 0.55);
        return col * core * pow(mag, 1.6) * tw;
      }

      void main(){
        vec3 dir = normalize(vDir);
        float t = uTime * 0.006;

        // 은하수 띠 (살짝 기울인 평면)
        vec3 axis = normalize(vec3(0.35, 1.0, 0.15));
        float lat = dot(dir, axis);
        float band = exp(-pow(lat*3.4, 2.0));

        // 성간 먼지 — 채도 낮은 청회색, 은하수 부근에 집중
        float dust = pow(clamp(fbm(dir*3.4 + t) * 0.65 + fbm(dir*7.0 - t*0.5)*0.4, 0.0, 1.0), 2.6);
        dust *= (0.35 + band * 0.9);
        vec3 dustCool = vec3(0.05, 0.08, 0.14);
        vec3 dustWarm = vec3(0.12, 0.10, 0.11);
        vec3 dustCol = mix(dustCool, dustWarm, fbm(dir*5.0));

        vec3 col = vec3(0.004, 0.006, 0.014);      // 심우주 바탕
        col += dustCol * dust * 0.55;
        col += vec3(0.05, 0.07, 0.12) * band * 0.10; // 은하수 미광

        // 별 (여러 층으로 깊이감)
        col += starLayer(dir, 130.0, 0.986) * 1.2;
        col += starLayer(dir, 260.0, 0.992) * 0.9;
        col += starLayer(dir, 520.0, 0.996) * 0.6;
        col += starLayer(dir, 90.0,  0.978) * (0.5 + band*0.8); // 은하수 밀집 별

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
scene.add(nebula);

/* ============================================================
 *  2. 워프 스타필드 (여행감 · 스크롤 시 가속)
 * ============================================================ */
const STAR_COUNT = 2200;
const SPREAD = 900;
const DEPTH = 2400;
const positions = new Float32Array(STAR_COUNT * 2 * 3);
const colors = new Float32Array(STAR_COUNT * 2 * 3);
const starData = [];

// 사실적 항성 색: 대부분 백색/청백색, 소수의 따뜻한 별
const palette = [
  [1.0, 1.0, 1.0],
  [0.82, 0.88, 1.0],
  [0.88, 0.92, 1.0],
  [1.0, 0.92, 0.82],
  [0.78, 0.85, 1.0],
];

function spawnStar(i, atFar) {
  const ang = Math.random() * Math.PI * 2;
  const rad = Math.pow(Math.random(), 0.5) * SPREAD;
  const x = Math.cos(ang) * rad;
  const y = Math.sin(ang) * rad * 0.72;
  const z = atFar ? -DEPTH * Math.random() : -DEPTH;
  const speed = 150 + Math.random() * 360;
  const c = palette[(Math.random() * palette.length) | 0];
  const b = 0.45 + Math.random() * 0.55;
  starData[i] = { x, y, z, speed, r: c[0] * b, g: c[1] * b, b: c[2] * b };
}
for (let i = 0; i < STAR_COUNT; i++) spawnStar(i, true);

const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const stars = new THREE.LineSegments(
  starGeo,
  new THREE.LineBasicMaterial({
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
);
scene.add(stars);

/* ============================================================
 *  2-b. 유성 (가끔 스쳐 지나가는 슈팅스타)
 * ============================================================ */
const NCOMET = 3;
const cometPos = new Float32Array(NCOMET * 2 * 3);
const cometCol = new Float32Array(NCOMET * 2 * 3);
const cometGeo = new THREE.BufferGeometry();
cometGeo.setAttribute('position', new THREE.BufferAttribute(cometPos, 3));
cometGeo.setAttribute('color', new THREE.BufferAttribute(cometCol, 3));
const comets = new THREE.LineSegments(
  cometGeo,
  new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
);
scene.add(comets);

const cometState = [];
function resetComet(i, initial) {
  const fromLeft = Math.random() < 0.5;
  cometState[i] = {
    x: fromLeft ? -950 : 950,
    y: 160 + Math.random() * 420,
    z: -500 - Math.random() * 520,
    vx: (fromLeft ? 1 : -1) * (520 + Math.random() * 300),
    vy: -(240 + Math.random() * 220),
    life: 0,
    dur: 1.3 + Math.random() * 1.1,
    delay: initial ? (2 + Math.random() * 16) : (8 + Math.random() * 20),
    active: false,
  };
}
for (let i = 0; i < NCOMET; i++) resetComet(i, true);

/* ============================================================
 *  3. 행성 (실제 텍스처 · 실사 라이팅) — 접속마다 랜덤
 * ============================================================ */
renderer.outputColorSpace = THREE.SRGBColorSpace;

const CDN = 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets/images/';
// map: 색상, bump: 요철(선택), rim: 대기 색, atmo: 대기 세기(무대기 천체는 낮게)
const PLANETS = [
  { map: 'marsmap1k.jpg',  bump: 'marsbump1k.jpg',  rim: [0.95, 0.55, 0.40], bumpScale: 12, atmo: 0.7 },
  { map: 'earthmap1k.jpg', bump: 'earthbump1k.jpg', rim: [0.35, 0.60, 1.00], bumpScale: 10, atmo: 1.0 },
  { map: 'mercurymap.jpg', bump: 'mercurybump.jpg', rim: [0.62, 0.62, 0.64], bumpScale: 12, atmo: 0.18 },
  { map: 'venusmap.jpg',   bump: 'venusbump.jpg',   rim: [1.00, 0.80, 0.45], bumpScale: 8,  atmo: 0.95 },
  { map: 'moonmap1k.jpg',  bump: 'moonbump1k.jpg',  rim: [0.55, 0.60, 0.68], bumpScale: 14, atmo: 0.14 },
  { map: 'jupitermap.jpg', bump: null,              rim: [0.90, 0.72, 0.52], bumpScale: 0,  atmo: 0.8 },
  { map: 'neptunemap.jpg', bump: null,              rim: [0.35, 0.55, 1.00], bumpScale: 0,  atmo: 0.9 },
  { map: 'uranusmap.jpg',  bump: null,              rim: [0.55, 0.85, 0.90], bumpScale: 0,  atmo: 0.85 },
  { map: 'plutomap1k.jpg', bump: 'plutobump1k.jpg', rim: [0.72, 0.66, 0.60], bumpScale: 10, atmo: 0.2 },
];
const P = PLANETS[Math.floor(Math.random() * PLANETS.length)];
const spin = 0.06 + Math.random() * 0.06; // 자전 속도(행성별 랜덤) — 눈에 보이게

const R = 420;
const planetGroup = new THREE.Group();
planetGroup.rotation.z = 0.30 + Math.random() * 0.30; // 자전축 기울기(랜덤)
// 화면 비율에 맞춰 배치: 데스크톱은 크게 잘려 웅장하게, 모바일은 우측에서 살짝 걸치게
function layoutPlanet() {
  if (window.innerWidth < 760) planetGroup.position.set(660, 190, -1440);
  else planetGroup.position.set(880, 255, -1430);
}
layoutPlanet();
scene.add(planetGroup);

// 태양광 (평행광) + 아주 옅은 우주 환경광
const sun = new THREE.DirectionalLight(0xfff1e0, 3.2);
sun.position.set(-1.0, 0.5, 0.75); // 왼쪽 위 앞에서
scene.add(sun);
scene.add(new THREE.AmbientLight(0x14171f, 1.0)); // 그림자측 미세 필

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(R, 160, 160),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, metalness: 0.0, bumpScale: P.bumpScale })
);
planetGroup.add(planet);

texLoader.load(CDN + P.map, (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  planet.material.map = t;
  planet.material.needsUpdate = true;
});
if (P.bump) texLoader.load(CDN + P.bump, (t) => {
  t.anisotropy = maxAniso;
  planet.material.bumpMap = t;
  planet.material.needsUpdate = true;
});

// 대기 림 (행성별 색·세기)
const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.045, 96, 96),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: {
      uLight: { value: new THREE.Vector3(-1.0, 0.5, 0.75).normalize() },
      uColor: { value: new THREE.Color(P.rim[0], P.rim[1], P.rim[2]) },
      uStrength: { value: P.atmo },
    },
    vertexShader: /* glsl */`
      varying vec3 vN;
      void main(){ vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vN; uniform vec3 uLight; uniform vec3 uColor; uniform float uStrength;
      void main(){
        vec3 n = normalize(vN);
        float rim = pow(1.0 - abs(dot(n, vec3(0.0,0.0,1.0))), 5.0);
        float lit = clamp(dot(n, normalize(uLight)) + 0.15, 0.0, 1.0);
        // 대기 산란 (행성 색·세기)
        vec3 c = uColor * rim * (0.15 + lit * 0.9) * uStrength;
        // 실루엣 분리용 미세 냉광 (무대기 천체도 우주와 구분)
        c += vec3(0.20, 0.34, 0.62) * rim * 0.13;
        float a = rim * (0.3 + lit * 0.55) * 0.7 * uStrength + rim * 0.10;
        gl_FragColor = vec4(c, a);
      }
    `,
  })
);
planetGroup.add(atmo);

/* ============================================================
 *  4. 후처리 (은은한 Bloom)
 * ============================================================ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.42,  // strength
  0.55,  // radius
  0.35   // threshold — 밝은 부분만
);
composer.addPass(bloom);

// 시네마틱 그레이딩: 색수차 + 필름 그레인 + 가장자리 감광 (SF 질감)
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0011 },
    uGrain: { value: 0.022 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAberration; uniform float uGrain;
    void main(){
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float d = dot(dir, dir);
      // 색수차: 가장자리로 갈수록 RGB 분리
      vec2 off = dir * d * uAberration * 6.0;
      float r = texture2D(tDiffuse, uv - off).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv + off).b;
      vec3 col = vec3(r, g, b);
      // 필름 그레인
      float n = fract(sin(dot(uv * 512.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      // 은은한 가장자리 감광
      col *= 1.0 - d * 0.18;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

/* ============================================================
 *  5. 인터랙션
 * ============================================================ */
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
window.addEventListener('pointermove', (e) => {
  mouse.tx = (e.clientX / window.innerWidth - 0.5);
  mouse.ty = (e.clientY / window.innerHeight - 0.5);
});

let warp = 1, warpTarget = 1;
let lastScroll = window.scrollY;
window.addEventListener('scroll', () => {
  const dy = Math.abs(window.scrollY - lastScroll);
  lastScroll = window.scrollY;
  warpTarget = Math.min(6, 1 + dy * 0.06);
}, { passive: true });

/* ============================================================
 *  6. 렌더 루프
 * ============================================================ */
const pos = starGeo.attributes.position.array;
const col = starGeo.attributes.color.array;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  nebulaUniforms.uTime.value = t;
  grade.uniforms.uTime.value = t;
  planetGroup.rotation.y += dt * spin; // 자전

  warpTarget += (1 - warpTarget) * dt * 1.6;
  warp += (warpTarget - warp) * dt * 4.0;

  for (let i = 0; i < STAR_COUNT; i++) {
    const s = starData[i];
    s.z += s.speed * warp * dt;
    if (s.z > 60) spawnStar(i, false);
    const streak = Math.min(s.speed * warp * dt * 2.4, 700);
    const o = i * 6;
    pos[o] = s.x; pos[o + 1] = s.y; pos[o + 2] = s.z;
    pos[o + 3] = s.x; pos[o + 4] = s.y; pos[o + 5] = s.z - streak;
    col[o] = s.r; col[o + 1] = s.g; col[o + 2] = s.b;
    col[o + 3] = s.r * 0.08; col[o + 4] = s.g * 0.08; col[o + 5] = s.b * 0.08;
  }
  starGeo.attributes.position.needsUpdate = true;
  starGeo.attributes.color.needsUpdate = true;

  // 유성 업데이트
  for (let i = 0; i < NCOMET; i++) {
    const c = cometState[i];
    const o = i * 6;
    if (!c.active) {
      c.delay -= dt;
      if (c.delay <= 0) { c.active = true; c.life = 0; }
      for (let k = 0; k < 6; k++) { cometPos[o + k] = 0; cometCol[o + k] = 0; }
      continue;
    }
    c.life += dt;
    c.x += c.vx * dt; c.y += c.vy * dt;
    const fade = Math.sin(Math.min(c.life / c.dur, 1) * Math.PI); // 서서히 나타났다 사라짐
    cometPos[o] = c.x;              cometPos[o + 1] = c.y;              cometPos[o + 2] = c.z;
    cometPos[o + 3] = c.x - c.vx * 0.11; cometPos[o + 4] = c.y - c.vy * 0.11; cometPos[o + 5] = c.z;
    const b = fade * 1.3;
    cometCol[o] = b; cometCol[o + 1] = b * 1.02; cometCol[o + 2] = b * 1.2; // 머리: 청백색
    cometCol[o + 3] = 0; cometCol[o + 4] = 0; cometCol[o + 5] = 0;          // 꼬리: 소멸
    if (c.life >= c.dur) resetComet(i, false);
  }
  cometGeo.attributes.position.needsUpdate = true;
  cometGeo.attributes.color.needsUpdate = true;

  mouse.x += (mouse.tx - mouse.x) * dt * 2.5;
  mouse.y += (mouse.ty - mouse.y) * dt * 2.5;
  camera.rotation.y = -mouse.x * 0.22;
  camera.rotation.x = mouse.y * 0.15;
  camera.position.x = mouse.x * 34;
  camera.position.y = -mouse.y * 26;

  composer.render();
}
animate();

/* ============================================================
 *  7. 리사이즈 + 로더 해제
 * ============================================================ */
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  layoutPlanet();
});

requestAnimationFrame(() => document.body.classList.add('ready'));
