// 현재 천체 라벨 겸 선택 메뉴(우상단)
const LABEL_SHOW_MS = 700;
const LABEL_DIM_MS = 5400;
const MENU_HIDE_MS = 260;         // space.css 의 #planet-menu 전환 시간과 맞춘다
const TOGGLE_GUARD_MS = 350;      // 중복 이벤트(터치+마우스 등)로 토글이 2번 되는 것 방지

export function initPlanetPicker(bodies, current) {
  const label = document.getElementById('planet-label');
  const menu = document.getElementById('planet-menu');

  label.textContent = `◦  ${current.nm}`;
  label.setAttribute('aria-label', `현재 천체 ${current.nm}, 다른 천체 선택`);
  setTimeout(() => label.classList.add('show'), LABEL_SHOW_MS);
  // 소개 후 완전히 사라지지 않고 희미하게 남아 선택기를 발견할 수 있게
  setTimeout(() => label.classList.add('dim'), LABEL_DIM_MS);

  let hideTimer;
  const openMenu = () => {
    clearTimeout(hideTimer);
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('open'));
    label.setAttribute('aria-expanded', 'true');
    label.classList.remove('dim');
  };
  const closeMenu = () => {
    menu.classList.remove('open');
    label.setAttribute('aria-expanded', 'false');
    hideTimer = setTimeout(() => { menu.hidden = true; }, MENU_HIDE_MS);
  };

  // 전체 천체 목록 구성 — 진짜 링크(?p=<이름>)라 키보드·새 탭 열기가 그대로 동작
  for (const body of bodies) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    const url = new URL(location.href);
    url.searchParams.set('p', body.nm);
    a.href = url.href;
    a.textContent = body.nm;
    if (body === current) {
      a.setAttribute('aria-current', 'true');
      a.addEventListener('click', (e) => { e.preventDefault(); closeMenu(); });
    }
    li.appendChild(a);
    menu.appendChild(li);
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
}
