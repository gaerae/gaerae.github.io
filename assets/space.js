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
 *  3. 행성 — 실제 천체의 고해상 텍스처(접속마다 랜덤)
 *     목성·토성·화성·수성·달·지구·금성·해왕성·천왕성
 *     텍스처: Solar System Scope (solarsystemscope.com), CC BY 4.0
 * ============================================================ */
renderer.outputColorSpace = THREE.SRGBColorSpace;

// 공통 노이즈·셀룰러 — 모든 표면 셰이더가 공유 (중복 선언 방지)
const NOISE = /* glsl */`
  float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float noise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                   mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                   mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=0.5;} return v; }
  // 셀룰러(보로노이): 가장 가까운 두 점까지 거리 — 크레이터·얼음판·용암 셀에 사용
  vec2 cell(vec3 p){ vec3 ip=floor(p),fp=fract(p); float d1=9.0,d2=9.0;
    for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
      vec3 g=vec3(float(x),float(y),float(z));
      vec3 o=vec3(hash(ip+g),hash(ip+g+11.3),hash(ip+g+27.1));
      float d=length(g+o-fp);
      if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; } }
    return vec2(d1,d2); }
`;
const VSHADER = /* glsl */`
  varying vec3 vObj; varying vec3 vWN; varying vec3 vVD;
  void main(){
    vObj = position;
    vWN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vVD = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* 세계 유형 — 형태 자체가 다른 5종. 각 유형이 전용 표면 셰이더·대기·고리·이름을 반환 */
/* 실제 천체 — 공개 라이선스 고해상 텍스처를 구에 입힘. 접속마다 랜덤.
   행성: Solar System Scope (CC BY 4.0) / 위성·왜소행성(이오·유로파·가니메데·칼리스토·타이탄·명왕성): NASA·USGS (public domain).
   실제 편평도(obl)·자전축 기울기(천왕성 98°)·고리(토성 실측, 그 외 희미한 절차적)까지 반영. */
const TEX = 'assets/textures/';
const BODIES = [
  // obl = 편평도(적도 팽창), ring = 실측(tex) 또는 희미한 절차적 고리, sideways = 천왕성의 누운 자전축
  { nm:'Jupiter', tex:'2k_jupiter.jpg',          spin:0.045, obl:0.06,  atmo:{col:[.96,.82,.64],s:0.75},
      ring:{ inner:1.40, outer:1.82, col:[.54,.44,.36], op:0.09 } },             // 희미한 먼지 고리
  { nm:'Saturn',  tex:'2k_saturn.jpg',           spin:0.042, obl:0.09,  atmo:{col:[.98,.90,.70],s:0.50},
      ring:{ tex:'2k_saturn_ring_alpha.png', inner:1.28, outer:2.35 } },         // 실측 고리(카시니 간극)
  { nm:'Uranus',  tex:'2k_uranus.jpg',           spin:0.038, obl:0.02,  sideways:true, atmo:{col:[.62,.92,.96],s:0.60},
      ring:{ inner:1.58, outer:2.00, col:[.60,.66,.70], op:0.30, ringlets:true } }, // 세로로 선 좁은 고리(98° 기울기)
  { nm:'Neptune', tex:'2k_neptune.jpg',          spin:0.040, obl:0.017, atmo:{col:[.42,.58,1],s:0.72},
      ring:{ inner:1.50, outer:2.05, col:[.44,.50,.64], op:0.12, arcs:true } },   // 희미한 고리 + 아크
  { nm:'Mars',    tex:'2k_mars.jpg',             spin:0.030, atmo:{col:[1,.58,.40],s:0.22} },
  { nm:'Venus',   tex:'2k_venus_atmosphere.jpg', spin:0.024, atmo:{col:[1,.86,.55],s:0.65} },
  { nm:'Earth',   tex:'2k_earth_daymap.jpg',     spin:0.035, atmo:{col:[.46,.70,1],s:0.95} },
  { nm:'Mercury', tex:'2k_mercury.jpg',          spin:0.020, atmo:null },
  { nm:'Luna',    tex:'2k_moon.jpg',             spin:0.018, atmo:null },
  { nm:'Io',       tex:'2k_io.jpg',              spin:0.022, atmo:null },                       // 목성 위성 — 화산·유황
  { nm:'Europa',   tex:'2k_europa.jpg',          spin:0.020, atmo:{col:[.72,.84,.96],s:0.16} }, // 목성 위성 — 얼음(균열선)
  { nm:'Ganymede', tex:'2k_ganymede.jpg',        spin:0.019, atmo:null },                       // 목성 위성 — 최대 위성, 명암 지형
  { nm:'Callisto', tex:'2k_callisto.jpg',        spin:0.017, atmo:null },                       // 목성 위성 — 크레이터 뒤덮인 암흑 표면
  { nm:'Titan',   tex:'2k_titan.jpg',            spin:0.020, haze:[1,.60,.26], atmo:{col:[1,.66,.30],s:0.92} }, // 토성 위성 — 짙은 오렌지 스모그
  { nm:'Pluto',   tex:'2k_pluto.jpg',            spin:0.016, atmo:{col:[.56,.70,.95],s:0.24} }, // 왜소행성 — 옅은 블루 헤이즈(하트)
];
const body = pick(BODIES);
const world = {
  name: body.nm,
  spin: body.spin,
  ring: !!body.ring,
  atmo: body.atmo ? { col: body.atmo.col, strength: body.atmo.s } : null,
};

// 개체 고유 파라미터
const seed = Math.random() * 10;
const spin = world.spin;              // 자전 속도
const hasRing = world.ring;           // 고리 보유 여부(유형별 확률)
const sizeVar = rnd(0.85, 1.12);      // 개체마다 크기도 조금씩 다르게
const planetName = world.name + '-' + (100 + Math.floor(Math.random() * 899)) + (hasRing ? 'r' : '');

const R = 420;
const oblY = 1 - (body.obl || 0);     // 편평도: 자전축(Y) 방향으로 눌러 적도가 부풀게
const planetGroup = new THREE.Group();
// 자전축 기울기 / 고리 자세
let restX, rotZ;
if (body.sideways) {                  // 천왕성: 거의 옆으로 누운 자전축 → 고리가 세로로 선다
  restX = -0.12; rotZ = 1.42;
} else if (body.ring && body.ring.tex) { // 토성: 실측 고리가 활짝 열려 보이는 자세
  restX = -0.85; rotZ = 0.30;
} else {                              // 그 외: 은은한 자전축(희미한 고리는 적도면에 가늘게)
  restX = 0; rotZ = 0.24 + Math.random() * 0.28;
}
planetGroup.rotation.z = rotZ;
planetGroup.rotation.x = restX;
// 화면 비율에 맞춰 배치: 데스크톱은 크게 잘려 웅장하게, 모바일은 우측에서 살짝 걸치게
let planetBaseY = 255;
function layoutPlanet() {
  const w = window.innerWidth;
  if (w < 760) {
    // 모바일: 축소 + 우측으로 밀어 — 고리가 본문/칩을 덮지 않게
    planetGroup.position.set(560, -150, -1440);
    planetGroup.scale.setScalar(0.5 * sizeVar);
  } else if (w < 1180) {
    // 중간 폭(노트북·태블릿 가로): 안쪽으로 당기고 살짝 축소 — 화면 밖으로 잘려나가 사라지지 않게
    planetGroup.position.set(560, 225, -1500);
    planetGroup.scale.setScalar(0.72 * sizeVar);
  } else {
    planetGroup.position.set(880, 255, -1430);
    planetGroup.scale.setScalar(1 * sizeVar);
  }
  planetBaseY = planetGroup.position.y;
}
layoutPlanet();
scene.add(planetGroup);

const sunDir = SKY.sunDir.clone();
const sunAim = new THREE.Vector3(); // 커서 반응용 태양 방향(프레임마다 재계산)

// ── 표면: 실제 천체 텍스처(알베도)를 시네마틱 명암으로 조명 ──
const texLoader = new THREE.TextureLoader();
let planetFadeIn = false;      // 텍스처 로드 완료 후 페이드인
const planetTex = texLoader.load(TEX + body.tex, () => { planetFadeIn = !REDUCE; });
planetTex.colorSpace = THREE.SRGBColorSpace;
planetTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const planetUniforms = {
  uTime: { value: 0 }, uSun: { value: sunDir.clone() }, uSeed: { value: seed },
  uOpacity: { value: REDUCE ? 1 : 0 },
  uMap: { value: planetTex },
  uNight: { value: body.atmo ? 0.05 : 0.015 },                 // 밤면 환경광(대기 있으면 약간 밝게)
  uRim: { value: new THREE.Color(...(body.atmo ? body.atmo.col : [.5,.55,.7])) },
  uAtmoPow: { value: body.atmo ? 0.5 : 0.0 },                   // 가장자리 대기 산란 세기
  uHaze: { value: new THREE.Color(...(body.haze || [0, 0, 0])) }, // 전역 대기 스모그(타이탄)
  uHazeAmt: { value: body.haze ? 0.72 : 0.0 },
};
const planet = new THREE.Mesh(
  new THREE.SphereGeometry(R, 160, 160),
  new THREE.ShaderMaterial({
    transparent: true,
    uniforms: planetUniforms,
    vertexShader: /* glsl */`
      varying vec2 vT; varying vec3 vWN; varying vec3 vVD;
      void main(){
        vT = uv;
        vWN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vVD = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vT; varying vec3 vWN; varying vec3 vVD;
      uniform sampler2D uMap; uniform vec3 uSun, uRim, uHaze; uniform float uOpacity, uNight, uAtmoPow, uHazeAmt;
      void main(){
        vec3 alb = texture2D(uMap, vT).rgb;
        // 전역 대기 스모그(타이탄): 음영을 들어올려 대비를 낮추고 오렌지로 물들임 — 표면은 은은히 비침
        alb = mix(alb, (0.42 + 0.58 * alb) * uHaze, uHazeAmt);
        vec3 N = normalize(vWN);
        float ndl = dot(N, normalize(uSun));
        float day = smoothstep(-0.12, 0.30, ndl);                // 부드러운 명암 경계
        float vd = clamp(dot(N, normalize(vVD)), 0.0, 1.0);
        float limb = 0.74 + 0.26 * pow(vd, 0.5);                 // 가장자리 감광
        vec3 lit = alb * (0.06 + day * 0.98) * limb;             // 과노출 억제 → 표면 색·띠 보존
        lit += alb * (1.0 - day) * uNight;                       // 밤면 미세 환경광
        float fres = pow(1.0 - vd, 3.0);
        lit += uRim * fres * day * uAtmoPow;                     // 햇빛 받는 가장자리 대기 산란
        lit += uHaze * fres * day * uHazeAmt * 0.6;              // 스모그 가장자리 글로우
        gl_FragColor = vec4(lit, uOpacity);
      }`,
  })
);
planet.scale.set(1, oblY, 1);        // 편평도(가스/얼음행성은 적도가 부풀어 보임)
planetGroup.add(planet);

// ── 고리: 토성=실측 텍스처, 그 외 거대행성=희미한 절차적 고리 ──
let ring = null;
if (hasRing) {
  const inner = R * body.ring.inner, outer = R * body.ring.outer;
  const rg = new THREE.RingGeometry(inner, outer, 240, 1);
  const rp = rg.attributes.position, ruv = rg.attributes.uv, tmp = new THREE.Vector3();
  for (let i = 0; i < rp.count; i++) {
    tmp.fromBufferAttribute(rp, i);
    ruv.setXY(i, (tmp.length() - inner) / (outer - inner), 0.5); // u = 반지름 위치
  }
  let ringMat;
  if (body.ring.tex) {
    // 토성: 실측 고리 텍스처(반지름 방향 밴드 + 카시니 간극 + 알파)
    const ringTex = texLoader.load(TEX + body.ring.tex);
    ringTex.colorSpace = THREE.SRGBColorSpace;
    ringMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false,
      uniforms: { uOpacity: { value: REDUCE ? 1 : 0 }, uTime: { value: 0 }, uMap: { value: ringTex } },
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float; varying vec2 vUv; uniform sampler2D uMap; uniform float uOpacity;
        void main(){ vec4 t = texture2D(uMap, vec2(vUv.x, 0.5)); gl_FragColor = vec4(t.rgb, t.a * uOpacity); }`,
    });
  } else {
    // 목성·천왕성·해왕성: 희미한 절차적 고리(좁은 링렛/아크까지 실제에 가깝게)
    ringMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false,
      uniforms: {
        uOpacity: { value: REDUCE ? 1 : 0 }, uTime: { value: 0 },
        uCol: { value: new THREE.Color(...body.ring.col) }, uOp: { value: body.ring.op },
        uRinglets: { value: body.ring.ringlets ? 1 : 0 }, uArcs: { value: body.ring.arcs ? 1 : 0 },
      },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec2 vDir; void main(){ vUv = uv; vDir = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float; varying vec2 vUv; varying vec2 vDir;
        uniform float uOpacity, uOp, uTime, uRinglets, uArcs; uniform vec3 uCol;
        void main(){
          float u = vUv.x;
          float dens = smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.90, u);   // 안팎 페이드
          if (uRinglets > 0.5) {                                             // 천왕성: 좁고 또렷한 링렛
            float r = abs(fract(u * 6.0) - 0.5);
            dens *= smoothstep(0.42, 0.30, r) * 0.9 + 0.1;
          }
          if (uArcs > 0.5) {                                                 // 해왕성: 둘레 일부만 밝은 아크
            float ang = atan(vDir.y, vDir.x);
            dens *= 0.35 + 0.65 * smoothstep(0.2, 0.95, sin(ang * 3.0 + uTime * 0.08) * 0.5 + 0.5);
          }
          gl_FragColor = vec4(uCol, dens * uOp * uOpacity);
        }`,
    });
  }
  ring = new THREE.Mesh(rg, ringMat);
  ring.rotation.x = Math.PI * 0.5;
  ring.renderOrder = 1;
  planetGroup.add(ring);
}

// 대기 림 (유형별 색·세기) — 암석/달 유형은 대기 없음(null)
let atmo = null;
if (world.atmo) {
  atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.05, 96, 96),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: {
        uLight: { value: sunDir.clone() },
        uColor: { value: new THREE.Color(...world.atmo.col) },
        uStrength: { value: world.atmo.strength },
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
          float rim = pow(1.0 - abs(dot(n, vec3(0.0,0.0,1.0))), 4.5);
          float ndl = dot(n, normalize(uLight));
          float lit = clamp(ndl + 0.15, 0.0, 1.0);
          // 전방산란 초승달 — 햇빛 받는 가장자리가 타오르듯 밝아지는 역광 글로우(시네마틱 핵심 큐)
          float crescent = pow(clamp(ndl * 0.5 + 0.5, 0.0, 1.0), 2.6) * rim;
          vec3 c = uColor * rim * (0.12 + lit * 0.82) * uStrength;
          c += uColor * crescent * 0.95 * uStrength;           // 밝은 초승달 띠
          c += vec3(0.20, 0.34, 0.62) * rim * 0.12;
          float a = rim * (0.28 + lit * 0.5) * 0.66 * uStrength + crescent * 0.42 * uStrength + rim * 0.09;
          gl_FragColor = vec4(c, a);
        }
      `,
    })
  );
  planetGroup.add(atmo);
  atmo.renderOrder = 2;
}

// ── 위성(달): 0~2개가 궤도를 도는 작은 천체 — 매 방문 다른 구성의 "움직이는 차별점" ──
const moons = [];
const moonRoll = Math.random();
const moonCount = REDUCE ? 0 : (moonRoll < 0.45 ? 0 : moonRoll < 0.82 ? 1 : 2);
for (let i = 0; i < moonCount; i++) {
  const mr = R * rnd(0.055, 0.13);
  const mcol = pick([[0.55, 0.54, 0.50], [0.70, 0.72, 0.78], [0.62, 0.50, 0.42], [0.80, 0.82, 0.86]]);
  const mMesh = new THREE.Mesh(
    new THREE.SphereGeometry(mr, 48, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uSun: planetUniforms.uSun,                 // 행성과 같은(커서 반응) 태양 방향 공유
        uSeed: { value: Math.random() * 10 },
        uCol: { value: new THREE.Color(...mcol) },
        uOpacity: { value: REDUCE ? 1 : 0 },
      },
      vertexShader: VSHADER,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vObj; varying vec3 vWN; varying vec3 vVD;
        uniform vec3 uSun, uCol; uniform float uSeed, uOpacity;
        ${NOISE}
        void main(){
          vec3 p = normalize(vObj);
          float n = fbm(p * 6.0 + uSeed);
          vec3 col = uCol * (0.65 + 0.45 * n);
          vec2 c = cell(p * 7.0 + uSeed);                 // 작은 크레이터 얼룩
          col *= 1.0 - (1.0 - smoothstep(0.0, 0.12, c.x)) * 0.35;
          vec3 N = normalize(vWN); float ndl = dot(N, normalize(uSun));
          float day = smoothstep(-0.05, 0.30, ndl);
          float limb = pow(clamp(dot(N, normalize(vVD)), 0.0, 1.0), 0.7);
          vec3 lit = col * (0.04 + day * 1.0) * (0.78 + 0.22 * limb);
          gl_FragColor = vec4(lit, uOpacity);
        }`,
    })
  );
  moons.push({
    mesh: mMesh, orad: R * rnd(1.55, 2.7), ang: Math.random() * Math.PI * 2,
    speed: rnd(0.12, 0.3) * (Math.random() < 0.5 ? 1 : -1),
    incl: rnd(-0.5, 0.5), depth: rnd(0.75, 1.0),
  });
  planetGroup.add(mMesh);
}

/* ============================================================
 *  4. 후처리 (은은한 Bloom)
 * ============================================================ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.32,  // strength — 은은하게(행성 표면이 하얗게 번지지 않도록)
  0.50,  // radius
  0.82   // threshold — 태양·별·날카로운 반사만 발광, 밝은 행성 표면은 색·디테일 보존
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

// 자석 버튼: 커서를 향해 미세하게 끌려오며 살짝 떠오름 (마우스 사용·모션 허용 시만)
if (!REDUCE && matchMedia('(pointer: fine)').matches) {
  document.querySelectorAll('.cta .btn').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      const ox = e.clientX - (r.left + r.width / 2);
      const oy = e.clientY - (r.top + r.height / 2);
      b.style.setProperty('--mx', (ox * 0.22).toFixed(1) + 'px');
      b.style.setProperty('--my', (oy * 0.22 - 3).toFixed(1) + 'px'); // -3: 커서 위에서 살짝 떠오름
    });
    b.addEventListener('pointerleave', () => {
      b.style.setProperty('--mx', '0px');
      b.style.setProperty('--my', '0px');
    });
  });
}

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
    if (!dragging) {                                            // 드래그 관성 + 커서를 향한 은은한 기울임
      planetGroup.rotation.y += velY;
      planetGroup.rotation.x = Math.max(-lim, Math.min(lim, planetGroup.rotation.x + velX));
      velY *= 0.94; velX *= 0.94;
      const aimY = mouse.x * 0.26;                              // 커서 쪽으로 살짝 바라봄(±~8°)
      const aimX = restX - mouse.y * 0.12;                      // 커서 상하에 따라 미세 끄덕임
      planetGroup.rotation.y += (aimY - planetGroup.rotation.y) * dt * 0.9;
      planetGroup.rotation.x += (aimX - planetGroup.rotation.x) * dt * 0.9;
    }
    planetGroup.position.y = planetBaseY + Math.sin(et * 0.4) * 7; // 미세한 부유
    if (atmo) { const sc = 1.0 + Math.sin(et * 0.5) * 0.014; atmo.scale.set(sc, sc * oblY, sc); } // 숨쉬는 대기(편평도 유지)
    if (planetFadeIn && planetUniforms.uOpacity.value < 1) planetUniforms.uOpacity.value = Math.min(1, planetUniforms.uOpacity.value + dt * 1.8); // 행성 페이드인
    if (ring) {
      ring.material.uniforms.uTime.value = tt;                  // 고리 궤도 운동
      if (planetFadeIn && ring.material.uniforms.uOpacity.value < 1) ring.material.uniforms.uOpacity.value = Math.min(1, ring.material.uniforms.uOpacity.value + dt * 1.5);
    }
    // 위성 궤도 운동(기울어진 타원) + 페이드인
    for (let mi = 0; mi < moons.length; mi++) {
      const m = moons[mi];
      m.ang += dt * m.speed;
      const mx = Math.cos(m.ang) * m.orad, mz = Math.sin(m.ang) * m.orad;
      m.mesh.position.set(mx, mz * m.incl, mz * m.depth);
      const mu = m.mesh.material.uniforms.uOpacity;
      if (planetFadeIn && mu.value < 1) mu.value = Math.min(1, mu.value + dt * 1.5);
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
    // 커서를 따라 태양 방향 미세 이동 → 명암 경계(터미네이터)가 흐르며 입체감↑
    sunAim.set(sunDir.x + mouse.x * 0.22, sunDir.y - mouse.y * 0.14, sunDir.z).normalize();
    planetUniforms.uSun.value.copy(sunAim);
    if (atmo) atmo.material.uniforms.uLight.value.copy(sunAim);
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
