// 천체 카탈로그와 선택 — 텍스처 경로·조명 값은 space.js 가 사용
import { drawFromBag } from 'app/bag.js';

/* 행성·달: Solar System Scope (CC BY 4.0) / 나머지 위성·왜소행성: NASA·USGS (public domain).
   태양: NASA SDO AIA 304Å 실제 관측 영상. 사람 눈의 색이 아니라 자외선 영상에 입힌 색이다.
   우주선: NASA 공개 3D 모델(glTF).
   실제 편평도(obl)·자전축 기울기(천왕성 98°)·고리·위성까지 실측값으로 반영.
   고리 반지름은 행성 적도 반지름 대비 실측값. 폭이 수 km뿐인 좁은 고리는 보이도록 넓혔다.
   위성은 전구 실측 지도가 있는 것만 싣는다(카론·트리톤·천왕성 위성은 미관측 영역이 커서 제외).
   위성 궤도 반지름은 화면에 들어오게 압축하되 순서는 지키고, 한 행성의 위성끼리는 공전 속도가 실제 주기에 반비례한다.
   원본 지도에 빈 극지(이오·유로파·가니메데·칼리스토, 명왕성 남반구)는 같은 천체의 실지형을 구면 회전으로 옮겨 채운 합성이다. */

// 메뉴에 나오는 순서이자 분류. 태양계 안쪽에서 바깥쪽 순으로 둔다
export const KINDS = [
  { id:'star',   ko:'항성' },
  { id:'planet', ko:'행성' },
  { id:'dwarf',  ko:'왜소행성' },
  { id:'moon',   ko:'위성' },
  { id:'craft',  ko:'우주선' },
];

export const BODIES = [
  // nm = 정식 영문명(IAU·NASA), short = 라벨에 쓰는 약칭, ko = 한국어 이름, kind = KINDS.id, of = 모행성(위성만)
  // km = 평균 반지름(JPL, 태양은 IAU 공칭값, 우주선은 최대 길이의 절반 — 거리 표시용), credit = 이 천체가 보일 때 덧붙이는 출처
  // obl = 편평도(적도 팽창), sideways = 천왕성의 누운 자전축, tilt = 화면상 기울기(rad, 없으면 무작위)
  // hero = 히어로 화면에서의 크기 배율(고리가 문구·라벨을 덮지 않게)
  // ring.tex = 실측 고리 텍스처, ring.bands = [안쪽, 바깥, 밝기, 경계 폭], ring.arcs.at = [경도°, 폭°]
  // moons: r = 행성 대비 크기, orbit = 궤도 반지름(화면용), speed = 공전(rad/s), incl = 궤도 경사(rad), tint = 대기 색
  { nm:'Sun', ko:'태양', kind:'star', km:695700, tex:'sdo_sun_304.webp', spin:0, tilt:0, atmo:null, disc:0.431, // disc = 사진 속 원반 반지름 ÷ 이미지 폭
      credit:'Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams' },
  { nm:'Mercury', ko:'수성', kind:'planet', km:2439, tex:'2k_mercury.webp', spin:0.020, atmo:null },
  { nm:'Venus', ko:'금성', kind:'planet', km:6052, tex:'2k_venus_atmosphere.webp', spin:0.024, atmo:{col:[1,.86,.55],s:0.65} },
  { nm:'Earth', ko:'지구', kind:'planet', km:6371, tex:'2k_earth_daymap.webp', spin:0.035, atmo:{col:[.46,.70,1],s:0.95},
      night:'2k_earth_nightmap.webp', clouds:'2k_earth_clouds.webp', spec:'2k_earth_specular.webp', // 야간 도시광·구름·해양 반사
      moons:[{ tex:'sm_moon.webp', r:.273, orbit:2.70, speed:.050, incl:.09 }] },  // 달 — 크기는 실제 비율
  { nm:'Mars', ko:'화성', kind:'planet', km:3390, tex:'2k_mars.webp', spin:0.030, atmo:{col:[1,.58,.40],s:0.22} },
  { nm:'Jupiter', ko:'목성', kind:'planet', km:69911, tex:'2k_jupiter.webp', spin:0.045, obl:0.065, tilt:-0.2, atmo:{col:[.96,.82,.64],s:0.75}, // 궤도면이 태양을 향해 위성 그림자가 표면을 지나간다
      ring:{ inner:1.25, outer:3.12, col:[.54,.44,.36], op:0.11, bands:[
        [1.25, 1.71, .22, .25],                                                  // 헤일로
        [1.71, 1.806, 1],                                                        // 주 고리
        [1.806, 2.54, .07, .40],                                                 // 아말테아 거미줄 고리
        [2.54, 3.10, .035, .40],                                                 // 테베 거미줄 고리
      ] },
      moons:[                                                                    // 갈릴레이 위성(실제 크기비의 1.5배, 공전비 1:2:4 공명)
        { tex:'sm_io.webp',       r:.038, orbit:1.75, speed:.300 },
        { tex:'sm_europa.webp',   r:.033, orbit:2.10, speed:.150 },
        { tex:'sm_ganymede.webp', r:.055, orbit:2.50, speed:.074 },
        { tex:'sm_callisto.webp', r:.051, orbit:3.00, speed:.032 },
      ] },
  { nm:'Saturn', ko:'토성', kind:'planet', km:58232, tex:'2k_saturn.webp', spin:0.042, obl:0.098, hero:0.72, atmo:{col:[.98,.90,.70],s:0.50},
      ring:{ tex:'2k_saturn_ring_alpha.png', inner:1.17, outer:2.34 },            // 실측 고리(C·B·카시니 간극·A)
      moons:[{ tex:'sm_titan.webp', r:.064, orbit:2.85, speed:.090, tint:[.92,.60,.28] }] }, // 타이탄(실제 크기비의 1.5배) — 스모그로 표면이 가려진 주황색 원반
  { nm:'Uranus', ko:'천왕성', kind:'planet', km:25362, tex:'2k_uranus.webp', spin:0.038, obl:0.023, sideways:true, atmo:{col:[.62,.92,.96],s:0.60},
      ring:{ inner:1.60, outer:2.03, col:[.60,.66,.70], op:0.30, bands:[           // 세로로 선 좁은 고리(98° 기울기)
        [1.633, 1.641, .30], [1.648, 1.656, .28], [1.662, 1.670, .30],            // 6·5·4
        [1.745, 1.755, .38], [1.782, 1.792, .40],                                 // α·β
        [1.843, 1.850, .26], [1.860, 1.868, .42], [1.885, 1.895, .48],            // η·γ·δ
        [1.954, 1.960, .24], [1.990, 2.012, 1],                                   // λ·ε(가장 밝고 넓음)
      ] } },
  { nm:'Neptune', ko:'해왕성', kind:'planet', km:24622, tex:'2k_neptune.webp', spin:0.040, obl:0.017, atmo:{col:[.42,.58,1],s:0.72},
      ring:{ inner:1.62, outer:2.58, col:[.50,.47,.50], op:0.22, bands:[
        [1.65, 1.73, .20],                                                        // 갈레
        [2.143, 2.153, .70], [2.153, 2.30, .08], [2.305, 2.315, .35],             // 르베리에·라셀·아라고
        [2.535, 2.547, .75],                                                      // 애덤스
      ], arcs:{ band:[2.531, 2.551, 1],                                           // 애덤스 고리의 아크 — 공전 방향으로 앞선 순서, 보이저 관측 배치
        at:[[0, 9.6], [10.7, 2], [13.7, 2], [25.7, 4], [33, 1]] } } },            // 프라테르니테·에갈리테 2·1·리베르테·쿠라주(뒤의 둘은 2009년경 거의 소멸)
  { nm:'Pluto', ko:'명왕성', kind:'dwarf', km:1188, tex:'2k_pluto.webp', spin:0.016, face:-1.45, atmo:{col:[.56,.70,.95],s:0.24} }, // 옅은 블루 헤이즈, 하트(톰보 지역)가 보이게 시작
  { nm:'Moon', ko:'달', kind:'moon', of:'지구', km:1737, tex:'2k_moon.webp', spin:0.018, atmo:null },       // IAU·USGS 정식 명칭(Luna는 라틴어 이름)
  { nm:'Io', ko:'이오', kind:'moon', of:'목성', km:1821, tex:'2k_io.webp', spin:0.022, atmo:null },         // 화산·유황
  { nm:'Europa', ko:'유로파', kind:'moon', of:'목성', km:1561, tex:'2k_europa.webp', spin:0.020, atmo:{col:[.72,.84,.96],s:0.16} }, // 얼음(균열선)
  { nm:'Ganymede', ko:'가니메데', kind:'moon', of:'목성', km:2631, tex:'2k_ganymede.webp', spin:0.019, atmo:null }, // 최대 위성, 명암 지형
  { nm:'Callisto', ko:'칼리스토', kind:'moon', of:'목성', km:2410, tex:'2k_callisto.webp', spin:0.017, atmo:null, lum:1.25 }, // 크레이터 뒤덮인 암흑 표면(저반사 보정)
  { nm:'Titan', ko:'타이탄', kind:'moon', of:'토성', km:2575, tex:'2k_titan.webp', spin:0.020, haze:[1,.60,.26], atmo:{col:[1,.66,.30],s:0.92} }, // 짙은 오렌지 스모그
  // craft = 모델 파일, size = 행성 반지름 대비 크기, pose = 시작 자세(rad), sun = 조명 세기(기본 4)
  { nm:'International Space Station', short:'ISS', ko:'국제우주정거장', kind:'craft', km:.0545, craft:'iss.glb', size:1.25, pose:[.25,.1,0], spin:0, atmo:null, credit:'3D 모델 NASA' },
  { nm:'Hubble Space Telescope', short:'Hubble', ko:'허블 우주망원경', kind:'craft', km:.0066, craft:'hubble.glb', size:1.0, sun:2.2, pose:[-.3,.7,.2], spin:0, atmo:null, credit:'3D 모델 NASA' },
  { nm:'Voyager 1', ko:'보이저 1호', kind:'craft', km:.008, craft:'voyager.glb', size:1.15, pose:[-.3,1.6,.1], spin:0, atmo:null, credit:'3D 모델 NASA' }, // 자력계 붐 포함 전체 약 16m, 보이저 2호도 같은 설계
];

// 천체가 정해진 페이지(404) — 셔플 백을 소모하지 않고, 실패해도 새로고침으로 넘어갈 다음 천체가 없다
export const FIXED_WORLD = document.documentElement.dataset.world;

// ?p=<이름>으로 특정 천체 고정(선택 UI에서 사용), 없으면 셔플 백 순서
export function chooseBody() {
  if (FIXED_WORLD) return BODIES.find(b => b.nm === FIXED_WORLD);
  const params = new URLSearchParams(location.search);
  const forcedName = (params.get('p') || '').toLowerCase();
  const forced = BODIES.find(b => b.nm.toLowerCase() === forcedName || b.short?.toLowerCase() === forcedName);
  const body = drawFromBag('bodies', BODIES, b => b.nm, forced);
  // 선택은 이번 로드에만 적용 — 주소에 남기면 새로고침해도 같은 천체만 나온다
  if (params.has('p')) {
    params.delete('p');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  }
  return body;
}
