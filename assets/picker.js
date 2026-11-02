// 현재 천체 라벨 겸 선택 메뉴(우상단)
import { BODIES, KINDS } from 'app/bodies.js';

const LABEL_SHOW_MS = 700;
const LABEL_DIM_MS = 5400;
const MENU_HIDE_MS = 260;         // space.css 의 #planet-menu 전환 시간과 맞춘다
const TOGGLE_GUARD_MS = 350;      // 중복 이벤트(터치+마우스 등)로 토글이 2번 되는 것 방지

export function initPlanetPicker(current) {
  const nav = document.getElementById('planet-nav');
  const label = document.getElementById('planet-label');
  const meta = document.getElementById('planet-meta');
  const toggle = document.getElementById('focus-toggle');
  const menu = document.getElementById('planet-menu');
  const kindName = current.of ? `${current.of}의 위성` : KINDS.find(k => k.id === current.kind).ko;

  label.textContent = `◦  ${current.short || current.nm}`;
  label.setAttribute('aria-label', `현재 ${current.ko}, ${kindName}, 다른 대상 선택`);
  meta.textContent = `${current.ko} · ${kindName}`;
  if (current.credit) document.getElementById('credit-body').textContent = ` · ${current.credit}`;
  setTimeout(() => { for (const el of [label, meta, toggle]) el.classList.add('show'); }, LABEL_SHOW_MS);
  // 소개 후 완전히 사라지지 않고 희미하게 남아 선택기를 발견할 수 있게
  setTimeout(() => { label.classList.add('dim'); meta.classList.add('dim'); }, LABEL_DIM_MS);

  let hideTimer;
  const openMenu = () => {
    clearTimeout(hideTimer);
    menu.hidden = false;
    menu.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' }); // 좁은 화면에선 목록이 길어 현재 천체가 아래에 있을 수 있다
    requestAnimationFrame(() => menu.classList.add('open'));
    label.setAttribute('aria-expanded', 'true');
    label.classList.remove('dim');
  };
  const closeMenu = () => {
    menu.classList.remove('open');
    label.setAttribute('aria-expanded', 'false');
    hideTimer = setTimeout(() => { menu.hidden = true; }, MENU_HIDE_MS);
  };

  // 분류별 천체 목록 구성 — 진짜 링크(?p=<이름>)라 키보드·새 탭 열기가 그대로 동작
  const span = (className, text) => Object.assign(document.createElement('span'), { className, textContent: text });
  for (const kind of KINDS) {
    const group = document.createElement('li');
    const heading = span('menu-kind', kind.ko);
    heading.id = `menu-kind-${kind.id}`;
    const list = document.createElement('ul');
    list.setAttribute('aria-labelledby', heading.id);
    for (const body of BODIES.filter(b => b.kind === kind.id)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      const url = new URL(document.baseURI);                    // 404에서는 홈으로 나간다
      url.searchParams.set('p', body.nm);
      a.href = url.href;
      a.append(span('menu-nm', body.nm), span('menu-ko', body.ko));
      if (body === current) {
        a.setAttribute('aria-current', 'true');
        a.addEventListener('click', (e) => { e.preventDefault(); closeMenu(); });
      }
      li.appendChild(a);
      list.appendChild(li);
    }
    group.append(heading, list);
    menu.appendChild(group);
  }

  let lastToggle = 0;
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastToggle < TOGGLE_GUARD_MS) return;
    lastToggle = now;
    if (label.getAttribute('aria-expanded') === 'true') closeMenu();
    else openMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#planet-nav')) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { closeMenu(); label.focus(); }
  });
  // 키보드로 메뉴를 벗어나면 닫는다 — 창 전환처럼 옮겨 갈 곳이 없을 때는 그대로 둔다
  nav.addEventListener('focusout', (e) => {
    if (!menu.hidden && e.relatedTarget && !nav.contains(e.relatedTarget)) closeMenu();
  });
}
