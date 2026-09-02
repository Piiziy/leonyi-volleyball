/**
 * 핸디캡 대전으로 상수를 훑는다. handicap.js + sweep.js 를 합친 것.
 *
 *   node hsweep.js --bot Leonyi_v3.js --aBudget 3000 --bBudget 6000 --matches 50 \
 *                  --grid '{"OPP_REACTION_FRAMES":[2,4,6]}'
 *
 * ★ 왜 핸디캡으로 훑는가
 *   같은 예산 자기 대전은 비슷한 봇끼리 50%로 수렴해 상수 차이가 안 보인다.
 *   후보에게 계산량을 덜 주면 평가함수의 질이 승률로 드러난다.
 *   기준(격자 없이 기본값)이 몇 % 인지 먼저 재고, 그보다 높은 값을 찾는다.
 *
 * 신뢰구간이 겹치는 값들은 "구분 불가"로 묶어서 보여준다 -- 이 세션에서
 * 노이즈를 개선으로 읽는 실수를 다섯 번 했다.
 */
'use strict';
import { runParallel, warnIfBotMisbehaved } from './parallel.js';

const parseArgs = (argv) =>
  argv.reduce((acc, t, i, all) => {
    if (!t.startsWith('--')) return acc;
    const n = all[i + 1];
    return { ...acc, [t.slice(2)]: n && !n.startsWith('--') ? n : true };
  }, {});
const args = parseArgs(process.argv.slice(2));

const bot = args.bot || 'Leonyi_v3.js';
const aBudget = Number(args.aBudget || 3000);
const bBudget = Number(args.bBudget || 6000);
const matches = Number(args.matches || 50);
const grid = JSON.parse(args.grid || '{}');
const TIME_OFF = 100000;

const base = (budget) => ({
  NODE_BUDGET: budget,
  WARMUP_NODE_BUDGET: Math.min(budget, 300),
  TIME_BUDGET_MS: TIME_OFF,
});

const combos = Object.keys(grid).reduce(
  (acc, key) => acc.flatMap((b) => grid[key].map((v) => ({ ...b, [key]: v }))),
  [{}]
);

console.log(`\n  ${bot}  후보 ${aBudget}노드  vs  기준 ${bBudget}노드`);
console.log(`  ${combos.length} combos x ${matches * 2} sets\n`);

// ★ 조합마다 끝나는 즉시 찍는다. 전부 끝난 뒤에 한 번에 찍으면 오래 걸리는
//   실행에서 진행 상황을 알 수 없다(실제로 77분 동안 아무것도 안 보였다).
//   그리고 이 출력을 tail 로 파이프하지 말 것 -- 버퍼에 갇힌다.
const rows = [];
let done = 0;
for (const overrides of combos) {
  const started = Date.now();
  const r = await runParallel({
    aFile: bot, bFile: bot,
    aTune: Object.assign(base(aBudget), overrides),
    bTune: base(bBudget),
    matches, seedBase: 3000,
  });
  warnIfBotMisbehaved('후보', r.aBad, { timeBudgetOff: true });
  warnIfBotMisbehaved('기준', r.bBad, { timeBudgetOff: true });
  const decided = r.aWins + r.bWins;
  const p = decided ? r.aWins / decided : 0;
  const ci = decided ? 100 * 1.96 * Math.sqrt((p * (1 - p)) / decided) : 100;
  rows.push({ overrides, rate: 100 * p, ci, decided, wins: r.aWins });
  done++;
  const label = Object.keys(overrides).map((k) => `${k}=${overrides[k]}`).join('  ') || '(기본값)';
  console.log(
    `  [${done}/${combos.length}] ${(100 * p).toFixed(1).padStart(5)}% ±${ci.toFixed(1).padStart(4)}` +
    `  (${r.aWins}/${decided})  ${label}` +
    `   ${((Date.now() - started) / 1000).toFixed(0)}s`
  );
}
console.log('');

rows.sort((a, b) => b.rate - a.rate);
const best = rows[0];
rows.forEach((r) => {
  const label = Object.keys(r.overrides).map((k) => `${k}=${r.overrides[k]}`).join('  ') || '(기본값)';
  // 최고값의 구간과 겹치면 "구분 불가"
  const overlaps = r.rate + r.ci >= best.rate - best.ci && r !== best;
  const mark = r === best ? '★' : overlaps ? '=' : ' ';
  console.log(
    `  ${mark} ${r.rate.toFixed(1).padStart(5)}% ±${r.ci.toFixed(1).padStart(4)}  ` +
    `(${String(r.wins).padStart(3)}/${r.decided})  ${label}`
  );
});
console.log('\n  ★ = 최고,  = = 최고와 신뢰구간이 겹쳐 구분 불가 (표본을 늘려야 판단 가능)\n');
