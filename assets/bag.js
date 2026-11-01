// 셔플 백: 전부 한 번씩 나오기 전엔 반복하지 않는다. 진행 상황은 재방문에도 이어진다.
// id 를 저장하므로 항목을 추가·삭제해도 진행 상황이 유지된다.
// 저장이 막힌 환경에선 메모리로 동작(페이지 안에서만 유지).
const memory = {};

function loadSeen(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved)) return saved;
  } catch {}
  return memory[key] || [];
}

export function drawFromBag(name, items, idOf, forced) {
  const key = `gaerae.bag.${name}`;
  const ids = items.map(idOf);
  let seen = loadSeen(key).filter(id => ids.includes(id));
  let left = ids.filter(id => !seen.includes(id));
  if (!left.length) {                // 한 바퀴 완료 — 바뀌는 지점에서 같은 항목이 연달아 나오지 않게 직전 것만 뺀다
    const last = seen[seen.length - 1];
    seen = [];
    left = ids.filter(id => id !== last);
  }
  const id = forced ? idOf(forced) : left[Math.floor(Math.random() * left.length)];
  seen = [...seen.filter(s => s !== id), id];
  memory[key] = seen;
  try { localStorage.setItem(key, JSON.stringify(seen)); } catch {}
  return items[ids.indexOf(id)];
}
