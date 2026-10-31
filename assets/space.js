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
  document.body.classList.add('no-webgl', 'ready'); // 로더 해제 + 폴백 배경
  throw e;
}

const isMobile = window.matchMedia('(max-width: 760px)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2)); // 모바일 품질 스케일
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x01020a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 8000);
const clock = new THREE.Clock();
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches; // 모션 최소화 선호
let running = true;          // 탭 숨김 / 컨텍스트 손실 시 렌더 정지
let contextLost = false;
let reduceRenderUntil = 2.4; // reduce 모드: 텍스처 로드까지만 렌더 후 정지(초)

/* 방문자 현지 시간 · 오늘 달 위상에 맞춘 하늘 (실재와 동기화) */
function computeSky() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const dayness = 0.5 - 0.5 * Math.cos((hour / 24) * Math.PI * 2); // 0 자정 … 1 정오
  const night = 1 - dayness;
  const synodic = 29.53058867;
  const refNew = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  let ph = (((now.getTime() / 86400000) - refNew) % synodic) / synodic;
  if (ph < 0) ph += 1;
  const illum = 0.5 * (1 - Math.cos(ph * Math.PI * 2)); // 0 그믐 … 1 보름
  const theta = (1 - Math.max(0.12, illum)) * 0.82 * Math.PI; // 밝은 면 비율 → 태양 각(완전 암흑 방지)
  const sunDir = new THREE.Vector3(Math.sin(theta) * -0.78, Math.sin(theta) * 0.34 + 0.12, Math.cos(theta)).normalize();
  return { night, illum, sunDir };
}
const SKY = computeSky();

/* ============================================================
 *  1. 성간 배경 (딥스페이스 먼지 + 사실적 별 · 현지 시간 반영)
 * ============================================================ */
const nebulaUniforms = { uTime: { value: 0 }, uNight: { value: SKY.night } };

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
      uniform float uNight;

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
        float t = uTime * 0.02;   // 느리게 흐름

        // 은하수 띠 (살짝 기울인 평면)
        vec3 axis = normalize(vec3(0.35, 1.0, 0.15));
        float lat = dot(dir, axis);
        float band = exp(-pow(lat*3.4, 2.0));

        // 흐르는 오로라 — 도메인 워프된 fbm 이 천천히 일렁임
        vec3 q = dir * 2.2;
        vec3 w = vec3(fbm(q + vec3(0.0, t, 0.0)),
                      fbm(q + vec3(t*0.7, 0.0, 1.3)),
                      fbm(q + vec3(1.7, t*0.5, 0.0)));
        float aur = fbm(q * 1.4 + w * 1.6 + vec3(-t*0.5, t*0.3, t*0.2));
        aur = pow(clamp(aur, 0.0, 1.0), 2.0);
        // 색이 천천히 순환 (teal ↔ violet ↔ blue)
        float hue = fbm(q * 0.8 + vec3(t * 0.4));
        vec3 aurCol = mix(mix(vec3(0.08, 0.42, 0.52), vec3(0.34, 0.18, 0.60),
                              smoothstep(0.30, 0.70, hue)),
                          vec3(0.10, 0.26, 0.58), smoothstep(0.55, 0.95, hue));

        // 성간 먼지(사실적 바탕)
        float dust = pow(clamp(fbm(dir*3.4 + t*0.3) * 0.65 + fbm(dir*7.0 - t*0.2)*0.4, 0.0, 1.0), 2.6);
        dust *= (0.35 + band * 0.9);

        vec3 col = vec3(0.004, 0.006, 0.014);          // 심우주 바탕
        col += vec3(0.05, 0.07, 0.12) * dust * 0.5;    // 먼지
        col += aurCol * aur * (0.13 + band * 0.22);    // 오로라 (은은)
        col += vec3(0.05, 0.07, 0.12) * band * 0.10;   // 은하수 미광

        // 별 (여러 층으로 깊이감) — 밤일수록 더 또렷
        float sb = 0.6 + 0.7 * uNight;
        col += starLayer(dir, 130.0, 0.986) * 1.2 * sb;
        col += starLayer(dir, 260.0, 0.992) * 0.9 * sb;
        col += starLayer(dir, 520.0, 0.996) * 0.6 * sb;
        col += starLayer(dir, 90.0,  0.978) * (0.5 + band*0.8) * sb; // 은하수 밀집 별

        // 낮일수록 옅은 하늘빛 (방문자 현지 시간)
        col += vec3(0.03, 0.06, 0.11) * (1.0 - uNight) * 0.5;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
scene.add(nebula);

/* ============================================================
 *  2. 워프 스타필드 (여행감 · 스크롤 시 가속)
 * ============================================================ */
const STAR_COUNT = isMobile ? 1200 : 2200;
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
  const speed = 34 + Math.random() * 74;   // 느린 드리프트
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
    vx: (fromLeft ? 1 : -1) * (300 + Math.random() * 220),
    vy: -(150 + Math.random() * 150),
    life: 0,
    dur: 1.8 + Math.random() * 1.4,
    delay: initial ? (3 + Math.random() * 18) : (12 + Math.random() * 24),
    active: false,
  };
}
for (let i = 0; i < NCOMET; i++) resetComet(i, true);

/* ============================================================
 *  3. 행성 (실제 텍스처 · 실사 라이팅) — 접속마다 랜덤
 * ============================================================ */
renderer.outputColorSpace = THREE.SRGBColorSpace;

const TX = 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets/images/';
// 특징이 뚜렷해 실사감이 좋은 천체만 선별
const PLANETS = [
  { name: 'Mars',    map: TX + 'marsmap1k.jpg',  bump: TX + 'marsbump1k.jpg', rim: [0.95, 0.55, 0.40], bumpScale: 14, atmo: 0.7, rough: 0.98 },
  { name: 'Jupiter', map: TX + 'jupitermap.jpg', rim: [0.92, 0.74, 0.54], atmo: 0.85, rough: 0.95 },
  { name: 'Venus',   map: TX + 'venusmap.jpg',   bump: TX + 'venusbump.jpg', rim: [1.00, 0.80, 0.45], bumpScale: 9, atmo: 0.95, rough: 0.98 },
];
const P = PLANETS[Math.floor(Math.random() * PLANETS.length)];
const spin = 0.05 + Math.random() * 0.05; // 자전 속도(랜덤)

const R = 420;
const planetGroup = new THREE.Group();
planetGroup.rotation.z = 0.28 + Math.random() * 0.26; // 자전축 기울기(랜덤)
// 화면 비율에 맞춰 배치: 데스크톱은 크게 잘려 웅장하게, 모바일은 우측에서 살짝 걸치게
let planetBaseY = 255;
function layoutPlanet() {
  if (window.innerWidth < 760) planetGroup.position.set(660, 190, -1440);
  else planetGroup.position.set(880, 255, -1430);
  planetBaseY = planetGroup.position.y;
}
layoutPlanet();
scene.add(planetGroup);

// 태양광 (평행광) — 오늘 달 위상에 맞춘 방향 + 아주 옅은 우주 환경광
const sun = new THREE.DirectionalLight(0xfff1e0, P.light ?? 3.0);
sun.position.copy(SKY.sunDir);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x1a1e26, 1.0)); // 그림자측 미세 필

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(R, 192, 192),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: P.rough, metalness: 0.0, bumpScale: P.bumpScale || 0, transparent: true, opacity: 0 })
);
planet.visible = false; // 텍스처 준비 전엔 숨김(검은 구체 방지)
planetGroup.add(planet);
let planetFadeIn = false;

// 지구 전용 구름층 (살짝 큰 구 + 반투명, 표면보다 살짝 빠르게 어긋나 회전)
let clouds = null;
if (P.clouds) {
  clouds = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.012, 128, 128),
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, roughness: 1.0 })
  );
  clouds.visible = false;
  clouds.renderOrder = 1;
  planetGroup.add(clouds);
}

function onTexLoaded() {
  // reduce 모드: 텍스처가 도착하면 그 프레임까지 렌더(이미 멈췄으면 재개)
  reduceRenderUntil = clock.elapsedTime + 0.6;
  if (REDUCE && !running && !contextLost) { running = true; clock.getDelta(); animate(); }
}
texLoader.load(P.map, (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  planet.material.map = t;
  planet.material.needsUpdate = true;
  planet.visible = true; atmo.visible = true;       // 텍스처 준비 → 행성 등장
  if (REDUCE) planet.material.opacity = 1; else planetFadeIn = true;
  onTexLoaded();
});
if (P.bump) texLoader.load(P.bump, (t) => {
  t.anisotropy = maxAniso; planet.material.bumpMap = t; planet.material.needsUpdate = true; onTexLoaded();
});
if (P.normal) texLoader.load(P.normal, (t) => {
  t.anisotropy = maxAniso; planet.material.normalMap = t;
  planet.material.normalScale = new THREE.Vector2(0.45, 0.45); planet.material.needsUpdate = true; onTexLoaded();
});
if (P.clouds && clouds) texLoader.load(P.clouds, (t) => {
  t.anisotropy = maxAniso; clouds.material.alphaMap = t; clouds.material.needsUpdate = true;
  clouds.visible = true; if (REDUCE) clouds.material.opacity = 0.55;
});

// 대기 림 (행성별 색·세기)
const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.045, 96, 96),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: {
      uLight: { value: SKY.sunDir.clone() },
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
atmo.visible = false; // 행성과 함께 등장
atmo.renderOrder = 2;

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
    uAberration: { value: 0.0006 },
    uGrain: { value: 0.010 },
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
  warpTarget = Math.min(2.4, 1 + dy * 0.03);   // 스크롤 가속 완만하게
}, { passive: true });

// 인터랙티브 행성: 드래그로 굴리기(관성)
let dragging = false, dragLX = 0, dragLY = 0, velY = 0, velX = 0;
const isInteractive = (el) => el && el.closest && el.closest('a, button, input, textarea');
window.addEventListener('pointerdown', (e) => {
  if (REDUCE || e.button !== 0 || isInteractive(e.target)) return;
  e.preventDefault(); // 드래그 중 텍스트 선택 방지
  dragging = true; dragLX = e.clientX; dragLY = e.clientY; velY = velX = 0;
  document.body.classList.add('grabbing');
});
window.addEventListener('pointerup', () => {
  if (dragging) { dragging = false; document.body.classList.remove('grabbing'); }
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragLX, dy = e.clientY - dragLY;
  dragLX = e.clientX; dragLY = e.clientY;
  velY = dx * 0.006; velX = dy * 0.006;
  planetGroup.rotation.y += velY;
  planetGroup.rotation.x = Math.max(-0.7, Math.min(0.7, planetGroup.rotation.x + velX));
});

// 워프 투 이동: 떠나는 순간 별이 가속 → 플래시 후 이동(같은 탭) — 블로그·GitHub 버튼
let departing = false;
function warpDepart(url) {
  departing = true;
  document.body.classList.add('departing');
  setTimeout(() => { window.location.href = url; }, 650);
}
document.querySelectorAll('.cta .btn').forEach((b) => {
  b.addEventListener('click', (e) => {
    if (REDUCE || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // 새 탭/수정키는 기본 동작
    e.preventDefault();
    warpDepart(b.href);
  });
});

// 뒤로가기(bfcache) 복원 시 플래시·워프 상태 초기화 (밝은 화면 잔상 방지)
window.addEventListener('pageshow', () => {
  departing = false;
  document.body.classList.remove('departing');
  warp = 1; warpTarget = 1;
});

// 행성 이름 라벨 — 접속 시 잠깐 표시
const planetLabel = document.getElementById('planet-label');
if (planetLabel) {
  planetLabel.innerHTML = '◦&nbsp; ' + P.name;
  setTimeout(() => planetLabel.classList.add('show'), 700);
  setTimeout(() => planetLabel.classList.remove('show'), 5400);
}

/* ============================================================
 *  6. 렌더 루프
 * ============================================================ */
const pos = starGeo.attributes.position.array;
const col = starGeo.attributes.color.array;

function animate() {
  if (!running || contextLost) return;
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const et = clock.elapsedTime;
  const tt = REDUCE ? 0.0 : et;   // 셰이더 시간 (reduce면 정지)

  nebulaUniforms.uTime.value = tt;
  grade.uniforms.uTime.value = tt;

  if (!REDUCE) {
    planetGroup.rotation.y += dt * spin;                        // 자전
    if (!dragging) {                                            // 드래그 관성 + 수평 복귀
      planetGroup.rotation.y += velY;
      planetGroup.rotation.x = Math.max(-0.7, Math.min(0.7, planetGroup.rotation.x + velX));
      velY *= 0.94; velX *= 0.94;
      planetGroup.rotation.x += (0 - planetGroup.rotation.x) * dt * 0.25;
    }
    planetGroup.position.y = planetBaseY + Math.sin(et * 0.4) * 7; // 미세한 부유
    atmo.scale.setScalar(1.0 + Math.sin(et * 0.5) * 0.014);     // 숨쉬는 대기 글로우
    if (planetFadeIn && planet.material.opacity < 1) planet.material.opacity = Math.min(1, planet.material.opacity + dt * 1.8); // 행성 페이드인
    if (clouds) {
      clouds.rotation.y += dt * spin * 0.35; // 표면보다 살짝 빠르게
      if (planetFadeIn && clouds.material.opacity < 0.55) clouds.material.opacity = Math.min(0.55, clouds.material.opacity + dt * 1.5);
    }
    if (departing) {
      warp += (120 - warp) * dt * 2.5;                          // 떠남: 워프 가속
    } else {
      warpTarget += (1 - warpTarget) * dt * 1.6;
      warp += (warpTarget - warp) * dt * 4.0;
    }
  }

  // 워프 별 (reduce면 정지 · 점으로 표시)
  const sw = REDUCE ? 0 : warp;
  const tailMul = REDUCE ? 1.0 : 0.08;
  for (let i = 0; i < STAR_COUNT; i++) {
    const s = starData[i];
    s.z += s.speed * sw * dt;
    if (!REDUCE && s.z > 60) spawnStar(i, false);
    const streak = REDUCE ? 2.0 : Math.min(s.speed * warp * dt * 3.2, departing ? 1600 : 90); // 짧고 부드러운 꼬리
    const o = i * 6;
    pos[o] = s.x; pos[o + 1] = s.y; pos[o + 2] = s.z;
    pos[o + 3] = s.x; pos[o + 4] = s.y; pos[o + 5] = s.z - streak;
    col[o] = s.r; col[o + 1] = s.g; col[o + 2] = s.b;
    col[o + 3] = s.r * tailMul; col[o + 4] = s.g * tailMul; col[o + 5] = s.b * tailMul;
  }
  starGeo.attributes.position.needsUpdate = true;
  starGeo.attributes.color.needsUpdate = true;

  // 유성 (reduce면 숨김)
  for (let i = 0; i < NCOMET; i++) {
    const c = cometState[i];
    const o = i * 6;
    if (REDUCE) { for (let k = 0; k < 6; k++) { cometPos[o + k] = 0; cometCol[o + k] = 0; } continue; }
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

  // 마우스 패럴랙스 (reduce / 드래그 중엔 정지)
  if (!REDUCE && !dragging) {
    mouse.x += (mouse.tx - mouse.x) * dt * 1.1;   // 느린 easing
    mouse.y += (mouse.ty - mouse.y) * dt * 1.1;
    camera.rotation.y = -mouse.x * 0.17;
    camera.rotation.x = mouse.y * 0.11;
    camera.position.x = mouse.x * 26;
    camera.position.y = -mouse.y * 20;
  }

  composer.render();

  if (REDUCE && et > reduceRenderUntil) running = false; // 정지(배터리 절약)
}
animate();

/* ============================================================
 *  7. 리사이즈 · 가시성 · 컨텍스트 복구 · 로더 해제
 * ============================================================ */
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  layoutPlanet();
  if (!running && !contextLost) composer.render(); // 정지 상태에서도 레이아웃 반영
});

// 탭 숨김 시 렌더 정지(배터리 절약), 복귀 시 재개
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { running = false; }
  else if (!running && !contextLost) { running = true; clock.getDelta(); animate(); }
});

// WebGL 컨텍스트 손실/복구
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; running = false; });
canvas.addEventListener('webglcontextrestored', () => { contextLost = false; running = true; clock.getDelta(); animate(); });

requestAnimationFrame(() => document.body.classList.add('ready'));
