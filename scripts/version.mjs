#!/usr/bin/env node
// 자산 캐시 버스팅: space.css / space.js 의 콘텐츠 해시를 index.html 의 ?v= 에 반영.
// 파일 내용이 바뀌면 URL이 바뀌어 CDN(4h) 캐시를 우회 → 배포 즉시 반영.
// 안 바뀌면 해시 동일 → 기존 캐시 유지(최적). 커밋마다 pre-commit 훅으로 자동 실행.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
let changed = false;

for (const asset of ['assets/space.css', 'assets/space.js']) {
  const hash = createHash('sha256').update(readFileSync(join(root, asset))).digest('hex').slice(0, 10);
  const re = new RegExp(asset.replace(/\./g, '\\.') + '(?:\\?v=[0-9a-f]+)?', 'g');
  const next = html.replace(re, `${asset}?v=${hash}`);
  if (next !== html) { html = next; changed = true; }
  console.log(`${asset} -> ?v=${hash}`);
}

if (changed) { writeFileSync(htmlPath, html); console.log('index.html updated'); }
else console.log('index.html already up to date');
