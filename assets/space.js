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
 *  3. 외계행성 — 셰이더로 직접 생성한 상상의 세계 (접속마다 고유)
 *     형태가 근본적으로 다른 5종: 가스 · 용암 · 얼음 · 바다 · 암석(달)
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
const WORLDS = {
  // 가스행성 — 흐르는 가로 띠 + 대형 폭풍 + (일부) 고리
  gas() {
    const P = [
      { nm:'Aureus',  deep:[.10,.06,.03], mid:[.60,.40,.17], hi:[.98,.86,.58], rim:[1,.80,.46], spot:[.82,.30,.18] },
      { nm:'Veridis', deep:[.02,.09,.09], mid:[.10,.46,.42], hi:[.72,.96,.86], rim:[.40,.95,.85], spot:[.95,.82,.42] },
      { nm:'Amethys', deep:[.09,.04,.14], mid:[.44,.20,.56], hi:[.92,.78,.99], rim:[.76,.54,1], spot:[.42,.72,1] },
      { nm:'Caelum',  deep:[.02,.06,.14], mid:[.16,.40,.70], hi:[.84,.93,1], rim:[.48,.74,1], spot:[.98,.72,.46] },
      { nm:'Ember',   deep:[.12,.03,.03], mid:[.60,.22,.14], hi:[.99,.74,.50], rim:[1,.54,.36], spot:[1,.90,.62] },
    ];
    const p = pick(P);
    return {
      name: p.nm, ring: Math.random() < 0.6, spin: rnd(0.035, 0.065),
      atmo: { col: p.rim, strength: 0.95 }, ringCol: p.rim, ringCol2: p.mid,
      uniforms: {
        uDeep:{value:new THREE.Color(...p.deep)}, uMid:{value:new THREE.Color(...p.mid)},
        uHi:{value:new THREE.Color(...p.hi)}, uSpot:{value:new THREE.Color(...p.spot)},
        uBandFreq:{value:rnd(7,13)}, uTurb:{value:rnd(0.55,1.25)}, uSpotOn:{value:Math.random()<0.7?1:0},
      },
      frag: /* glsl */`
        uniform vec3 uDeep,uMid,uHi,uSpot; uniform float uBandFreq,uTurb,uSpotOn;
        void main(){
          vec3 p=normalize(vObj); vec3 sp=p*1.8+vec3(uSeed); float t=uTime*0.03;
          vec3 w=vec3(fbm(sp+vec3(0.,t,0.)),fbm(sp+vec3(t*0.6,1.3,0.)),fbm(sp+vec3(1.7,0.,t*0.5)));
          float lat=p.y+(w.x-0.5)*uTurb*0.8;
          float bands=0.5+0.5*sin(lat*uBandFreq+(w.y-0.5)*uTurb*3.0);
          float detail=fbm(sp*2.2+w*1.4+vec3(t));
          float v=clamp(bands*0.8+detail*0.4,0.,1.);
          vec3 col=mix(uDeep,uMid,smoothstep(0.12,0.52,v));
          col=mix(col,uHi,smoothstep(0.70,0.98,v));
          if(uSpotOn>0.5){ vec2 sc=vec2(0.6+0.1*sin(uSeed),-0.12);
            vec2 pc=vec2(atan(p.z,p.x),p.y); float d=length((pc-sc)*vec2(0.5,1.7));
            float storm=smoothstep(0.55,0.,d); float swirl=fbm(sp*1.6+storm*2.2);
            col=mix(col,uSpot*(0.7+0.5*swirl),storm*0.9); }
          vec3 N=normalize(vWN); float ndl=dot(N,normalize(uSun));
          float day=smoothstep(-0.18,0.40,ndl);
          float limb=pow(clamp(dot(N,normalize(vVD)),0.,1.),0.5);
          vec3 lit=col*(0.05+day*0.98)*(0.60+0.40*limb); lit+=col*(1.0-day)*0.045;
          gl_FragColor=vec4(lit,uOpacity);
        }`,
    };
  },
  // 용암행성 — 갈라진 현무암 지각 + 자체발광 마그마 (밤에도 빛남)
  lava() {
    const warm = pick([[1,.78,.25],[1,.62,.15],[1,.84,.40]]);
    return {
      name: 'Ignis', ring: Math.random() < 0.1, spin: rnd(0.03, 0.05),
      atmo: { col: [1,.42,.18], strength: 0.8 }, ringCol: [1,.5,.25], ringCol2: [.5,.15,.08],
      uniforms: {
        uCrust:{value:new THREE.Color(.12,.05,.04)}, uMagma1:{value:new THREE.Color(.95,.17,.03)},
        uMagma2:{value:new THREE.Color(...warm)},
      },
      frag: /* glsl */`
        uniform vec3 uCrust,uMagma1,uMagma2;
        void main(){
          vec3 p=normalize(vObj); vec3 sp=p*2.2+vec3(uSeed); float t=uTime*0.05;
          vec2 c=cell(sp*1.7+vec3(0.,t*0.3,0.));
          float crack=smoothstep(0.07,0.0,c.y-c.x);
          float flow=fbm(sp*2.0+vec3(t));
          float heat=clamp(crack*1.2+pow(flow,3.0)*0.5,0.0,1.0);
          heat*=0.75+0.25*sin(uTime*0.8+flow*6.0);
          vec3 crust=mix(uCrust*0.5,uCrust,fbm(sp*3.0));
          vec3 magma=mix(uMagma1,uMagma2,clamp(flow*1.4,0.0,1.0));
          vec3 N=normalize(vWN); float ndl=dot(N,normalize(uSun));
          float day=smoothstep(-0.2,0.5,ndl);
          float limb=pow(clamp(dot(N,normalize(vVD)),0.,1.),0.6);
          vec3 lit=crust*(0.06+day*0.5)*(0.6+0.4*limb);
          lit+=magma*heat*2.2;
          gl_FragColor=vec4(lit,uOpacity);
        }`,
    };
  },
  // 얼음행성 — 갈라진 얼음판 + 극관 + 반짝임
  ice() {
    const tint = pick([[.45,.60,.74],[.50,.56,.72],[.42,.64,.70],[.56,.52,.70],[.40,.66,.68],[.58,.68,.82]]);
    return {
      name: 'Glacio', ring: Math.random() < 0.3, spin: rnd(0.02, 0.045),
      atmo: { col: [.6,.8,1], strength: 0.6 }, ringCol: [.85,.92,1], ringCol2: [.5,.66,.82],
      uniforms: {
        uIceLo:{value:new THREE.Color(...tint)}, uIceHi:{value:new THREE.Color(.92,.97,1)},
        uCrack:{value:new THREE.Color(.18,.32,.52)},
      },
      frag: /* glsl */`
        uniform vec3 uIceLo,uIceHi,uCrack;
        void main(){
          vec3 p=normalize(vObj);
          // 도메인 워프 → 규칙적 격자가 아닌 불규칙한 얼음판·크레바스
          vec3 wq=vec3(fbm(p*2.0+uSeed),fbm(p*2.0+uSeed+5.3),fbm(p*2.0+uSeed+9.1));
          vec3 q=p*2.3+(wq-0.5)*1.2+vec3(uSeed);
          vec2 c=cell(q);
          float crack=smoothstep(0.0,0.06,c.y-c.x);           // 판 경계(큰 균열)
          vec2 c2=cell(q*2.7+3.0);
          float crack2=smoothstep(0.0,0.04,c2.y-c2.x);        // 미세 균열
          // 서리·눈 질감 — 표면이 평평한 색이 아니게
          float frost=fbm(p*7.0+uSeed);
          float snow=fbm(p*15.0-uSeed);
          vec3 ice=mix(uIceLo,uIceHi,clamp(frost*0.75+0.25,0.0,1.0));
          ice+=vec3(0.05,0.06,0.07)*snow;                     // 반짝이는 눈가루
          vec3 col=mix(uCrack*(0.8+0.5*frost),ice,crack);     // 균열은 짙은 청색(깊이감)
          col=mix(col*0.9,col,crack2);
          col=mix(col,vec3(0.97,0.99,1.0),smoothstep(0.55,0.95,abs(p.y))*(0.55+0.45*snow)); // 극관
          vec3 N=normalize(vWN); float ndl=dot(N,normalize(uSun));
          float day=smoothstep(-0.15,0.45,ndl);
          float limb=pow(clamp(dot(N,normalize(vVD)),0.,1.),0.4);
          vec3 H=normalize(normalize(uSun)+normalize(vVD));
          float spec=pow(clamp(dot(N,H),0.0,1.0),70.0)*(0.4+0.6*crack); // 판 위주 반짝임
          vec3 lit=col*(0.10+day*0.95)*(0.65+0.35*limb)+vec3(0.85,0.92,1.0)*spec*day*0.9;
          lit+=col*(1.0-day)*0.05;
          gl_FragColor=vec4(lit,uOpacity);
        }`,
    };
  },
  // 바다행성 — 대륙 + 대양 + 햇빛 반짝임 + 흐르는 구름 + 극관
  ocean() {
    const alien = Math.random() < 0.35;
    const sea = alien ? [.05,.34,.40] : [.06,.30,.50];
    const seaDeep = alien ? [.01,.12,.16] : [.01,.09,.24];
    return {
      name: alien ? 'Thalassa' : 'Oceanus', ring: false, spin: rnd(0.03, 0.05),
      atmo: { col: [.45,.68,1], strength: 1.0 },
      uniforms: {
        uSea:{value:new THREE.Color(...sea)}, uSeaDeep:{value:new THREE.Color(...seaDeep)},
        uLand:{value:new THREE.Color(.16,.26,.10)}, uLand2:{value:new THREE.Color(.42,.36,.20)},
      },
      frag: /* glsl */`
        uniform vec3 uSea,uSeaDeep,uLand,uLand2;
        void main(){
          vec3 p=normalize(vObj); vec3 sp=p*1.6+vec3(uSeed); float t=uTime*0.015;
          float cont=fbm(sp*1.3+fbm(sp*2.0)*0.5);
          float land=smoothstep(0.55,0.62,cont);
          vec3 sea=mix(uSeaDeep,uSea,smoothstep(0.3,0.6,fbm(sp*3.0)));
          vec3 soil=mix(uLand,uLand2,fbm(sp*4.0));
          vec3 col=mix(sea,soil,land);
          col=mix(col,vec3(0.95,0.97,1.0),smoothstep(0.72,0.95,abs(p.y)));
          float cl=smoothstep(0.52,0.78,fbm(sp*2.2+vec3(t*2.0,0.0,t)));
          col=mix(col,vec3(1.0),cl*0.7);
          vec3 N=normalize(vWN); float ndl=dot(N,normalize(uSun));
          float day=smoothstep(-0.12,0.42,ndl);
          float limb=pow(clamp(dot(N,normalize(vVD)),0.,1.),0.5);
          vec3 H=normalize(normalize(uSun)+normalize(vVD));
          float spec=pow(clamp(dot(N,H),0.0,1.0),80.0)*(1.0-land)*(1.0-cl);
          vec3 lit=col*(0.05+day*0.97)*(0.6+0.4*limb)+vec3(1.0,0.96,0.85)*spec*day*1.2;
          lit+=col*(1.0-day)*0.04;
          gl_FragColor=vec4(lit,uOpacity);
        }`,
    };
  },
  // 암석/달 — 크레이터 뒤덮인 대기 없는 황량한 세계 (또렷한 명암 경계)
  barren() {
    const hue = pick([[.14,.13,.12,.52,.50,.47],[.16,.10,.08,.52,.34,.26],[.13,.12,.10,.48,.46,.40]]);
    return {
      name: hue[3] > hue[4] + 0.1 ? 'Ferrum' : 'Petra', ring: false, spin: rnd(0.02, 0.04),
      atmo: null,
      uniforms: {
        uRockLo:{value:new THREE.Color(hue[0],hue[1],hue[2])},
        uRockHi:{value:new THREE.Color(hue[3],hue[4],hue[5])},
      },
      frag: /* glsl */`
        uniform vec3 uRockLo,uRockHi;
        void main(){
          vec3 p=normalize(vObj); vec3 sp=p*2.0+vec3(uSeed);
          vec2 c1=cell(sp*2.2);
          float crat=(1.0-smoothstep(0.0,0.14,c1.x))*0.6;
          float rim1=smoothstep(0.10,0.16,c1.x)-smoothstep(0.16,0.24,c1.x);
          vec2 c2=cell(sp*5.0); float small=(1.0-smoothstep(0.0,0.10,c2.x))*0.3;
          float base=fbm(sp*3.0)*0.4+0.5;
          vec3 col=mix(uRockLo,uRockHi,base);
          col*=1.0-crat*0.5; col+=rim1*0.18; col*=1.0-small*0.4;
          vec3 N=normalize(vWN); float ndl=dot(N,normalize(uSun));
          float day=smoothstep(-0.03,0.10,ndl);
          float limb=pow(clamp(dot(N,normalize(vVD)),0.,1.),0.8);
          vec3 lit=col*(0.03+day*1.0)*(0.8+0.2*limb); lit+=col*(1.0-day)*0.015;
          gl_FragColor=vec4(lit,uOpacity);
        }`,
    };
  },
};
const worldKey = pick(Object.keys(WORLDS));
const world = WORLDS[worldKey]();

// 개체 고유 파라미터
const seed = Math.random() * 10;
const spin = world.spin;              // 자전 속도
const hasRing = world.ring;           // 고리 보유 여부(유형별 확률)
const sizeVar = rnd(0.85, 1.12);      // 개체마다 크기도 조금씩 다르게
const planetName = world.name + '-' + (100 + Math.floor(Math.random() * 899)) + (hasRing ? 'r' : '');

const R = 420;
const planetGroup = new THREE.Group();
// 고리 개체는 고리가 열려 보이도록 자세 고정, 그 외엔 랜덤 자전축
const restX = hasRing ? -0.85 : 0;
planetGroup.rotation.z = hasRing ? 0.30 : (0.24 + Math.random() * 0.28);
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

// ── 표면: 선택된 세계 유형의 전용 셰이더로 구성 ──
const planetUniforms = {
  uTime: { value: 0 }, uSun: { value: sunDir.clone() }, uSeed: { value: seed },
  uOpacity: { value: REDUCE ? 1 : 0 },
  ...world.uniforms,
};
const planet = new THREE.Mesh(
  new THREE.SphereGeometry(R, 160, 160),
  new THREE.ShaderMaterial({
    transparent: true,
    uniforms: planetUniforms,
    vertexShader: VSHADER,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vObj; varying vec3 vWN; varying vec3 vVD;
      uniform float uTime, uSeed, uOpacity; uniform vec3 uSun;
      ${NOISE}
      ${world.frag}
    `,
  })
);
planetGroup.add(planet);
let planetFadeIn = !REDUCE;   // 텍스처 대기 없음 → 즉시 등장(페이드)

// ── 고리: 개체마다 폭·틈(카시니)·밀도·밝기·띠 간격이 다른 절차적 고리 ──
let ring = null;
if (hasRing) {
  const inner = R * rnd(1.24, 1.5);
  const outer = inner + R * rnd(0.55, 1.45);           // 폭이 매번 다름(좁은 링 ↔ 넓은 원반)
  const rg = new THREE.RingGeometry(inner, outer, 240, 1);
  const rp = rg.attributes.position, ruv = rg.attributes.uv, tmp = new THREE.Vector3();
  for (let i = 0; i < rp.count; i++) {
    tmp.fromBufferAttribute(rp, i);
    const ru = (tmp.length() - inner) / (outer - inner);
    const ang = (Math.atan2(tmp.y, tmp.x) + Math.PI) / (Math.PI * 2); // 각도 → 궤도 운동에 사용
    ruv.setXY(i, ru, ang);
  }
  // 1~3개의 틈을 임의 위치·폭으로 (매번 다른 간극 구조)
  const gapN = Math.floor(rnd(1, 3.999));
  const gapPos = [0.5, 0.5, 0.5], gapW = [0.02, 0.02, 0.02];
  for (let i = 0; i < gapN; i++) { gapPos[i] = rnd(0.12, 0.88); gapW[i] = rnd(0.015, 0.05); }
  ring = new THREE.Mesh(rg, new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    uniforms: {
      uOpacity: { value: REDUCE ? 1 : 0 }, uSeed: { value: seed }, uTime: { value: 0 },
      uCol: { value: new THREE.Color(...world.ringCol) }, uDeep: { value: new THREE.Color(...world.ringCol2) },
      uBandF: { value: rnd(70, 190) }, uDens: { value: rnd(0.65, 1.0) }, uBright: { value: rnd(0.8, 1.15) },
      uSpin: { value: rnd(0.12, 0.26) * (Math.random() < 0.5 ? 1 : -1) },
      uGapPos: { value: gapPos }, uGapW: { value: gapW }, uGapN: { value: gapN },
    },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv;
      uniform float uOpacity, uSeed, uBandF, uDens, uBright, uTime, uSpin;
      uniform vec3 uCol, uDeep; uniform float uGapPos[3]; uniform float uGapW[3]; uniform int uGapN;
      float hash(float n){ return fract(sin(n) * 43758.5453); }
      float bn(float x){ float i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f); return mix(hash(i),hash(i+1.0),f); }
      void main(){
        float u = vUv.x;                                   // 0 내측 … 1 외측
        float ang = vUv.y * 6.28318;                       // 둘레 각도
        float bands = 0.5 + 0.5 * sin(u * uBandF + uSeed); // 촘촘한 띠(간격 랜덤)
        float fine = bn(u * 55.0 + uSeed) * 0.6 + bn(u * 190.0) * 0.4;
        // 궤도 운동: 안쪽이 더 빠른 케플러 전단 — 농담 덩어리가 둘레를 따라 흐름
        float spd = uSpin / (0.42 + u * 0.85);
        float orbit = ang + uTime * spd;
        float clump = 0.70 + 0.30 * sin(orbit * (5.0 + floor(uBandF * 0.06)) + fine * 6.2831);
        float gap = 1.0;                                   // 여러 틈을 곱해 합성
        for (int i = 0; i < 3; i++) {
          if (i < uGapN) gap *= smoothstep(uGapW[i], uGapW[i] + 0.012, abs(u - uGapPos[i]));
        }
        float dens = clamp(bands * 0.32 + fine * 0.85, 0.0, 1.0) * gap * uDens * clump;
        dens *= smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.88, u); // 안팎 페이드
        vec3 col = mix(uDeep * 1.3, uCol, fine) * uBright;
        gl_FragColor = vec4(col, dens * 0.92 * uOpacity);
      }
    `,
  }));
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
    if (atmo) atmo.scale.setScalar(1.0 + Math.sin(et * 0.5) * 0.014); // 숨쉬는 대기 글로우
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
