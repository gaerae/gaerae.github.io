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
// 시네마틱 톤매핑 — 하이라이트를 부드럽게 롤오프해 실사감↑·과노출 방지(지구 등)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

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
  // 달 위상을 반영하되, 히어로 행성이 늘 보기 좋게 차오른(gibbous~전광) 범위로 제한 — 역광으로 어두워지지 않게
  const theta = (0.46 - 0.22 * illum) * Math.PI;
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
 *  3. 외계행성 — 셰이더로 직접 생성한 상상의 가스 행성 (접속마다 고유)
 *     흐르는 띠 · 대형 폭풍 · 대기 · (일부) 얼음 고리 · 실사 라이팅
 * ============================================================ */
renderer.outputColorSpace = THREE.SRGBColorSpace;

// 종(種) 프리셋: 색 램프 3단(심부/중간/하이라이트) + 대기 림색 + 폭풍색
const SPECIES = [
  { name: 'Aureus',  deep: [0.10, 0.06, 0.03], mid: [0.60, 0.40, 0.17], hi: [0.98, 0.86, 0.58], rim: [1.00, 0.80, 0.46], spot: [0.82, 0.30, 0.18] },
  { name: 'Veridis', deep: [0.02, 0.09, 0.09], mid: [0.10, 0.46, 0.42], hi: [0.72, 0.96, 0.86], rim: [0.40, 0.95, 0.85], spot: [0.95, 0.82, 0.42] },
  { name: 'Amethys', deep: [0.09, 0.04, 0.14], mid: [0.44, 0.20, 0.56], hi: [0.92, 0.78, 0.99], rim: [0.76, 0.54, 1.00], spot: [0.42, 0.72, 1.00] },
  { name: 'Caelum',  deep: [0.02, 0.06, 0.14], mid: [0.16, 0.40, 0.70], hi: [0.84, 0.93, 1.00], rim: [0.48, 0.74, 1.00], spot: [0.98, 0.72, 0.46] },
  { name: 'Ember',   deep: [0.12, 0.03, 0.03], mid: [0.60, 0.22, 0.14], hi: [0.99, 0.74, 0.50], rim: [1.00, 0.54, 0.36], spot: [1.00, 0.90, 0.62] },
];
const S = SPECIES[Math.floor(Math.random() * SPECIES.length)];
// 개체 고유 파라미터 (매 방문 미묘하게 다른 형상)
const seed = Math.random() * 10;
const bandFreq = 7.0 + Math.random() * 6.0;      // 띠 개수
const turbulence = 0.55 + Math.random() * 0.7;   // 띠 요동
const hasRing = Math.random() < 0.55;            // 약 55% 고리 보유
const hasSpot = Math.random() < 0.7;             // 대형 폭풍
const spin = 0.035 + Math.random() * 0.03;       // 자전 속도
const planetName = S.name + '-' + (100 + Math.floor(Math.random() * 899)) + (hasRing ? 'r' : '');

const R = 420;
const planetGroup = new THREE.Group();
// 고리 개체는 고리가 열려 보이도록 자세 고정, 그 외엔 랜덤 자전축
const restX = hasRing ? -0.85 : 0;
planetGroup.rotation.z = hasRing ? 0.30 : (0.24 + Math.random() * 0.28);
planetGroup.rotation.x = restX;
// 화면 비율에 맞춰 배치: 데스크톱은 크게 잘려 웅장하게, 모바일은 우측에서 살짝 걸치게
let planetBaseY = 255;
function layoutPlanet() {
  if (window.innerWidth < 760) {
    // 모바일: 축소 + 우측으로 밀어 — 고리가 본문/칩을 덮지 않게
    planetGroup.position.set(560, -150, -1440);
    planetGroup.scale.setScalar(0.5);
  } else {
    planetGroup.position.set(880, 255, -1430);
    planetGroup.scale.setScalar(1);
  }
  planetBaseY = planetGroup.position.y;
}
layoutPlanet();
scene.add(planetGroup);

const sunDir = SKY.sunDir.clone();

// ── 표면: 위도 기반 가스 띠 + 도메인 워프 난류 + 대형 폭풍 + 부드러운 라이팅 ──
const planetUniforms = {
  uTime: { value: 0 }, uSun: { value: sunDir }, uSeed: { value: seed },
  uDeep: { value: new THREE.Color(...S.deep) }, uMid: { value: new THREE.Color(...S.mid) },
  uHi: { value: new THREE.Color(...S.hi) }, uSpot: { value: new THREE.Color(...S.spot) },
  uBandFreq: { value: bandFreq }, uTurb: { value: turbulence }, uSpotOn: { value: hasSpot ? 1.0 : 0.0 },
  uOpacity: { value: REDUCE ? 1 : 0 },
};
const planet = new THREE.Mesh(
  new THREE.SphereGeometry(R, 160, 160),
  new THREE.ShaderMaterial({
    transparent: true,
    uniforms: planetUniforms,
    vertexShader: /* glsl */`
      varying vec3 vObj; varying vec3 vWN; varying vec3 vVD;
      void main(){
        vObj = position;
        vWN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vVD = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vObj; varying vec3 vWN; varying vec3 vVD;
      uniform float uTime, uSeed, uBandFreq, uTurb, uSpotOn, uOpacity;
      uniform vec3 uSun, uDeep, uMid, uHi, uSpot;
      float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                       mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                       mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=0.5;} return v; }
      void main(){
        vec3 p = normalize(vObj);
        vec3 sp = p * 1.8 + vec3(uSeed);
        float t = uTime * 0.03;
        // 도메인 워프: 띠를 천천히 일렁이게
        vec3 w = vec3(fbm(sp + vec3(0.0, t, 0.0)),
                      fbm(sp + vec3(t*0.6, 1.3, 0.0)),
                      fbm(sp + vec3(1.7, 0.0, t*0.5)));
        float lat = p.y + (w.x - 0.5) * uTurb * 0.8;                 // 위도 + 난류
        float bands = 0.5 + 0.5 * sin(lat * uBandFreq + (w.y - 0.5) * uTurb * 3.0);
        float detail = fbm(sp * 2.2 + w * 1.4 + vec3(t));            // 미세 소용돌이
        float v = clamp(bands * 0.8 + detail * 0.4, 0.0, 1.0);
        // 색 램프 (심부 → 중간 → 하이라이트) — 하이라이트는 좁게 써 띠가 또렷하게
        vec3 col = mix(uDeep, uMid, smoothstep(0.12, 0.52, v));
        col = mix(col, uHi, smoothstep(0.70, 0.98, v));
        // 대형 폭풍 (타원 소용돌이)
        if (uSpotOn > 0.5) {
          vec2 sc = vec2(0.6 + 0.1 * sin(uSeed), -0.12);
          vec2 pc = vec2(atan(p.z, p.x), p.y);
          float d = length((pc - sc) * vec2(0.5, 1.7));
          float storm = smoothstep(0.55, 0.0, d);
          float swirl = fbm(sp * 1.6 + storm * 2.2);
          col = mix(col, uSpot * (0.7 + 0.5 * swirl), storm * 0.9);
        }
        // 라이팅: 부드러운 터미네이터 + 가장자리 감광
        vec3 N = normalize(vWN);
        float ndl = dot(N, normalize(uSun));
        float day = smoothstep(-0.18, 0.40, ndl);
        float limb = pow(clamp(dot(N, normalize(vVD)), 0.0, 1.0), 0.5);
        vec3 lit = col * (0.05 + day * 0.98) * (0.60 + 0.40 * limb);
        lit += col * (1.0 - day) * 0.045;   // 야간측 미세 자생광(완전 암흑 방지)
        gl_FragColor = vec4(lit, uOpacity);
      }
    `,
  })
);
planetGroup.add(planet);
let planetFadeIn = !REDUCE;   // 텍스처 대기 없음 → 즉시 등장(페이드)
const clouds = null;          // 가스 행성은 표면 자체가 흐르는 구름

// ── 고리: 셰이더로 생성한 얼음 고리 (일부 개체만) ──
let ring = null;
if (hasRing) {
  const inner = R * 1.32, outer = R * 2.30;
  const rg = new THREE.RingGeometry(inner, outer, 180, 1);
  const rp = rg.attributes.position, ruv = rg.attributes.uv, tmp = new THREE.Vector3();
  for (let i = 0; i < rp.count; i++) { tmp.fromBufferAttribute(rp, i); ruv.setXY(i, (tmp.length() - inner) / (outer - inner), 0.5); }
  ring = new THREE.Mesh(rg, new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    uniforms: {
      uOpacity: { value: REDUCE ? 1 : 0 }, uSeed: { value: seed },
      uCol: { value: new THREE.Color(...S.rim) }, uDeep: { value: new THREE.Color(...S.mid) },
    },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; uniform float uOpacity, uSeed; uniform vec3 uCol, uDeep;
      float hash(float n){ return fract(sin(n) * 43758.5453); }
      float bn(float x){ float i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f); return mix(hash(i),hash(i+1.0),f); }
      void main(){
        float u = vUv.x;                                   // 0 내측 … 1 외측
        float bands = 0.5 + 0.5 * sin(u * 150.0 + uSeed);  // 촘촘한 띠
        float fine = bn(u * 55.0 + uSeed) * 0.6 + bn(u * 190.0) * 0.4;
        float gap = smoothstep(0.015, 0.06, abs(u - 0.46));// 중앙 큰 틈(카시니)
        float dens = clamp(bands * 0.35 + fine * 0.85, 0.0, 1.0) * gap;
        dens *= smoothstep(0.0, 0.05, u) * smoothstep(1.0, 0.9, u); // 가장자리 페이드
        vec3 col = mix(uDeep * 1.3, uCol, fine);
        gl_FragColor = vec4(col, dens * 0.92 * uOpacity);
      }
    `,
  }));
  ring.rotation.x = Math.PI * 0.5;
  ring.renderOrder = 1;
  planetGroup.add(ring);
}

// 대기 림 (팔레트 색)
const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.05, 96, 96),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: {
      uLight: { value: sunDir.clone() },
      uColor: { value: new THREE.Color(...S.rim) },
      uStrength: { value: 0.95 },
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
        vec3 c = uColor * rim * (0.15 + lit * 0.9) * uStrength;
        c += vec3(0.20, 0.34, 0.62) * rim * 0.13;
        float a = rim * (0.3 + lit * 0.55) * 0.7 * uStrength + rim * 0.10;
        gl_FragColor = vec4(c, a);
      }
    `,
  })
);
planetGroup.add(atmo);
atmo.renderOrder = 2;

/* ============================================================
 *  4. 후처리 (은은한 Bloom)
 * ============================================================ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.40,  // strength
  0.55,  // radius
  0.62   // threshold — 가장 밝은 부분만(톤매핑과 함께 과노출 방지)
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
  planetGroup.rotation.x = Math.max(-1.05, Math.min(1.05, planetGroup.rotation.x + velX));
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
  planetLabel.innerHTML = '◦&nbsp; ' + planetName;
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
  planetUniforms.uTime.value = tt;

  if (!REDUCE) {
    planet.rotation.y += dt * spin;                             // 자전(메시에 적용 → 고리/자세 그룹과 분리)
    const lim = hasRing ? 1.05 : 0.7;                           // 고리 행성은 더 눕혀 고리가 열려 보이게
    if (!dragging) {                                            // 드래그 관성 + 기본 자세 복귀
      planetGroup.rotation.y += velY;
      planetGroup.rotation.x = Math.max(-lim, Math.min(lim, planetGroup.rotation.x + velX));
      velY *= 0.94; velX *= 0.94;
      planetGroup.rotation.y += (0 - planetGroup.rotation.y) * dt * 0.15; // 드래그 후 정면 복귀(고리 안정)
      planetGroup.rotation.x += (restX - planetGroup.rotation.x) * dt * 0.25;
    }
    planetGroup.position.y = planetBaseY + Math.sin(et * 0.4) * 7; // 미세한 부유
    atmo.scale.setScalar(1.0 + Math.sin(et * 0.5) * 0.014);     // 숨쉬는 대기 글로우
    if (planetFadeIn && planetUniforms.uOpacity.value < 1) planetUniforms.uOpacity.value = Math.min(1, planetUniforms.uOpacity.value + dt * 1.8); // 행성 페이드인
    if (ring && planetFadeIn && ring.material.uniforms.uOpacity.value < 1) ring.material.uniforms.uOpacity.value = Math.min(1, ring.material.uniforms.uOpacity.value + dt * 1.5);
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
