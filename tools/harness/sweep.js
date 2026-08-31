/**
 * 튜닝 상수를 격자로 훑어 어떤 값이 실제로 이기는지 잰다.
 *
 *   node sweep.js --bot LabA_v1.js --opp ai --matches 30 \
 *                 --grid '{"ENABLE_SETUP":[0,1],"DIVE_DISTANCE":[34,60,999]}'
 *
 * 봇 파일 끝에 Object.assign(TUNE, {...})를 덧붙여 값을 갈아끼운다. TUNE은 파일
 * 최상단에서 var로 선언되고 decide가 그것을 클로저로 잡으므로, 로드 시점에
 * 덮어쓰면 그 값으로 동작한다. 파일 자체는 건드리지 않는다.
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

const botFile = args.bot || 'LabA_v1.js';
const botSource = readFileSync(resolve(REPO, 'src/code-here', botFile), 'utf8');
const grid = JSON.parse(args.grid || '{}');
const matches = Number(args.matches || 30);
const oppSpec = args.opp || 'ai';
const oppSource =
  oppSpec === 'ai' ? null : readFileSync(resolve(REPO, 'src/code-here', oppSpec), 'utf8');

/** 격자를 데카르트 곱으로 펼친다 */
const combos = Object.keys(grid).reduce(
  (acc, key) => acc.flatMap((base) => grid[key].map((v) => ({ ...base, [key]: v }))),
  [{}]
);

// --tune 은 양쪽에 공통으로 적용된다(예: 탐색 예산을 낮춰 빠르게 돌리기).
// 격자(--grid)는 그 위에 후보에게만 덧씌운다.
const baseTune = typeof args.tune === 'string' ? args.tune : null;
const withTune = (source, extra) => {
  let out = source;
  if (baseTune) out += '\n;Object.assign(TUNE, ' + baseTune + ');';
  if (extra) out += '\n;Object.assign(TUNE, ' + JSON.stringify(extra) + ');';
  return out;
};
const makeSide = (overrides) => ({
  kind: 'bot',
  decide: compileBot(withTune(botSource, overrides), botFile),
});
const makeOpp = () =>
  oppSource === null
    ? { kind: 'ai' }
    : { kind: 'bot', decide: compileBot(withTune(oppSource, null), oppSpec) };

console.log(`\n  ${botFile} vs ${oppSpec}   ${combos.length} combos x ${matches * 2} sets\n`);
const results = combos.map((overrides) => {
  let wins = 0, decided = 0, pointsFor = 0, pointsAgainst = 0;
  for (let m = 0; m < matches; m++) {
    for (const flipped of [false, true]) {
      const r = runMatch({
        left: flipped ? makeOpp() : makeSide(overrides),
        right: flipped ? makeSide(overrides) : makeOpp(),
        seed: 2000 + m,
        touchLimit: true,
      });
      const mine = flipped ? r.scores[1] : r.scores[0];
      const theirs = flipped ? r.scores[0] : r.scores[1];
      pointsFor += mine;
      pointsAgainst += theirs;
      if (mine !== theirs) { decided++; if (mine > theirs) wins++; }
    }
  }
  return { overrides, wins, decided, rate: decided ? (100 * wins) / decided : 0, pointsFor, pointsAgainst };
});

results.sort((a, b) => b.rate - a.rate || b.pointsFor - a.pointsFor);
results.forEach((r) => {
  const label = Object.keys(r.overrides).map((k) => `${k}=${r.overrides[k]}`).join('  ');
  console.log(
    `  ${r.rate.toFixed(1).padStart(5)}%  (${String(r.wins).padStart(3)}/${r.decided})` +
    `   득실 ${(r.pointsFor / (matches * 2)).toFixed(2)}:${(r.pointsAgainst / (matches * 2)).toFixed(2)}   ${label}`
  );
});
console.log('');
