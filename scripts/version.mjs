#!/usr/bin/env node
// 자산 캐시 버스팅: 각 스크립트·스타일의 콘텐츠 해시를 index.html·404.html 의 ?v= 에,
// assets/textures·assets/craft 전체의 해시를 bodies.js 의 ASSET_VER 에 반영(자산 → bodies.js → index.html 순).
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
  'assets/craft.js',
  'assets/hero.js',
  'assets/picker.js',
  'assets/quotes.js',
  'assets/space.js',
  'assets/zoom.js',
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (data) => createHash('sha256').update(data).digest('hex').slice(0, 10);

const assetHash = createHash('sha256');
for (const dir of ['assets/textures', 'assets/craft']) {
  for (const f of readdirSync(join(root, dir)).sort()) assetHash.update(f).update(readFileSync(join(root, dir, f)));
}
const assetVer = assetHash.digest('hex').slice(0, 10);
const jsPath = join(root, 'assets/bodies.js');
const js = readFileSync(jsPath, 'utf8');
const nextJs = js.replace(/const ASSET_VER = '[0-9a-f]+'/, `const ASSET_VER = '${assetVer}'`);
if (nextJs !== js) writeFileSync(jsPath, nextJs);
console.log(`assets/textures, assets/craft -> ASSET_VER=${assetVer}`);

for (const page of ['index.html', '404.html']) {
  const htmlPath = join(root, page);
  const before = readFileSync(htmlPath, 'utf8');
  let html = before;
  for (const asset of ASSETS) {
    const re = new RegExp(asset.replace(/\./g, '\\.') + '(?:\\?v=[0-9a-f]+)?', 'g');
    html = html.replace(re, `${asset}?v=${sha(readFileSync(join(root, asset)))}`);
  }
  if (html !== before) writeFileSync(htmlPath, html);
  console.log(`${page} ${html !== before ? 'updated' : 'already up to date'}`);
}
