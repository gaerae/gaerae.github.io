import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { chooseBody, FIXED_WORLD } from 'app/bodies.js';
import { createCraft, SampledPass } from 'app/craft.js';
import { initPlanetPicker } from 'app/picker.js';
import { createZoom } from 'app/zoom.js';

/* ------------------------------------------------------------------ *
 *  gaerae.com — 우주 항해 랜딩 (Three.js / WebGL)
 *  사실적 딥스페이스 · 성간 먼지 · 실제 천체 · 워프 스타필드
 * ------------------------------------------------------------------ */

const canvas = document.getElementById('space');
const rootEl = document.documentElement;
const heroEl = document.querySelector('.hero');
let renderer;
try {
  // 그림은 전부 컴포저의 오프스크린 타깃에 그려져 캔버스 MSAA는 효과가 없다 — 구 가장자리는 셰이더(EDGE_AA)가 처리
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
} catch (e) {
  document.body.classList.add('no-webgl', 'ready'); // 로더 해제 + 폴백 배경
  throw e;
}

const isMobile = window.matchMedia('(max-width: 760px)').matches;
let pixelRatio = Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2); // 모바일 품질 스케일
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x01020a, 1);
// 시네마틱 톤매핑 노출 — 하이라이트를 부드럽게 롤오프해 실사감↑·과노출 방지(지구 등)
// - 톤매핑은 마지막 그레이딩 패스가 직접 수행(장면은 전부 오프스크린 타깃에 그려짐)
const EXPOSURE = 1.12;

const scene = new THREE.Scene();
const FOV = 68;
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const halfHeightAt = (z) => TAN_HALF_FOV * Math.abs(z);   // 깊이 z 평면에서 화면 절반 높이
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 8000);
// 행성 전용 망원 카메라: 광각으로 화면 가장자리에 둔 구는 방사 방향으로 1/cosθ 늘어나 타원이 된다.
// LENS_K 배 물러나고 그만큼 화각을 좁혀 화면 위치·크기는 그대로 두고 진짜 원으로 그린다.
const LENS_K = 3;
const planetScene = new THREE.Scene();
const planetCam = new THREE.PerspectiveCamera(
  2 * THREE.MathUtils.radToDeg(Math.atan(TAN_HALF_FOV / LENS_K)),
  camera.aspect, 10, 20000
);
const clock = new THREE.Clock();
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches; // 모션 최소화 선호
let running = true;          // 탭 숨김 / 컨텍스트 손실 시 렌더 정지
let contextLost = false;
const REDUCE_RENDER_SECONDS = 2.4; // reduce 모드: 텍스처 로드까지만 렌더 후 정지(초)
const MIN_FRAME_MS = 10;     // 120Hz 화면도 60fps로 — 느린 배경에 GPU를 두 배 쓰지 않는다

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
  // 달 위상을 반영하되, 히어로 행성이 늘 보기 좋게 차오른(gibbous~전광) 범위로 제한 — 역광으로 어두워지지 않게
  const theta = (0.40 - 0.16 * illum) * Math.PI;  // 정면(z) 성분 하한을 올려 늘 충분히 보이게(측광 과다 방지) — 밝은 명암은 유지
  const sunDir = new THREE.Vector3(Math.sin(theta) * -0.72, Math.sin(theta) * 0.34 + 0.12, Math.cos(theta)).normalize();
  return { night, illum, sunDir };
}
const SKY = computeSky();

/* ============================================================
 *  1. 성간 배경 (딥스페이스 먼지 + 사실적 별 · 현지 시간 반영)
 * ============================================================ */
// 오로라·먼지는 fbm 수십 회라 전체 화면 매 프레임 계산이 가장 비싸지만 변화는 아주 느리다.
// 등장방형 텍스처에 구워 두고 프레임마다 한 띠씩만 갱신한다. 별만 화면 픽셀마다 계산한다.
const NEBULA_W = isMobile ? 1024 : 2048, NEBULA_H = NEBULA_W / 2;
const NEBULA_BANDS = 32;
const nebulaTarget = new THREE.WebGLRenderTarget(NEBULA_W, NEBULA_H, {
  type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping, scissorTest: true,
});
const nebulaBakeUniforms = { uTime: { value: 0 } };
const skyUniforms = { uTime: { value: 0 }, uNight: { value: SKY.night }, uNebula: { value: nebulaTarget.texture } };

const NOISE_GLSL = /* glsl */`
  float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }`;
const BAND_GLSL = /* glsl */`
  // 은하수 띠 (살짝 기울인 평면)
  float milkyBand(vec3 dir){ return exp(-pow(dot(dir, normalize(vec3(0.35, 1.0, 0.15)))*3.4, 2.0)); }`;

const nebulaBake = new FullScreenQuad(new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: nebulaBakeUniforms,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    ${NOISE_GLSL}
    ${BAND_GLSL}
    float noise(vec3 x){
      vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                     mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                     mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<6;i++){v+=a*noise(p);p*=2.03;a*=0.5;} return v; }

    void main(){
      // 등장방형 → 방향. 경도 이음매는 카메라 뒤쪽(+z)에 둔다
      float lon = (vUv.x - 0.5) * 6.2831853, lat = (vUv.y - 0.5) * 3.1415927;
      vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
      float t = uTime * 0.02;   // 느리게 흐름
      float band = milkyBand(dir);

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
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}));

function bakeNebula(y = 0, height = NEBULA_H) {
  nebulaTarget.scissor.set(0, y, NEBULA_W, height);
  renderer.setRenderTarget(nebulaTarget);
  nebulaBake.render(renderer);
  renderer.setRenderTarget(null);
}
bakeNebula();

let nebulaBand = 0;
function bakeNextNebulaBand() {
  const height = NEBULA_H / NEBULA_BANDS;
  bakeNebula(nebulaBand * height, height);
  nebulaBand = (nebulaBand + 1) % NEBULA_BANDS;
}

const nebula = new THREE.Mesh(
  new THREE.SphereGeometry(6000, 64, 64),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
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
      uniform sampler2D uNebula;
      ${NOISE_GLSL}
      ${BAND_GLSL}

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
        vec2 uv = vec2(atan(dir.x, -dir.z) / 6.2831853 + 0.5, asin(dir.y) / 3.1415927 + 0.5);
        vec3 col = texture2D(uNebula, uv).rgb;

        // 별 (여러 층으로 깊이감) — 밤일수록 더 또렷
        float sb = 0.6 + 0.7 * uNight;
        col += starLayer(dir, 130.0, 0.986) * 1.2 * sb;
        col += starLayer(dir, 260.0, 0.992) * 0.9 * sb;
        col += starLayer(dir, 520.0, 0.996) * 0.6 * sb;
        col += starLayer(dir, 90.0,  0.978) * (0.5 + milkyBand(dir)*0.8) * sb; // 은하수 밀집 별

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
const STAR_TAIL = REDUCE ? 1.0 : 0.08;   // 꼬리 끝 밝기
const positions = new Float32Array(STAR_COUNT * 2 * 3);
const colors = new Float32Array(STAR_COUNT * 2 * 3);
const starZ = new Float32Array(STAR_COUNT);
const starSpeed = new Float32Array(STAR_COUNT);
let starColorsDirty = false;

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
  const c = palette[(Math.random() * palette.length) | 0];
  const b = 0.45 + Math.random() * 0.55;
  const o = i * 6;
  positions[o] = positions[o + 3] = x;
  positions[o + 1] = positions[o + 4] = y;
  for (let k = 0; k < 3; k++) {
    colors[o + k] = c[k] * b;
    colors[o + 3 + k] = c[k] * b * STAR_TAIL;
  }
  starZ[i] = atFar ? -DEPTH * Math.random() : -DEPTH;
  starSpeed[i] = 34 + Math.random() * 74;   // 느린 드리프트
  starColorsDirty = true;
}
for (let i = 0; i < STAR_COUNT; i++) spawnStar(i, true);

const starGeo = new THREE.BufferGeometry();
const starPosAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
const starColAttr = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
starGeo.setAttribute('position', starPosAttr);
starGeo.setAttribute('color', starColAttr);
const stars = new THREE.LineSegments(
  starGeo,
  new THREE.LineBasicMaterial({
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
);
stars.frustumCulled = false;   // 카메라를 감싸며 계속 움직인다
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
comets.frustumCulled = false;  // 대기 중엔 정점이 전부 0 — 경계 구로 판정하면 영영 시야 밖 처리된다
comets.visible = !REDUCE;
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
  cometPos.fill(0, i * 6, i * 6 + 6);
  cometCol.fill(0, i * 6, i * 6 + 6);
}
for (let i = 0; i < NCOMET; i++) resetComet(i, true);

/* ============================================================
 *  3. 천체 — 실제 텍스처를 구에 입힘(접속마다 랜덤)
 * ============================================================ */
const rnd = (a, b) => a + Math.random() * (b - a);

const TEX = 'assets/textures/';
const ASSET_VER = '1bcacc2d07';        // 텍스처·3D 모델 캐시 버스팅 — scripts/version.mjs 가 갱신
const body = chooseBody();

const sizeVar = rnd(0.85, 1.12) * (body.hero ?? 1); // 개체마다 크기도 조금씩 다르게

const R = 420;
const oblY = 1 - (body.obl || 0);     // 편평도: 자전축(Y) 방향으로 눌러 적도가 부풀게
const tiltLimit = body.ring ? 1.05 : 0.7; // 기울임 한계 — 고리 행성은 더 눕혀 고리가 열려 보이게
const planetGroup = new THREE.Group();
// 자전축 기울기 / 고리 자세
let restX, rotZ;
if (body.sideways) {                  // 천왕성: 거의 옆으로 누운 자전축 → 고리가 세로로 선다
  restX = -0.12; rotZ = 1.42;
} else if (body.ring && body.ring.tex) { // 토성: 실측 고리가 활짝 열려 보이는 자세
  restX = -0.85; rotZ = 0.30;
} else {                              // 그 외: 은은한 자전축(희미한 고리는 적도면에 가늘게)
  restX = 0; rotZ = body.tilt ?? 0.24 + Math.random() * 0.28;
}
planetGroup.rotation.z = rotZ;
planetGroup.rotation.x = restX;
const focus = { on: rootEl.classList.contains('focus'), ease: 0 };
if (focus.on) focus.ease = 1;
const layoutTo = { x: 0, y: 0, z: 0, scale: 1 };
let layoutNow = null;
// 집중 모드 구도: 행성을 작게, 황금비 위치에 — 왼쪽에서 오는 빛이 빈 우주 쪽을 향한다. 세로 화면은 아래쪽 중앙
const FOCUS_DIAMETER = 0.38;          // 화면 높이 대비 행성 지름(텍스처가 1배 안팎으로 유지되는 크기)
const FOCUS_SUN = new THREE.Vector3(-0.80, 0.34, 0.40).normalize(); // 비스듬한 측광 — 명암 경계가 둥글게 휘고 고리 그림자가 살아난다
const FOCUS_DRIFT_SECONDS = 40;       // 천천히 다가가는 카메라
function focusLayout(z) {
  const halfH = halfHeightAt(z), halfW = halfH * camera.aspect, portrait = camera.aspect < 1;
  const span = body.ring?.tex ? body.ring.outer : 1;           // 고리까지 합친 반지름
  const fill = body.craft ? (portrait ? 0.9 : 0.46) / body.size
    : portrait ? Math.min(0.62, 0.92 / span) : Math.min(FOCUS_DIAMETER, 0.72 / span);
  return { x: portrait ? 0 : 0.236 * halfW, y: (portrait ? -0.10 : -0.04) * halfH, scale: fill * (portrait ? halfW : halfH) / R };
}
// 기본 구도: 데스크톱은 크게 잘려 웅장하게, 모바일은 우측에서 살짝 걸치게
function heroLayout() {
  const w = window.innerWidth;
  if (w < 760) {
    // 모바일: 화면 비율 기준으로 본문 아래 우측에 — 세로 화면에서도 밀려나지 않게
    const z = -1440, halfH = halfHeightAt(z), halfW = halfH * camera.aspect;
    return { x: (body.craft ? 0.2 : 0.62) * halfW, y: -0.60 * halfH, z, scale: body.craft ? 0.8 * halfW / (R * body.size) : 0.64 * sizeVar };
  }
  // 중간 폭(노트북·태블릿 가로): 안쪽으로 당기고 살짝 축소 — 화면 밖으로 잘려나가 사라지지 않게
  if (w < 1180) return { x: 560, y: 225, z: -1500, scale: 0.72 * sizeVar };
  return { x: 880, y: 255, z: -1430, scale: sizeVar };
}
function layoutPlanet() {
  const hero = heroLayout();
  Object.assign(layoutTo, hero, focus.on ? focusLayout(hero.z) : null);
  if (REDUCE || !layoutNow) layoutNow = { ...layoutTo };       // 움직임을 줄인 환경은 미끄러지지 않고 바로 옮긴다
  planetGroup.position.set(layoutNow.x, layoutNow.y, layoutTo.z);
  planetGroup.scale.setScalar(layoutNow.scale);
  planetCam.position.z = -layoutTo.z * (LENS_K - 1);
  aimQuoteInk(hero);
}

// 문구 잉크 그라데이션 방향 = 문구 중심 → 천체 중심(화면 좌표)
// - 기본 구도 기준: 집중 모드에선 문구가 걷혀 있음
// - 배치가 바뀔 때만 호출(리사이즈·모드 전환) → 레이아웃 읽기는 프레임마다 일어나지 않음
const quoteEl = document.querySelector('#headline .quote-text');
const planetOnScreen = new THREE.Vector3();
function aimQuoteInk({ x, y, z }) {
  planetCam.updateMatrixWorld();
  planetOnScreen.set(x, y, z).project(planetCam);
  const box = quoteEl.getBoundingClientRect();
  const dx = (planetOnScreen.x + 1) / 2 * window.innerWidth - (box.left + box.width / 2);
  const dy = (1 - planetOnScreen.y) / 2 * window.innerHeight - (box.top + box.height / 2);
  rootEl.style.setProperty('--ink-angle', `${THREE.MathUtils.radToDeg(Math.atan2(dx, -dy)).toFixed(0)}deg`); // CSS 각도: 0deg 위, 90deg 오른쪽
}
layoutPlanet();
planetScene.add(planetGroup);

const sunDir = SKY.sunDir.clone();
const sunAim = new THREE.Vector3(); // 커서 반응용 태양 방향(프레임마다 재계산)
const sunBase = new THREE.Vector3();

const texLoader = new THREE.TextureLoader();
const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
// 정지 상태(reduce·렌더 멈춤)에서 늦게 도착한 텍스처도 화면에 반영
const renderIfPaused = () => { if (!running && !contextLost && !document.hidden) composer.render(); };
function loadTex(file, { srgb = true, onLoad } = {}) {
  const t = texLoader.load(`${TEX}${file}?v=${ASSET_VER}`, () => { onLoad?.(); renderIfPaused(); });
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

// 문구가 천체의 빛을 조금 받는다: 표면 평균색의 색상·채도를 잉크에 옮긴다
function tintQuote(image) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 32, height: 16 });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 32, 16);
  const px = ctx.getImageData(0, 0, 32, 16).data, sum = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += px[i + c];
  const count = px.length / 4 * 255;
  const tone = rgb => new THREE.Color().setRGB(...rgb, THREE.SRGBColorSpace).getHSL({}, THREE.SRGBColorSpace);
  let { h, s } = tone(sum.map(v => v / count));
  const air = body.haze || body.atmo?.col;           // 회색 지도(타이탄·명왕성·유로파)는 눈에 보이는 대기색을 쓴다
  if (s < 0.08 && air) ({ h, s } = tone(air));
  rootEl.style.setProperty('--tint-h', (h * 360).toFixed(0));
  rootEl.style.setProperty('--tint-s', `${(Math.min(s, 0.6) * 100).toFixed(0)}%`);
}

// 페이드인: 표면 텍스처 로드 후 등록된 불투명도 유니폼을 함께 1까지 올린다
const fades = [];
let planetFadeIn = false;
function fadeUniform(rate = 1.5) {
  const u = { value: REDUCE ? 1 : 0 };
  fades.push({ u, rate });
  return u;
}

// 천체마다 다른 층(태양 원반·구름·대기·위성·우주선)이 매 프레임 할 일을 등록한다
const frameLayers = [];
const onFrame = (update) => frameLayers.push(update);

// 표면·구름·위성 공용 정점 셰이더(월드 법선·시선 방향 전달)
const SURFACE_VERT = /* glsl */`
  varying vec2 vT; varying vec3 vWN; varying vec3 vVD; varying vec3 vWP;
  void main(){
    vT = uv;
    mat3 m = mat3(modelMatrix);       // 회전+축별 배율 — 편평도가 있어도 법선이 표면에 수직이 되게 보정
    vWN = normalize(m * (normal / vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]))));
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz;
    vVD = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// 화면 공간 판 공용 정점 셰이더
const UV_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// 구 실루엣 안티앨리어싱: 시선과 법선의 내적이 0으로 떨어지는 마지막 1픽셀을 투명하게 푼다
const EDGE_AA = /* glsl */`
  float edgeAA(float vd){ return clamp(vd / max(fwidth(vd), 1e-4), 0.0, 1.0); }`;

// 행성 그림자: 태양 반대편 원통 안이면 어두워진다(고리·위성 공용). vWP = 월드 위치
const PLANET_SHADOW = /* glsl */`
  float planetShadow(vec3 sun){
    vec3 sd = normalize(sun); vec3 dc = vWP - uCenter;
    float along = dot(dc, sd); float perp = length(dc - along * sd);
    return along < 0.0 ? smoothstep(uRworld * 0.92, uRworld * 1.20, perp) : 1.0;
  }`;

// ── 표면: 실제 천체 텍스처(알베도)를 시네마틱 명암으로 조명 ──
const planetTex = body.craft ? new THREE.Texture() : loadTex(body.tex, { onLoad: () => { planetFadeIn = !REDUCE; tintQuote(planetTex.image); } });
// 지구 전용 보조 맵: 야간 도시광(발광) · 해양 반사 마스크 — 없는 천체는 더미(planetTex)+플래그 0으로 무시
const hasNight = !!body.night, hasSpec = !!body.spec;
const nightTex = hasNight ? loadTex(body.night) : planetTex;
const specTex = hasSpec ? loadTex(body.spec, { srgb: false }) : planetTex; // 선형 마스크(해양=밝음)
const ringTex = body.ring?.tex ? loadTex(body.ring.tex) : null;
const moonSpheres = (body.moons || []).map(() => new THREE.Vector4()); // 위성 월드 위치·반지름(행성에 그림자를 드리운다)
const planetBody = { uCenter: { value: new THREE.Vector3() }, uRworld: { value: R } }; // 프레임마다 갱신
const planetUniforms = {
  ...planetBody,
  uRingMap: { value: ringTex }, uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
  uRingIn: { value: body.ring?.inner || 0 }, uRingOut: { value: body.ring?.outer || 1 },
  uMoonSpheres: { value: moonSpheres },
  uSun: { value: sunDir.clone() },
  uGlint: { value: 0.34 },                                      // 바다 반사 세기
  uOpacity: fadeUniform(1.8),
  uMap: { value: planetTex },
  uNightMap: { value: nightTex }, uSpecMap: { value: specTex },
  uHasNight: { value: hasNight ? 1 : 0 }, uHasSpec: { value: hasSpec ? 1 : 0 },
  uLum: { value: body.lum || 1.0 },                            // 저반사 천체 노출 보정(기본 1.0)
  uNight: { value: body.atmo ? 0.09 : 0.045 },                 // 밤면 환경광(어둠 속에서도 형태가 보이게)
  uRim: { value: new THREE.Color(...(body.atmo ? body.atmo.col : [.5,.55,.7])) },
  uAtmoPow: { value: body.atmo ? 0.5 : 0.0 },                   // 가장자리 대기 산란 세기
  uHaze: { value: new THREE.Color(...(body.haze || [0, 0, 0])) }, // 전역 대기 스모그(타이탄)
  uHazeAmt: { value: body.haze ? 0.72 : 0.0 },
};
const planet = new THREE.Mesh(
  body.disc || body.craft ? new THREE.BufferGeometry() : new THREE.SphereGeometry(R, 160, 160), // 태양·우주선은 구를 그리지 않는다
  new THREE.ShaderMaterial({
    transparent: true,
    defines: { MOON_COUNT: moonSpheres.length, ...(ringTex && { RING_SHADOW: 1 }) },
    uniforms: planetUniforms,
    vertexShader: SURFACE_VERT,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vT; varying vec3 vWN; varying vec3 vVD; varying vec3 vWP;
      uniform sampler2D uMap, uNightMap, uSpecMap; uniform vec3 uSun, uRim, uHaze;
      uniform float uOpacity, uNight, uAtmoPow, uHazeAmt, uHasNight, uHasSpec, uLum, uGlint;
      ${EDGE_AA}
      #if MOON_COUNT > 0
      uniform vec4 uMoonSpheres[MOON_COUNT];
      float moonShadow(vec3 sd){                                 // 표면에서 태양 쪽으로 위성이 가리면 어둡다
        float s = 1.0;
        for (int i = 0; i < MOON_COUNT; i++) {
          vec3 v = uMoonSpheres[i].xyz - vWP; float r = uMoonSpheres[i].w;
          float along = dot(v, sd);
          float soft = r * 0.12 + along * 0.006;                 // 먼 위성일수록 그림자 가장자리가 번진다
          if (along > 0.0) s *= mix(0.08, 1.0, smoothstep(r - soft, r + soft, length(v - sd * along)));
        }
        return s;
      }
      #endif
      #ifdef RING_SHADOW
      uniform sampler2D uRingMap; uniform vec3 uCenter, uRingNormal; uniform float uRworld, uRingIn, uRingOut;
      float ringShadow(vec3 sd){                                 // 태양 쪽 광선이 고리면을 지나는 곳의 불투명도
        vec3 dc = vWP - uCenter;
        float t = -dot(dc, uRingNormal) / dot(sd, uRingNormal);
        if (t <= 0.0) return 1.0;
        float u = (length(dc + sd * t) / uRworld - uRingIn) / (uRingOut - uRingIn);
        if (u < 0.0 || u > 1.0) return 1.0;
        return 1.0 - texture2D(uRingMap, vec2(u, 0.5)).a * 0.72;
      }
      #endif
      void main(){
        vec3 alb = texture2D(uMap, vT).rgb;
        // 전역 대기 스모그(타이탄): 음영을 들어올려 대비를 낮추고 오렌지로 물들임 — 표면은 은은히 비침
        alb = mix(alb, (0.42 + 0.58 * alb) * uHaze, uHazeAmt);
        vec3 N = normalize(vWN);
        float ndl = dot(N, normalize(uSun));
        float day = smoothstep(-0.12, 0.30, ndl);                // 부드러운 명암 경계
        #if MOON_COUNT > 0
        day *= moonShadow(normalize(uSun));
        #endif
        #ifdef RING_SHADOW
        day *= ringShadow(normalize(uSun));
        #endif
        float vd = clamp(dot(N, normalize(vVD)), 0.0, 1.0);
        float limb = 0.74 + 0.26 * pow(vd, 0.5);                 // 가장자리 감광
        vec3 lit = alb * (0.06 + day * 0.98) * limb;             // 과노출 억제 → 표면 색·띠 보존
        lit += alb * (1.0 - day) * uNight;                       // 밤면 미세 환경광
        // 지구: 밤면 도시 불빛(발광) — 밤쪽에서만, 터미네이터에서 자연 감쇠
        if (uHasNight > 0.5) {
          vec3 city = texture2D(uNightMap, vT).rgb;
          float night = smoothstep(0.08, -0.14, ndl);
          lit += city * night * vec3(1.15, 0.92, 0.58) * 1.15;
        }
        // 지구: 해양 반사 하이라이트(해양 마스크·낮면) — 태양 반짝임
        if (uHasSpec > 0.5) {
          float ocean = texture2D(uSpecMap, vT).r;
          vec3 Hh = normalize(normalize(uSun) + normalize(vVD));
          float sp = pow(max(dot(N, Hh), 0.0), 180.0);
          lit += vec3(1.0, 0.97, 0.90) * sp * ocean * day * uGlint;
        }
        float fres = pow(1.0 - vd, 3.0);
        lit += uRim * fres * day * uAtmoPow;                     // 햇빛 받는 가장자리 대기 산란
        lit += uHaze * fres * day * uHazeAmt * 0.6;              // 스모그 가장자리 글로우
        lit *= uLum;                                             // 저반사 천체 노출 보정
        gl_FragColor = vec4(lit, uOpacity * edgeAA(vd));
      }`,
  })
);
planet.scale.set(1, oblY, 1);        // 편평도(가스/얼음행성은 적도가 부풀어 보임)
planet.rotation.y = body.face || 0;  // 대표 지형을 향한 시작 경도
planetGroup.add(planet);

// ── 태양: SDO 사진은 한쪽 면뿐이라 카메라를 향한 판에 그린다. 코로나는 더해지고 원반은 뒤의 별을 가린다 ──
if (body.disc) {
  const DISC_TURN_MAX = 0.42;                                   // 사진에 없는 뒷면이 드러나기 전에 멈추는 각도(rad)
  const discTurn = { value: new THREE.Vector2() };              // 드래그를 받아 사진을 구면 위에서 돌린다
  planet.visible = false;
  const sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(R / body.disc, R / body.disc), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uMap: { value: planetTex }, uDisc: { value: body.disc }, uOpacity: planetUniforms.uOpacity, uTurn: discTurn },
    vertexShader: UV_VERT,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv; uniform sampler2D uMap; uniform float uDisc, uOpacity; uniform vec2 uTurn;
      void main(){
        vec2 p = (vUv - 0.5) / uDisc;
        float r = length(p);
        vec2 at = vUv;
        if (r < 1.0) {
          vec3 n = vec3(p, sqrt(1.0 - r * r));
          float cy = cos(uTurn.x), sy = sin(uTurn.x), cx = cos(uTurn.y), sx = sin(uTurn.y);
          n = vec3(n.x * cy - n.z * sy, n.y, n.x * sy + n.z * cy);
          n = vec3(n.x, n.y * cx + n.z * sx, n.z * cx - n.y * sx);
          at = n.xy * uDisc + 0.5;
        }
        vec3 c = max(texture2D(uMap, at).rgb - 0.006, 0.0) * 1.15;
        float inside = 1.0 - smoothstep(0.985, 1.0, r);
        float outside = 1.0 - smoothstep(1.06, 1.15, r);
        gl_FragColor = vec4(c * mix(outside, 1.0, inside) * uOpacity, inside * uOpacity);
      }`,
  }));
  planetGroup.add(sunDisc);
  onFrame(() => {
    sunDisc.quaternion.copy(planetGroup.quaternion).invert();
    discTurn.value.set(Math.tanh(planetGroup.rotation.y / DISC_TURN_MAX), Math.tanh(planetGroup.rotation.x / DISC_TURN_MAX)).multiplyScalar(DISC_TURN_MAX);
  });
}

// ── 구름층(지구): 지표보다 약간 빠르게 도는 반투명 구름 — 낮면만 밝게, 밤면은 어둑 ──
if (body.clouds) {
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.015, 128, 128),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uMap: { value: loadTex(body.clouds) }, uSun: planetUniforms.uSun, uOpacity: fadeUniform() },
      vertexShader: SURFACE_VERT,
      fragmentShader: /* glsl */`
        precision highp float; varying vec2 vT; varying vec3 vWN; varying vec3 vVD;
        uniform sampler2D uMap; uniform vec3 uSun; uniform float uOpacity;
        ${EDGE_AA}
        void main(){
          vec3 c = texture2D(uMap, vT).rgb;
          float a = max(c.r, max(c.g, c.b));                 // 흰 구름 밀도
          float ndl = dot(normalize(vWN), normalize(uSun));
          float day = smoothstep(-0.12, 0.30, ndl);
          float vd = clamp(dot(normalize(vWN), normalize(vVD)), 0.0, 1.0);
          float limb = 0.72 + 0.28 * pow(vd, 0.5);
          vec3 lit = vec3(1.0) * (0.05 + day * 1.0) * limb;  // 낮면 밝은 흰구름, 밤면 어둑
          gl_FragColor = vec4(lit, a * uOpacity * (0.20 + day * 0.80) * edgeAA(vd));
        }`,
    })
  );
  clouds.scale.set(1, oblY, 1);
  clouds.renderOrder = 1;              // 표면 위, 대기 림 아래
  planetGroup.add(clouds);
  onFrame((dt) => { clouds.rotation.y += dt * body.spin * 1.25; }); // 구름이 지표보다 약간 빠르게 흘러감
}

// 실측 고리 데이터를 반지름 방향 1D 텍스처로 굽는다 — R: 고리 밀도, G: 해왕성 아크. 밉맵이 가는 고리의 깜빡임을 없앤다
function bakeRingProfile({ inner, outer, bands, arcs }) {
  const N = 2048, texel = (outer - inner) / N, data = new Uint8Array(N * 4);
  const paint = (channel, [r0, r1, brightness, soft = 0]) => {
    const edge = Math.max(soft, texel);
    for (let i = 0; i < N; i++) {
      const r = inner + (i + 0.5) * texel;
      const cover = THREE.MathUtils.clamp((r - r0) / edge + 0.5, 0, 1) * THREE.MathUtils.clamp((r1 - r) / edge + 0.5, 0, 1);
      data[i * 4 + channel] = Math.max(data[i * 4 + channel], Math.round(255 * brightness * cover));
    }
  };
  bands.forEach(band => paint(0, band));
  if (arcs) paint(1, arcs.band);
  const tex = new THREE.DataTexture(data, N, 1);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

// ── 고리: 토성=실측 텍스처, 그 외 거대행성=실측 반지름으로 구운 희미한 고리 ──
if (body.ring) {
  const inner = R * body.ring.inner, outer = R * body.ring.outer;
  const rg = new THREE.RingGeometry(inner, outer, 240, 1);
  const rp = rg.attributes.position, ruv = rg.attributes.uv, tmp = new THREE.Vector3();
  for (let i = 0; i < rp.count; i++) {
    tmp.fromBufferAttribute(rp, i);
    ruv.setXY(i, (tmp.length() - inner) / (outer - inner), 0.5); // u = 반지름 위치
  }
  // 행성 그림자: 고리가 행성 뒤(태양 반대편 원통) 구간에서 어두워지는 실사 디테일 — 두 재질 공유
  const ringShadow = { uSun: planetUniforms.uSun, ...planetBody };
  const RING_VERT = /* glsl */`
    varying vec2 vUv; varying vec2 vDir; varying vec3 vWP;
    void main(){
      vUv = uv; vDir = position.xy;
      vWP = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  let ringMat;
  if (body.ring.tex) {
    // 토성: 실측 고리 텍스처(반지름 방향 밴드 + 카시니 간극 + 알파) + 행성 그림자
    ringMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false,
      uniforms: { uOpacity: fadeUniform(), uMap: { value: ringTex }, ...ringShadow },
      vertexShader: RING_VERT,
      fragmentShader: /* glsl */`
        precision highp float; varying vec2 vUv; varying vec3 vWP;
        uniform sampler2D uMap; uniform float uOpacity; uniform vec3 uSun, uCenter; uniform float uRworld;
        ${PLANET_SHADOW}
        void main(){
          vec4 t = texture2D(uMap, vec2(vUv.x, 0.5));
          float shadow = planetShadow(uSun);
          gl_FragColor = vec4(t.rgb * mix(0.18, 1.0, shadow), t.a * uOpacity * mix(0.5, 1.0, shadow));
        }`,
    });
  } else {
    // 목성·천왕성·해왕성: 실측 반지름 프로파일 + 행성 그림자
    const arcs = body.ring.arcs?.at;
    ringMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false,
      defines: { ARC_COUNT: arcs?.length || 0 },
      uniforms: {
        uOpacity: fadeUniform(), uTime: skyUniforms.uTime,
        uProfile: { value: bakeRingProfile(body.ring) },
        uCol: { value: new THREE.Color(...body.ring.col) }, uOp: { value: body.ring.op },
        uArcs: { value: (arcs || []).map(([at, span]) => new THREE.Vector2(at, span / 2).multiplyScalar(Math.PI / 180)) },
        ...ringShadow,
      },
      vertexShader: RING_VERT,
      fragmentShader: /* glsl */`
        precision highp float; varying vec2 vUv; varying vec2 vDir; varying vec3 vWP;
        uniform sampler2D uProfile; uniform float uOpacity, uOp, uTime; uniform vec3 uCol, uSun, uCenter; uniform float uRworld;
        ${PLANET_SHADOW}
        #if ARC_COUNT > 0
        uniform vec2 uArcs[ARC_COUNT];                                       // 아크 중심 경도·반폭(rad)
        float arcMask(float lon){
          float m = 0.0;
          for (int i = 0; i < ARC_COUNT; i++) {
            float d = abs(mod(lon - uArcs[i].x + 3.14159265, 6.2831853) - 3.14159265);
            m = max(m, smoothstep(uArcs[i].y, uArcs[i].y * 0.6, d));
          }
          return m;
        }
        #endif
        void main(){
          vec4 profile = texture2D(uProfile, vec2(vUv.x, 0.5));
          float dens = profile.r;
          #if ARC_COUNT > 0
          dens = max(dens, profile.g * arcMask(atan(vDir.y, vDir.x) - uTime * 0.06));
          #endif
          float shadow = planetShadow(uSun);
          gl_FragColor = vec4(uCol * mix(0.25, 1.0, shadow), dens * uOp * uOpacity * mix(0.45, 1.0, shadow));
        }`,
    });
  }
  const ring = new THREE.Mesh(rg, ringMat);
  ring.rotation.x = Math.PI * 0.5;
  ring.renderOrder = 1;
  planetGroup.add(ring);
}

let craft = null;
if (body.craft) {
  planet.visible = false;
  craft = createCraft({
    body, renderer, scene: planetScene, parent: planetGroup, radius: R * body.size, envSun: FOCUS_SUN,
    url: `assets/craft/${body.craft}?v=${ASSET_VER}`, reduced: REDUCE, fade: fadeUniform(0.8),
    onReady() { planetFadeIn = !REDUCE; renderIfPaused(); },
  });
  onFrame((dt, et) => craft.update(et));
}

// 대기 림 — 행성 가장자리에서 가장 밝고 껍질 끝으로 갈수록 사라진다. 대기가 없는 천체는 atmo: null
const ATMO_SCALE = 1.08;              // 대기 껍질 반지름(행성 반지름 대비)
if (body.atmo) {
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * ATMO_SCALE, 96, 96),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: {
        uLight: planetUniforms.uSun,
        uColor: { value: new THREE.Color(...body.atmo.col) },
        uStrength: { value: body.atmo.s },
        uInner: { value: 1 / ATMO_SCALE },   // 껍질 안에서 행성 가장자리의 위치(0..1)
        uOpacity: fadeUniform(),
      },
      vertexShader: /* glsl */`
        varying vec3 vN, vView;
        void main(){ vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv; }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vN, vView; uniform vec3 uLight; uniform vec3 uColor; uniform float uStrength, uInner, uOpacity;
        void main(){
          vec3 n = normalize(vN);
          float nv = dot(n, normalize(vView));
          float s = sqrt(max(1.0 - nv * nv, 0.0));             // 시선이 구 중심에서 비껴난 거리(0 중심 … 1 껍질 끝)
          float g = (1.0 - s) / (1.0 - uInner);                // 1 행성 가장자리 … 0 껍질 끝
          float rim = g > 1.0 ? 0.0 : pow(g, 2.2);             // 행성 안쪽은 비운다(페이드인 중 비치지 않게)
          float ndl = dot(n, normalize(uLight));
          float lit = clamp(ndl + 0.15, 0.0, 1.0);
          // 전방산란 초승달 — 햇빛 받는 가장자리가 타오르듯 밝아지는 역광 글로우(시네마틱 핵심 큐)
          float crescent = pow(clamp(ndl * 0.5 + 0.5, 0.0, 1.0), 2.6) * rim;
          vec3 c = uColor * rim * (0.12 + lit * 0.82) * uStrength;
          c += uColor * crescent * 0.95 * uStrength;           // 밝은 초승달 띠
          c += vec3(0.20, 0.34, 0.62) * rim * 0.12;
          float a = rim * (0.28 + lit * 0.5) * 0.66 * uStrength + crescent * 0.42 * uStrength + rim * 0.09;
          gl_FragColor = vec4(c, a * uOpacity);
        }
      `,
    })
  );
  planetGroup.add(atmo);
  atmo.renderOrder = -1;               // 행성보다 먼저 — 가장자리 안티앨리어싱 픽셀이 대기와 섞이게
  onFrame((dt, et) => {                // 숨쉬는 대기(편평도 유지)
    const sc = 1.0 + Math.sin(et * 0.5) * 0.014;
    atmo.scale.set(sc, sc * oblY, sc);
    atmo.material.uniforms.uInner.value = 1 / (ATMO_SCALE * sc);
  });
}

// ── 위성: 그 천체의 실제 위성만, 적도면 궤도를 돈다 ──
const moons = (body.moons || []).map(({ tex, r, orbit, speed, incl = 0, tint }) => {
  const radius = R * r;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, r > 0.1 ? 64 : 32, r > 0.1 ? 64 : 32),
    new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uSun: planetUniforms.uSun,                 // 행성과 같은(커서 반응) 태양 방향 공유
        ...planetBody,
        uMap: { value: loadTex(tex) }, uOpacity: fadeUniform(),
        uTint: { value: new THREE.Color(...(tint || [0, 0, 0])) }, uTintAmt: { value: tint ? 0.8 : 0 },
      },
      vertexShader: SURFACE_VERT,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vT; varying vec3 vWN; varying vec3 vVD; varying vec3 vWP;
        uniform sampler2D uMap; uniform vec3 uSun, uCenter, uTint; uniform float uOpacity, uRworld, uTintAmt;
        ${EDGE_AA}
        ${PLANET_SHADOW}
        void main(){
          vec3 alb = mix(texture2D(uMap, vT).rgb, uTint, uTintAmt);
          vec3 N = normalize(vWN); float ndl = dot(N, normalize(uSun));
          float day = smoothstep(-0.08, 0.28, ndl) * planetShadow(uSun);  // 행성 그림자에 들면 식(蝕)
          float vd = clamp(dot(N, normalize(vVD)), 0.0, 1.0);
          float limb = 0.72 + 0.28 * pow(vd, 0.5);
          vec3 lit = alb * (0.04 + day * 1.05) * limb;
          gl_FragColor = vec4(lit, uOpacity * edgeAA(vd));
        }`,
    })
  );
  planetGroup.add(mesh);
  return { mesh, radius, orad: R * orbit, ang: Math.random() * Math.PI * 2, speed, incl };
});

function placeMoon(m) {
  const x = Math.cos(m.ang) * m.orad, z = Math.sin(m.ang) * m.orad;
  m.mesh.position.set(x, z * Math.sin(m.incl), z * Math.cos(m.incl));
  m.mesh.rotation.y = Math.PI - m.ang;                 // 조석 고정 — 같은 면이 늘 행성을 향한다
}
moons.forEach(placeMoon);
if (moons.length) onFrame((dt) => {
  for (const m of moons) {
    m.ang += dt * m.speed;
    placeMoon(m);
  }
});

/* ============================================================
 *  4. 후처리 (은은한 Bloom)
 * ============================================================ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// 배경·별 위에 행성을 덧그림
composer.addPass(body.craft ? new SampledPass(planetScene, planetCam) : Object.assign(new RenderPass(planetScene, planetCam), { clear: false, clearDepth: true }));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.32,  // strength — 은은하게(행성 표면이 하얗게 번지지 않도록)
  0.50,  // radius
  0.82   // threshold — 태양·별·날카로운 반사만 발광, 밝은 행성 표면은 색·디테일 보존
);
composer.addPass(bloom);

// 시네마틱 그레이딩(색수차 + 필름 그레인 + 가장자리 감광) + 화면 출력 변환을 한 패스로
// - OutputPass 를 따로 두면 전체 화면 읽기·쓰기가 한 번 더 듦
// - 출력 변환은 OutputPass 와 같은 셰이더 청크(ACES 톤매핑 → sRGB) → 결과 동일
// - RawShaderMaterial: 화면에 그려도 three 가 톤매핑을 한 번 더 덧붙이지 않음
const grade = new ShaderPass(new THREE.RawShaderMaterial({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0006 },
    uGrain: { value: 0.010 },
    toneMappingExposure: { value: EXPOSURE },
  },
  vertexShader: /* glsl */`
    precision highp float;
    attribute vec3 position; attribute vec2 uv;
    uniform mat4 modelViewMatrix, projectionMatrix;
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAberration; uniform float uGrain;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
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
      gl_FragColor = sRGBTransferOETF(vec4(ACESFilmicToneMapping(col), 1.0));
    }
  `,
}));
composer.addPass(grade);

/* ============================================================
 *  5. 인터랙션
 * ============================================================ */
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

let warp = 1, warpTarget = 1;
let lastScroll = window.scrollY;
window.addEventListener('scroll', () => {
  const dy = Math.abs(window.scrollY - lastScroll);
  lastScroll = window.scrollY;
  warpTarget = Math.min(2.4, 1 + dy * 0.03);   // 스크롤 가속 완만하게
}, { passive: true });

// 인터랙티브 행성: 드래그로 굴리기(관성)
let dragging = false, dragLX = 0, dragLY = 0, velY = 0, velX = 0;
const isInteractive = (el) => el && el.closest && el.closest('a, button, input, textarea, #planet-nav');
window.addEventListener('pointerdown', (e) => {
  if (REDUCE || e.button !== 0 || isInteractive(e.target)) return;
  e.preventDefault(); // 드래그 중 텍스트 선택 방지
  dragging = true; dragLX = e.clientX; dragLY = e.clientY; velY = velX = 0;
  document.body.classList.add('grabbing');
});
const clampTilt = (x) => Math.max(-tiltLimit, Math.min(tiltLimit, x));
const endDrag = () => {
  if (dragging) { dragging = false; document.body.classList.remove('grabbing'); }
};
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag); // 터치 스크롤 전환 등으로 포인터가 끊겨도 잡힌 채 남지 않게
window.addEventListener('pointermove', (e) => {
  mouse.tx = (e.clientX / window.innerWidth - 0.5);
  mouse.ty = (e.clientY / window.innerHeight - 0.5);
  if (!dragging) return;
  const dx = e.clientX - dragLX, dy = e.clientY - dragLY;
  dragLX = e.clientX; dragLY = e.clientY;
  velY = dx * 0.006 / zoom.now; velX = dy * 0.006 / zoom.now;    // 가까이 볼수록 표면이 손가락을 따라오게
  planetGroup.rotation.y += velY;
  planetGroup.rotation.x = clampTilt(planetGroup.rotation.x + velX);
});

const TEX_STRETCH_MAX = 1.6;   // 텍스처 한 칸이 화면 몇 픽셀로 늘어나도 되는가 — 이보다 크면 표면이 뭉개진다
const RANGE_SHOW_MS = 2600;
const distanceEl = document.getElementById('distance');
let rangeTimer, lastDistance = '', lastPass = '';
let ranging = false;
// 문구의 scale은 레이아웃에 잡히지 않는다 — scrollHeight로 재면 확대 중에 페이지가 길어진 것으로 착각해 휠을 놓친다
const canScrollPage = () => document.body.offsetHeight > window.innerHeight + 4;
const markPageFit = () => rootEl.classList.toggle('fits', !canScrollPage());
addEventListener('resize', markPageFit);
markPageFit();
// 화면 가운데의 늘어남은 π·지름(px)/텍스처 폭 — 텍스처와 화면 해상도가 정하는 데까지만 다가간다
function fitZoomLimit() {
  if (body.craft || body.disc) return;
  const diameterPx = layoutTo.scale * R / halfHeightAt(planetGroup.position.z) * renderer.domElement.height;
  const texWidth = planetTex.image?.width || 2048;
  zoom.max = Math.log(THREE.MathUtils.clamp(TEX_STRETCH_MAX * texWidth / (Math.PI * diameterPx), 1.15, 1.8));
}
const zoom = createZoom({
  max: Math.log(body.craft ? 3 : 1.8),
  reduced: REDUCE, isInteractive, canScrollPage,
  onPinchStart: endDrag,
  onInput() {
    fitZoomLimit();
    ranging = true;
    rootEl.classList.add('ranging');
    clearTimeout(rangeTimer);
    rangeTimer = setTimeout(() => { ranging = false; rootEl.classList.remove('ranging'); }, RANGE_SHOW_MS);
    wake();
    if (focus.on) armCycle();                               // 들여다보는 중엔 다음 천체로 넘어가지 않는다
    renderStill();
  },
});
function stepZoom(dt) {
  zoom.step(dt);
  const pass = THREE.MathUtils.smoothstep(zoom.x, 0.05, 0.3);   // 문구를 지나쳐 앞으로 나아간다
  const text = pass.toFixed(3);
  if (text === lastPass) return;
  lastPass = text;
  heroEl.style.setProperty('--pass', text);
  rootEl.classList.toggle('zoomed', pass > 0.5);
  syncHidden();
}
// 화면에 보이는 크기와 시야각으로 계산한 실제 거리
function showDistance() {
  const reach = R * (body.size || 1) * planetGroup.scale.x / Math.abs(planetGroup.position.z);
  const km = body.km * Math.sqrt(1 + 1 / (reach * reach));
  const digits = 10 ** Math.max(0, Math.floor(Math.log10(km)) - 2);
  const text = km < 1 ? `${Math.round(km * 100) * 10} m` : `${(Math.round(km / digits) * digits).toLocaleString('en-US')} km`;
  if (text !== lastDistance) distanceEl.textContent = lastDistance = text;
}

// 워프 투 이동: 떠나는 순간 별이 가속 → 플래시 후 이동(같은 탭) — 블로그·GitHub 링크
let departing = false;
function warpDepart(url) {
  departing = true;
  document.body.classList.add('departing');
  setTimeout(() => { window.location.href = url; }, 650);
}
document.querySelectorAll('.link.main').forEach((link) => {
  link.addEventListener('click', (e) => {
    if (REDUCE || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // 새 탭/수정키는 기본 동작
    e.preventDefault();
    warpDepart(link.href);
  });
});

// 뒤로가기(bfcache) 복원 시 플래시·워프 상태 초기화 (밝은 화면 잔상 방지)
window.addEventListener('pageshow', () => {
  departing = false;
  document.body.classList.remove('departing');
  warp = 1; warpTarget = 1;
});

initPlanetPicker(body);

// 집중 모드: 글을 걷고 천체만 남긴 채 일정 주기로 다음 천체로 넘어간다
const FOCUS_CYCLE_MS = 40000;
const FOCUS_FADE_MS = 1100;
const FOCUS_IDLE_MS = 2800;
const KEY_SPIN = 0.014;                                        // 방향키 한 번의 회전 속도(rad/프레임)
const ROTATE_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const focusToggle = document.getElementById('focus-toggle');
const focusText = focusToggle.querySelector('span');
const planetMenu = document.getElementById('planet-menu');
const brandNav = document.getElementById('nav');
let cycleTimer, idleTimer;
function nextWorld() {
  rootEl.classList.add('leaving');
  setTimeout(() => (FIXED_WORLD ? location.assign('/') : location.reload()), FOCUS_FADE_MS); // 셔플 백이 다음 천체를 고른다
}
function cycleWorld() {                                        // 안 보는 탭이거나 손대는 중이면 이번 주기는 넘긴다
  if (document.hidden || dragging || !planetMenu.hidden) armCycle();
  else nextWorld();
}
function armCycle() {
  clearTimeout(cycleTimer);
  if (!REDUCE) cycleTimer = setTimeout(cycleWorld, FOCUS_CYCLE_MS);
}
function wake() {
  rootEl.classList.remove('idle');
  clearTimeout(idleTimer);
  if (focus.on) idleTimer = setTimeout(() => {
    if (planetMenu.hidden) rootEl.classList.add('idle');
  }, FOCUS_IDLE_MS);
}
// 사라진 글은 키보드·스크린리더에서도 빠진다
function syncHidden() {
  heroEl.inert = focus.on || rootEl.classList.contains('zoomed');
  brandNav.inert = focus.on;
}
function setFocus(on) {
  focus.on = on;
  rootEl.classList.toggle('focus', on);
  try { on ? sessionStorage.setItem('gaerae.focus', '1') : sessionStorage.removeItem('gaerae.focus'); } catch {}
  focusToggle.setAttribute('aria-pressed', String(on));
  focusText.textContent = on ? 'Exit' : 'Focus';
  if (REDUCE) focus.ease = on ? 1 : 0;
  layoutPlanet();
  syncHidden();
  clearTimeout(cycleTimer);
  if (on) armCycle();
  wake();
  renderStill();
}
focusToggle.addEventListener('click', () => setFocus(!focus.on));
addEventListener('pointermove', wake, { passive: true });
addEventListener('pointerdown', wake, { passive: true });
addEventListener('keydown', (e) => {
  wake();
  if (e.metaKey || e.ctrlKey || e.altKey) return;              // Cmd+F 같은 브라우저 단축키는 건드리지 않는다
  const turn = ROTATE_KEYS[e.key];
  if (turn) {
    if (REDUCE || !planetMenu.hidden || (turn[1] && canScrollPage())) return;
    velY = turn[0] * KEY_SPIN; velX = turn[1] * KEY_SPIN;
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyF') setFocus(!focus.on);                  // code — 한글 자판에서도 같은 키
  else if (e.code === 'KeyN' && focus.on) { clearTimeout(cycleTimer); nextWorld(); }
  else if (e.key === 'Escape' && planetMenu.hidden) {
    if (zoom.want !== 0) zoom.to(0);
    else if (focus.on) setFocus(false);
  }
});

/* ============================================================
 *  6. 렌더 루프
 * ============================================================ */
function updateStars(dt) {
  const calm = 1 - 0.82 * focus.ease;                           // 집중 모드: 별이 천천히 흐른다
  const speedScale = REDUCE ? 0 : warp * calm + zoom.v * 4;      // 다가가면 별이 스쳐 지나가고, 물러나면 멀어진다
  for (let i = 0; i < STAR_COUNT; i++) {
    starZ[i] += starSpeed[i] * speedScale * dt;
    if (!REDUCE && starZ[i] > 60) spawnStar(i, false);
    else if (starZ[i] < -DEPTH) { spawnStar(i, false); starZ[i] = -rnd(0, 200); }  // 물러날 때는 앞쪽에서 새 별이 들어온다
    const streak = REDUCE ? 2.0 : Math.min(starSpeed[i] * Math.abs(speedScale) * dt * 3.2, departing ? 1600 : 90) * Math.sign(speedScale || 1); // 짧고 부드러운 꼬리
    const o = i * 6;
    positions[o + 2] = starZ[i];
    positions[o + 5] = starZ[i] - streak;
  }
  starPosAttr.needsUpdate = true;
  if (starColorsDirty) { starColAttr.needsUpdate = true; starColorsDirty = false; }
}

function updateComets(dt) {
  let moved = false;
  for (let i = 0; i < NCOMET; i++) {
    const c = cometState[i];
    if (!c.active) {
      c.delay -= dt;
      if (c.delay <= 0) { c.active = true; c.life = 0; }
      continue;
    }
    moved = true;
    c.life += dt;
    c.x += c.vx * dt; c.y += c.vy * dt;
    const o = i * 6;
    const fade = Math.sin(Math.min(c.life / c.dur, 1) * Math.PI); // 서서히 나타났다 사라짐
    cometPos[o] = c.x;              cometPos[o + 1] = c.y;              cometPos[o + 2] = c.z;
    cometPos[o + 3] = c.x - c.vx * 0.11; cometPos[o + 4] = c.y - c.vy * 0.11; cometPos[o + 5] = c.z;
    const b = fade * 1.3;
    cometCol[o] = b; cometCol[o + 1] = b * 1.02; cometCol[o + 2] = b * 1.2; // 머리: 청백색
    cometCol[o + 3] = 0; cometCol[o + 4] = 0; cometCol[o + 5] = 0;          // 꼬리: 소멸
    if (c.life >= c.dur) resetComet(i, false);
  }
  if (moved) {
    cometGeo.attributes.position.needsUpdate = true;
    cometGeo.attributes.color.needsUpdate = true;
  }
}

function updateSpin(dt) {
  planet.rotation.y += dt * body.spin;                          // 자전(메시에 적용 → 고리/자세 그룹과 분리)
  if (dragging) return;
  const frames = dt * 60;                                       // 화면 주사율과 무관하게 같은 관성
  planetGroup.rotation.y += velY * frames;                      // 드래그 관성 + 커서를 향한 은은한 기울임
  planetGroup.rotation.x = clampTilt(planetGroup.rotation.x + velX * frames);
  const damping = Math.pow(0.94, frames);
  velY *= damping; velX *= damping;
  const aimY = mouse.x * 0.26;                                  // 커서 쪽으로 살짝 바라봄(±~8°)
  const aimX = restX - mouse.y * 0.12;                          // 커서 상하에 따라 미세 끄덕임
  planetGroup.rotation.y += (aimY - planetGroup.rotation.y) * dt * 0.9;
  planetGroup.rotation.x += (aimX - planetGroup.rotation.x) * dt * 0.9;
}

const LAYOUT_RATE = 1.5;                                        // 일반 ↔ 집중 위치 전환 속도
function updateFraming(dt, et) {
  const { damp, smoothstep } = THREE.MathUtils;
  layoutNow.x = damp(layoutNow.x, layoutTo.x, LAYOUT_RATE, dt);
  layoutNow.y = damp(layoutNow.y, layoutTo.y, LAYOUT_RATE, dt);
  layoutNow.scale = damp(layoutNow.scale, layoutTo.scale, LAYOUT_RATE, dt);
  focus.ease = damp(focus.ease, focus.on ? 1 : 0, LAYOUT_RATE, dt);
  const drift = REDUCE ? 0 : focus.ease * Math.min(et / FOCUS_DRIFT_SECONDS, 1); // 집중 모드: 40초에 걸쳐 살짝 다가간다
  const near = smoothstep(zoom.x, 0, Math.log(1.7));            // 다가갈수록 화면 가운데로
  planetGroup.position.x = (layoutNow.x - drift * 26) * (1 - near);
  planetGroup.position.y = (layoutNow.y + Math.sin(et * 0.4) * 7) * (1 - near);
  planetGroup.scale.setScalar(layoutNow.scale * (1 + drift * 0.06) * zoom.now);
}

function updateWarp(dt) {
  if (departing) {
    warp += (120 - warp) * dt * 2.5;                            // 떠남: 워프 가속
  } else {
    warpTarget += (1 - warpTarget) * dt * 1.6;
    warp += (warpTarget - warp) * dt * 4.0;
  }
}

function updatePlanet(dt, et) {
  updateSpin(dt);
  stepZoom(dt);
  updateFraming(dt, et);
  if (ranging) showDistance();
  if (planetFadeIn) for (const f of fades) f.u.value = Math.min(1, f.u.value + dt * f.rate);
  for (const update of frameLayers) update(dt, et);
  updateWarp(dt);
}

function updateParallax(dt) {
  mouse.x += (mouse.tx - mouse.x) * dt * 1.1;     // 느린 easing
  mouse.y += (mouse.ty - mouse.y) * dt * 1.1;
  camera.rotation.y = -mouse.x * 0.17;
  camera.rotation.x = mouse.y * 0.11;
  camera.position.x = mouse.x * 26;
  camera.position.y = -mouse.y * 20;
  planetCam.position.x = camera.position.x;       // 망원은 회전만 1/K — 화면상 패럴랙스 양을 광각과 맞춘다
  planetCam.position.y = camera.position.y;
  planetCam.rotation.set(camera.rotation.x / LENS_K, camera.rotation.y / LENS_K, 0);
  // 커서를 따라 태양 방향 미세 이동 → 명암 경계(터미네이터)가 흐르며 입체감↑
  sunBase.copy(sunDir).lerp(FOCUS_SUN, body.craft ? 1 : focus.ease);
  sunAim.set(sunBase.x + mouse.x * 0.22, sunBase.y - mouse.y * 0.14, sunBase.z).normalize();
  planetUniforms.uSun.value.copy(sunAim);
  craft?.aimSun(sunAim);
  planetUniforms.uGlint.value = 0.34 - 0.12 * focus.ease;        // 빗긴 빛에서 번지지 않게
}

// 적응형 해상도: 25fps 아래가 이어지면 픽셀 비율을 내린다. 화질이 오르내리지 않게 되돌리지 않고, 1배 아래로는 낮추지 않는다.
const QUALITY_SETTLE_SECONDS = 4;   // 텍스처 업로드가 끝난 뒤부터 잰다
const QUALITY_WINDOW_SECONDS = 2;
const MIN_FPS = 25;                 // 저전력 모드의 30fps 제한은 낮추지 않게
let qualityTime = 0, qualityFrames = 0;
function watchFrameRate(rawDt, et) {
  if (et < QUALITY_SETTLE_SECONDS || rawDt > 0.25 || pixelRatio <= 1) return; // 탭 복귀 등 공백은 제외
  qualityTime += rawDt;
  qualityFrames++;
  if (qualityTime < QUALITY_WINDOW_SECONDS) return;
  const fps = qualityFrames / qualityTime;
  qualityTime = qualityFrames = 0;
  if (fps >= MIN_FPS) return;
  pixelRatio = Math.max(1, pixelRatio - 0.5);
  renderer.setPixelRatio(pixelRatio);
  composer.setPixelRatio(pixelRatio);
}

// 그림자 기준을 월드 좌표로 맞춘다(정지 모드에서도 필요)
const moonWorld = new THREE.Vector3();
function syncShadows() {
  const scale = planetGroup.scale.x;
  planetBody.uCenter.value.copy(planetGroup.position);
  planetBody.uRworld.value = R * scale;
  if (ringTex) planetUniforms.uRingNormal.value.set(0, 1, 0).applyQuaternion(planetGroup.quaternion);
  moons.forEach((m, i) => {
    m.mesh.getWorldPosition(moonWorld);
    moonSpheres[i].set(moonWorld.x, moonWorld.y, moonWorld.z, m.radius * scale);
  });
}

// 움직임을 줄인 환경은 루프가 멈춰 있어 입력이 있을 때 한 장만 다시 그린다
function renderStill() {
  if (!REDUCE) return;
  updatePlanet(0, 0);
  updateParallax(0);
  syncShadows();
  renderIfPaused();
}

let frameId = 0;        // 예약된 프레임 — 중복 루프 방지
let lastFrameAt = 0;
function startLoop() {
  running = true;
  clock.getDelta();     // 쉬는 동안의 시간을 버린다
  if (!frameId) frameId = requestAnimationFrame(animate);
}

function animate(now) {
  frameId = 0;
  if (!running || contextLost) return;
  frameId = requestAnimationFrame(animate);
  if (now - lastFrameAt < MIN_FRAME_MS) return;
  lastFrameAt = now;

  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const et = clock.elapsedTime;
  const tt = REDUCE ? 0.0 : et;   // 셰이더 시간 (reduce면 정지)

  skyUniforms.uTime.value = tt;
  grade.uniforms.uTime.value = tt;

  if (!REDUCE) {
    nebulaBakeUniforms.uTime.value = tt;
    bakeNextNebulaBand();
    updatePlanet(dt, et);
    updateComets(dt);
    if (!dragging) updateParallax(dt);                          // 드래그 중엔 카메라 정지
    watchFrameRate(rawDt, et);
  }
  updateStars(dt);
  syncShadows();

  composer.render();

  if (REDUCE && et > REDUCE_RENDER_SECONDS) running = false;    // 정지(배터리 절약)
}
if (focus.on) setFocus(true);       // 렌더 함수까지 정의된 뒤에 복원한다
if (REDUCE) updateParallax(0);      // 루프가 태양 방향을 갱신하지 않으므로 한 번 맞춘다
startLoop();

/* ============================================================
 *  7. 리사이즈 · 가시성 · 컨텍스트 복구 · 로더 해제
 * ============================================================ */
const RESIZE_DEBOUNCE_MS = 120;     // 창 크기를 끄는 동안 렌더 타깃을 매번 다시 만들지 않게
let resizeTimer;
function applyResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = planetCam.aspect = w / h;
  camera.updateProjectionMatrix();
  planetCam.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  layoutPlanet();
  renderStill();
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyResize, RESIZE_DEBOUNCE_MS);
});

// 탭 숨김 시 렌더 정지(배터리 절약), 복귀 시 재개
document.addEventListener('visibilitychange', () => {
  if (document.hidden) running = false;
  else if (!contextLost) startLoop();
});

// WebGL 컨텍스트 손실/복구
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; running = false; });
canvas.addEventListener('webglcontextrestored', () => { contextLost = false; bakeNebula(); startLoop(); });

requestAnimationFrame(() => document.body.classList.add('ready'));
