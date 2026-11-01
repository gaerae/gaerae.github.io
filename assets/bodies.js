// 천체 카탈로그와 선택 — 텍스처 경로·조명 값은 space.js 가 사용
import { drawFromBag } from 'app/bag.js';

/* 행성: Solar System Scope (CC BY 4.0) / 위성·왜소행성: NASA·USGS (public domain).
   실제 편평도(obl)·자전축 기울기(천왕성 98°)·고리·위성까지 실측값으로 반영.
   고리 반지름은 행성 적도 반지름 대비 실측값. 폭이 수 km뿐인 좁은 고리는 보이도록 넓혔다.
   위성은 전구 실측 지도가 있는 것만 싣는다(카론·트리톤·천왕성 위성은 미관측 영역이 커서 제외).
   위성 궤도 반지름은 화면에 들어오게 압축하되 순서는 지키고, 공전 속도는 실제 주기에 반비례한다.
   미관측 극지(이오·유로파·가니메데·칼리스토, 명왕성 남반구)는 같은 천체의 실지형을 구면 회전으로 옮겨 채운 합성이다. */
export const BODIES = [
  // obl = 편평도(적도 팽창), sideways = 천왕성의 누운 자전축, tilt = 화면상 기울기(rad, 없으면 무작위)
  // ring.tex = 실측 고리 텍스처, ring.bands = [안쪽, 바깥, 밝기, 경계 폭], ring.arcs.at = [경도°, 폭°]
  // moons: r = 행성 대비 크기, orbit = 궤도 반지름(화면용), speed = 공전(rad/s), incl = 궤도 경사(rad), tint = 대기 색
  { nm:'Jupiter', tex:'2k_jupiter.jpg',          spin:0.045, obl:0.06,  tilt:-0.2, atmo:{col:[.96,.82,.64],s:0.75}, // 궤도면이 태양을 향해 위성 그림자가 표면을 지나간다
      ring:{ inner:1.29, outer:2.56, col:[.54,.44,.36], op:0.11, bands:[
        [1.29, 1.71, .22, .25],                                                  // 헤일로
        [1.71, 1.806, 1],                                                        // 주 고리
        [1.806, 2.54, .07, .40],                                                 // 거미줄 고리
      ] },
      moons:[                                                                    // 갈릴레이 위성(실제 크기비의 1.5배, 공전비 1:2:4 공명)
        { tex:'sm_io.jpg',       r:.038, orbit:1.75, speed:.300 },
        { tex:'sm_europa.jpg',   r:.033, orbit:2.10, speed:.150 },
        { tex:'sm_ganymede.jpg', r:.055, orbit:2.50, speed:.074 },
        { tex:'sm_callisto.jpg', r:.051, orbit:3.00, speed:.032 },
      ] },
  { nm:'Saturn',  tex:'2k_saturn.jpg',           spin:0.042, obl:0.09,  atmo:{col:[.98,.90,.70],s:0.50},
      ring:{ tex:'2k_saturn_ring_alpha.png', inner:1.17, outer:2.34 },            // 실측 고리(C·B·카시니 간극·A)
      moons:[{ tex:'sm_titan.jpg', r:.064, orbit:2.85, speed:.090, tint:[.92,.60,.28] }] }, // 타이탄 — 스모그로 표면이 가려진 주황색 원반
  { nm:'Uranus',  tex:'2k_uranus.jpg',           spin:0.038, obl:0.02,  sideways:true, atmo:{col:[.62,.92,.96],s:0.60},
      ring:{ inner:1.60, outer:2.03, col:[.60,.66,.70], op:0.30, bands:[           // 세로로 선 좁은 고리(98° 기울기)
        [1.633, 1.641, .30], [1.648, 1.656, .28], [1.662, 1.670, .30],            // 6·5·4
        [1.745, 1.755, .38], [1.782, 1.792, .40],                                 // α·β
        [1.843, 1.850, .26], [1.860, 1.868, .42], [1.885, 1.895, .48],            // η·γ·δ
        [1.954, 1.960, .24], [1.990, 2.012, 1],                                   // λ·ε(가장 밝고 넓음)
      ] } },
  { nm:'Neptune', tex:'2k_neptune.jpg',          spin:0.040, obl:0.017, atmo:{col:[.42,.58,1],s:0.72},
      ring:{ inner:1.62, outer:2.58, col:[.50,.47,.50], op:0.22, bands:[
        [1.65, 1.73, .20],                                                        // 갈레
        [2.143, 2.153, .70], [2.153, 2.30, .08], [2.305, 2.315, .35],             // 르베리에·라셀·아라고
        [2.535, 2.547, .75],                                                      // 애덤스
      ], arcs:{ band:[2.531, 2.551, 1],                                           // 애덤스 고리의 아크 — 40° 안에 몰려 있다
        at:[[0, 1], [12, 4], [24, 4], [36, 9.6]] } } },                           // 쿠라주·리베르테·에갈리테·프라테르니테
  { nm:'Mars',    tex:'2k_mars.jpg',             spin:0.030, atmo:{col:[1,.58,.40],s:0.22} },
  { nm:'Venus',   tex:'2k_venus_atmosphere.jpg', spin:0.024, atmo:{col:[1,.86,.55],s:0.65} },
  { nm:'Earth',   tex:'2k_earth_daymap.jpg',     spin:0.035, atmo:{col:[.46,.70,1],s:0.95},
      night:'2k_earth_nightmap.jpg', clouds:'2k_earth_clouds.jpg', spec:'2k_earth_specular.jpg', // 야간 도시광·구름·해양 반사
      moons:[{ tex:'sm_moon.jpg', r:.273, orbit:2.70, speed:.050, incl:.09 }] },  // 달 — 크기는 실제 비율
  { nm:'Mercury', tex:'2k_mercury.jpg',          spin:0.020, atmo:null },
  { nm:'Luna',    tex:'2k_moon.jpg',             spin:0.018, atmo:null },
  { nm:'Io',       tex:'2k_io.jpg',              spin:0.022, atmo:null },                       // 목성 위성 — 화산·유황
  { nm:'Europa',   tex:'2k_europa.jpg',          spin:0.020, atmo:{col:[.72,.84,.96],s:0.16} }, // 목성 위성 — 얼음(균열선)
  { nm:'Ganymede', tex:'2k_ganymede.jpg',        spin:0.019, atmo:null },                       // 목성 위성 — 최대 위성, 명암 지형
  { nm:'Callisto', tex:'2k_callisto.jpg',        spin:0.017, atmo:null, lum:1.25 },              // 목성 위성 — 크레이터 뒤덮인 암흑 표면(저반사 보정)
  { nm:'Titan',   tex:'2k_titan.jpg',            spin:0.020, haze:[1,.60,.26], atmo:{col:[1,.66,.30],s:0.92} }, // 토성 위성 — 짙은 오렌지 스모그
  { nm:'Pluto',   tex:'2k_pluto.jpg',            spin:0.016, face:-1.45, atmo:{col:[.56,.70,.95],s:0.24} }, // 왜소행성 — 옅은 블루 헤이즈, 하트(톰보 지역)가 보이게 시작
];

// ?p=<이름>으로 특정 천체 고정(선택 UI에서 사용), 없으면 셔플 백 순서
export function chooseBody() {
  const params = new URLSearchParams(location.search);
  const forcedName = (params.get('p') || '').toLowerCase();
  const forced = BODIES.find(b => b.nm.toLowerCase() === forcedName);
  const body = drawFromBag('bodies', BODIES, b => b.nm, forced);
  // 선택은 이번 로드에만 적용 — 주소에 남기면 새로고침해도 같은 천체만 나온다
  if (params.has('p')) {
    params.delete('p');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  }
  return body;
}
