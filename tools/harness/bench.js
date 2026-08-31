/**
 * 회귀 검사 — 후보 봇을 기준 상대들과 한 번에 붙인다.
 *
 *   node bench.js --bot Leonyi_v3.js [--matches 8] [--opps ai,Example_v1.js,...]
 *
 * 자기 대전만 보고 튜닝하면 다른 유형의 상대에게 약해지는 걸 놓친다.
 * 변경할 때마다 이걸 돌려 "아무것도 안 깨졌는지"부터 확인한다.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from './match.js';
import { compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const parseArgs = (argv) =>
  argv.reduce((acc, t, i, all) => {
    if (!t.startsWith('--')) return acc;
    const n = all[i + 1];
    return { ...acc, [t.slice(2)]: n && !n.startsWith('--') ? n : true };
  }, {});
const args = parseArgs(process.argv.slice(2));

const src = (f) => readFileSync(resolve(REPO, 'src/code-here', f), 'utf8');
const side = (f) => (f === 'ai' ? { kind: 'ai' } : { kind: 'bot', decide: compileBot(src(f), f) });

const botFile = args.bot || 'Leonyi_v1.js';
const matches = Number(args.matches || 8);
const opps = (args.opps || 'ai,Example_v1.js,LabA_v1.js,LabC_v1.js').split(',');

console.log(`\n  ${botFile}  회귀 검사   (상대마다 ${matches * 2}세트, 좌우 스왑)\n`);
console.log('  상대                 승률      득실        진영편차   최대 decide');
console.log('  ' + '-'.repeat(64));

opps.forEach((oppFile) => {
  let wins = 0, decided = 0, pf = 0, pa = 0, maxMs = 0;
  const perSide = { LEFT: [0, 0], RIGHT: [0, 0] };   // [wins, decided]
  for (let m = 0; m < matches; m++) {
    for (const flipped of [false, true]) {
      const r = runMatch({
        left: flipped ? side(oppFile) : side(botFile),
        right: flipped ? side(botFile) : side(oppFile),
        seed: 9000 + m,
        touchLimit: true,
      });
      const mine = flipped ? r.scores[1] : r.scores[0];
      const theirs = flipped ? r.scores[0] : r.scores[1];
      pf += mine; pa += theirs;
      const st = r.botStats[flipped ? 1 : 0];
      if (st) maxMs = Math.max(maxMs, st.maxMs);
      if (mine === theirs) continue;
      decided++;
      const key = flipped ? 'RIGHT' : 'LEFT';
      perSide[key][1]++;
      if (mine > theirs) { wins++; perSide[key][0]++; }
    }
  }
  const rate = decided ? (100 * wins) / decided : 0;
  const l = perSide.LEFT[1] ? (100 * perSide.LEFT[0]) / perSide.LEFT[1] : 0;
  const rgt = perSide.RIGHT[1] ? (100 * perSide.RIGHT[0]) / perSide.RIGHT[1] : 0;
  console.log(
    `  ${oppFile.padEnd(20)} ${rate.toFixed(1).padStart(5)}%   ` +
    `${(pf / (matches * 2)).toFixed(2)}:${(pa / (matches * 2)).toFixed(2)}   ` +
    `${Math.abs(l - rgt).toFixed(0).padStart(6)}%p   ${maxMs.toFixed(1).padStart(7)}ms`
  );
});
console.log('');
