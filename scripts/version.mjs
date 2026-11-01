#!/usr/bin/env node
// 자산 캐시 버스팅: space.css / space.js 의 콘텐츠 해시를 index.html 의 ?v= 에,
// assets/textures 전체의 해시를 space.js 의 TEX_VER 에 반영(텍스처 → space.js → index.html 순).
// 파일 내용이 바뀌면 URL이 바뀌어 CDN(4h) 캐시를 우회 → 배포 즉시 반영.
// 안 바뀌면 해시 동일 → 기존 캐시 유지(최적). 커밋마다 pre-commit 훅으로 자동 실행.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (data) => createHash('sha256').update(data).digest('hex').slice(0, 10);

const texDir = join(root, 'assets/textures');
const texHash = createHash('sha256');
for (const f of readdirSync(texDir).sort()) texHash.update(f).update(readFileSync(join(texDir, f)));
const texVer = texHash.digest('hex').slice(0, 10);
const jsPath = join(root, 'assets/space.js');
const js = readFileSync(jsPath, 'utf8');
const nextJs = js.replace(/const TEX_VER = '[0-9a-f]+'/, `const TEX_VER = '${texVer}'`);
if (nextJs !== js) writeFileSync(jsPath, nextJs);
console.log(`assets/textures -> TEX_VER=${texVer}`);

const htmlPath = join(root, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
let changed = false;

for (const asset of ['assets/space.css', 'assets/space.js']) {
  const hash = sha(readFileSync(join(root, asset)));
  const re = new RegExp(asset.replace(/\./g, '\\.') + '(?:\\?v=[0-9a-f]+)?', 'g');
  const next = html.replace(re, `${asset}?v=${hash}`);
  if (next !== html) { html = next; changed = true; }
  console.log(`${asset} -> ?v=${hash}`);
}

if (changed) { writeFileSync(htmlPath, html); console.log('index.html updated'); }
else console.log('index.html already up to date');
