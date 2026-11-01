// 히어로 UI: WebGL 폴백 · 연도 · 문구 순환 (우주 씬과 독립 — WebGL이 실패해도 동작)
import { drawFromBag } from 'app/bag.js';
import { QUOTES } from 'app/quotes.js';

const QUOTE_INTERVAL_MS = 6500;
const QUOTE_FADE_MS = 620;        // space.css 의 #headline 전환 시간과 맞춘다

if (!window.WebGLRenderingContext) document.body.classList.add('no-webgl');

document.getElementById('year').textContent = new Date().getFullYear();

const headline = document.getElementById('headline');
const glow = headline.querySelector('.glow');
const who = headline.querySelector('.who');

function showNextQuote() {
  const quote = drawFromBag('quotes', QUOTES, item => item.q);
  glow.innerHTML = quote.q;
  who.textContent = quote.who;
}
showNextQuote();
requestAnimationFrame(() => headline.classList.add('show'));

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  setInterval(() => {
    // 안 보는 탭에선 문구를 소모하지 않고, 읽는 중(커서가 위에 있을 때)엔 멈춘다
    if (document.hidden || headline.matches(':hover')) return;
    headline.classList.remove('show');
    setTimeout(() => {
      showNextQuote();
      headline.classList.add('show');
    }, QUOTE_FADE_MS);
  }, QUOTE_INTERVAL_MS);
}
