// 스크롤로 다가가기·물러나기: 임계 감쇠 스프링 하나가 크기·별의 흐름·문구를 함께 움직여 카메라가 이동하는 것처럼 보이게 한다
import { MathUtils } from 'three';

const ZOOM_MIN = Math.log(0.4);
const ZOOM_OMEGA = 5.5;       // 스프링 고유 진동수 — 약 1.2초에 멈춘다
const ZOOM_EDGE = 0.1;        // 한계를 넘겨 밀면 살짝 더 들어갔다 돌아오는 폭(로그)
const ZOOM_SETTLE_MS = 160;   // 입력이 끊긴 뒤 한계 안으로 돌아오기까지
const KEY_STEP = 0.2;

export function createZoom({ max, reduced, isInteractive, canScrollPage, onInput, onPinchStart }) {
  // x = log(배율), v = 로그 속도, want = 입력이 민 목표, max = 다가갈 수 있는 한계(로그)
  const zoom = { x: 0, v: 0, want: 0, now: 1, max, to, step };
  let settleTimer;

  const softLimit = (w) => (w > zoom.max ? zoom.max + ZOOM_EDGE * (1 - Math.exp((zoom.max - w) / ZOOM_EDGE))
    : w < ZOOM_MIN ? ZOOM_MIN - ZOOM_EDGE * (1 - Math.exp((w - ZOOM_MIN) / ZOOM_EDGE)) : w);

  function to(logValue) {
    zoom.want = logValue;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { zoom.want = MathUtils.clamp(zoom.want, ZOOM_MIN, zoom.max); }, ZOOM_SETTLE_MS);
    onInput();
  }
  function step(dt) {
    const target = softLimit(zoom.want);
    if (reduced) { zoom.x = target; zoom.v = 0; } else {
      const d = zoom.x - target, c = zoom.v + ZOOM_OMEGA * d, e = Math.exp(-ZOOM_OMEGA * dt); // 해석해 — 프레임 간격이 달라도 궤적이 같다
      zoom.x = target + (d + c * dt) * e;
      zoom.v = (zoom.v - ZOOM_OMEGA * c * dt) * e;
    }
    zoom.now = Math.exp(zoom.x);
  }

  window.addEventListener('wheel', (e) => {
    if (isInteractive(e.target)) return;
    if (e.ctrlKey) e.preventDefault();                       // 트랙패드 핀치는 ctrl+휠로 들어온다
    else if (canScrollPage()) return;
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1);  // 마우스 휠·트랙패드를 같은 단위로
    to(zoom.want - MathUtils.clamp(px, -160, 160) * (e.ctrlKey ? 0.01 : 0.0011));
  }, { passive: false });
  window.addEventListener('dblclick', (e) => { if (!isInteractive(e.target)) to(0); });
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') to(zoom.want + KEY_STEP);
    else if (e.key === '-') to(zoom.want - KEY_STEP);
    else if (e.key === '0') to(0);
  });

  // 터치 핀치
  const touches = new Map();
  let pinchFrom = 0, pinchBase = 1;
  const fingerGap = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { onPinchStart(); pinchFrom = fingerGap(); pinchBase = zoom.want; }
  });
  window.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && pinchFrom) to(pinchBase + Math.log(fingerGap() / pinchFrom));
  });
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, (e) => touches.delete(e.pointerId));

  return zoom;
}
