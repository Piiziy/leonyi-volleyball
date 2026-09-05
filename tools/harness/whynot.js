/**
 * "탐색은 로브를 어떻게 평가하나" — 봇이 매긴 후보 점수를 그대로 꺼낸다.
 *
 *   node whynot.js [봇] [세트수]
 *
 * ★ 왜
 *   attack.js: 놓친 자리의 정답 39.1% 가 위로 올려치기(y=-1)인데 봇은 9.6% 만
 *   고른다. 원인 후보가 둘이고 처방이 정반대다:
 *     (a) 탐색이 그 수를 **나쁘게 평가**한다 -> 평가(롤아웃 정책)를 고쳐야 한다
 *     (b) 점수는 비슷한데 **동점 처리/섞기**에서 밀린다 -> 그쪽을 고쳐야 한다
 *   추측으로 두 번 빗나갔으니 봇이 매긴 숫자를 직접 본다.
 *
 * 방법
 *   TUNE.DIAG_ROOT 를 끝까지 켜면 봇이 매 틱 후보별 점수를 찍는다. 그것을
 *   가로채, **점프 중이라 파워히트 각도가 실제로 선택지인 틱**만 골라
 *   y=-1(위로) / y=0(수평) / y=+1(내려꽂기) 의 최고 점수를 비교한다.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from './match.js';
import { compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const botFile = process.argv[2] || 'Leonyi_v14.js';
const matches = Number(process.argv[3] || 1);
const src = readFileSync(resolve(REPO, 'src/code-here', botFile), 'utf8') +
  '\n;Object.assign(TUNE,{TIME_BUDGET_MS:100000,DIAG_ROOT:100000000});';

const rootLines = [];
const realLog = console.log;
console.log = (...a) => {
  const s = a.join(' ');
  if (typeof s === 'string' && s.startsWith('[root]')) { rootLines.push(s); return; }
  realLog(...a);
};

for (let m = 0; m < matches; m++) {
  runMatch({
    left: { kind: 'bot', decide: compileBot(src, botFile) },
    right: { kind: 'bot', decide: compileBot(src, 'r_' + botFile) },
    seed: 4200 + m, touchLimit: true,
  });
}
console.log = realLog;

const best = (acts, y) => {
  const f = acts.filter((a) => a.hit === 1 && a.y === y);
  return f.length ? Math.max(...f.map((a) => a.score)) : null;
};

let n = 0, lobLower = 0, gap = 0, tie = 0, lobWins = 0, flatWins = 0, downWins = 0;
const hist = {};
for (const line of rootLines) {
  const m = /^\[root\] tick=(\d+) side=(\w+) ball\((-?\d+),(-?\d+)\)/.exec(line);
  if (!m || m[2] !== 'LEFT') continue;
  const acts = [...line.matchAll(/\((-?\d),(-?\d),(\d)\)=(-?\d+)/g)]
    .map((g) => ({ x: +g[1], y: +g[2], hit: +g[3], score: +g[4] }));
  const up = best(acts, -1), flat = best(acts, 0), down = best(acts, 1);
  if (up === null || flat === null || down === null) continue;   // 파워히트가 후보가 아닌 틱
  n++;
  const top = Math.max(up, flat, down);
  if (top === up) lobWins++; else if (top === flat) flatWins++; else downWins++;
  gap += flat - up;
  if (up < flat) lobLower++;
  if (Math.abs(flat - up) < 5) tie++;
  const b = Math.round((flat - up) / 25) * 25;
  hist[b] = (hist[b] || 0) + 1;
}

console.log(`\n  탐색의 각도 평가 — ${botFile}, ${matches} 세트\n`);
console.log(`  파워히트 각도가 실제 선택지였던 틱   ${n}`);
if (n) {
  console.log(`\n  탐색이 최고점을 준 각도`);
  console.log(`    위로(y=-1)      ${(100*lobWins/n).toFixed(1)}%`);
  console.log(`    수평(y= 0)      ${(100*flatWins/n).toFixed(1)}%`);
  console.log(`    내려꽂기(y=+1)  ${(100*downWins/n).toFixed(1)}%`);
  console.log(`\n  수평 − 위로 점수차   평균 ${(gap/n).toFixed(1)}`);
  console.log(`    위로가 더 낮은 틱   ${(100*lobLower/n).toFixed(1)}%`);
  console.log(`    차이 5 미만(동점)   ${(100*tie/n).toFixed(1)}%`);
  console.log(`\n  점수차 분포 (수평 − 위로):`);
  Object.keys(hist).map(Number).sort((a,b)=>a-b).forEach((k) => {
    console.log(`    ${String(k).padStart(5)}  ${'#'.repeat(Math.ceil(60*hist[k]/n))} ${(100*hist[k]/n).toFixed(1)}%`);
  });
}
console.log('');
