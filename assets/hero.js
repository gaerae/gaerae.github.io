// 히어로 UI: WebGL 폴백 · 연도 · 문구 순환 (우주 씬과 독립 — WebGL이 실패해도 동작)
import { drawFromBag } from 'app/bag.js';
import { QUOTES } from 'app/quotes.js';

const QUOTE_INTERVAL_MS = 6500;
const QUOTE_FADE_MS = 460;        // space.css 의 #headline 전환 시간과 맞춘다

const root = document.documentElement;
if (!window.WebGLRenderingContext) document.body.classList.add('no-webgl');

// 우주 씬이 뜨지 못하면(WebGL 미지원·CDN 장애) 글만 남긴다 — 저장된 집중 모드가 글을 가리지 않게
addEventListener('load', () => {
  if (document.getElementById('planet-label').textContent) return;
  root.classList.remove('focus');
  document.body.classList.add('no-webgl');
});

document.getElementById('year').textContent = new Date().getFullYear();

const hero = document.querySelector('.hero');
const headline = document.getElementById('headline');
const text = headline.querySelector('.quote-text');
const who = headline.querySelector('.who');

function showNextQuote() {
  const quote = drawFromBag('quotes', QUOTES, item => item.q);
  text.innerHTML = quote.q;
  who.textContent = quote.who;
}

// 문구가 페이지에 고정된 경우(404)는 그대로 둔다
if (!headline.hasAttribute('data-fixed')) {
  showNextQuote();
  requestAnimationFrame(() => headline.classList.add('show'));

  // 스크린리더가 읽는 도중 문구가 바뀌지 않게, 보조기술에는 첫 문구 하나만 준다
  document.getElementById('quote-sr').innerHTML = `${text.innerHTML.replaceAll('<br>', ' ')} — ${who.innerHTML}`;
  headline.setAttribute('aria-hidden', 'true');

  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(() => {
      // 안 보는 탭·문구가 걷힌 화면에선 소모하지 않고, 읽거나 조작하는 중에는 멈춘다
      if (document.hidden || root.matches('.focus, .zoomed') || headline.matches(':hover') || hero.matches(':focus-within')) return;
      headline.classList.remove('show');
      setTimeout(() => {
        showNextQuote();
        headline.classList.add('show');
      }, QUOTE_FADE_MS);
    }, QUOTE_INTERVAL_MS);
  }
}
