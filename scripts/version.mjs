#!/usr/bin/env node
// 자산 캐시 버스팅: 각 스크립트·스타일의 콘텐츠 해시를 index.html 의 ?v= 에,
// assets/textures 전체의 해시를 space.js 의 TEX_VER 에 반영(텍스처 → space.js → index.html 순).
// 파일 내용이 바뀌면 URL이 바뀌어 CDN(4h) 캐시를 우회 → 배포 즉시 반영.
// 안 바뀌면 해시 동일 → 기존 캐시 유지(최적). 커밋 전에 직접 실행한다.
// 모듈끼리의 import 는 index.html 의 importmap 을 거치므로 파일별 해시만으로 충분하다.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ASSETS = [
  'assets/space.css',
  'assets/bag.js',
  'assets/bodies.js',
  'assets/hero.js',
  'assets/picker.js',
  'assets/quotes.js',
  'assets/space.js',
];

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

for (const asset of ASSETS) {
  const hash = sha(readFileSync(join(root, asset)));
  const re = new RegExp(asset.replace(/\./g, '\\.') + '(?:\\?v=[0-9a-f]+)?', 'g');
  const next = html.replace(re, `${asset}?v=${hash}`);
  if (next !== html) { html = next; changed = true; }
  console.log(`${asset} -> ?v=${hash}`);
}

if (changed) { writeFileSync(htmlPath, html); console.log('index.html updated'); }
else console.log('index.html already up to date');
