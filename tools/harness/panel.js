/**
 * 여러 상대에게 붙여서 상수를 고른다 — 거울 대전의 함정을 피하는 방법.
 *
 *   node panel.js --bot Leonyi_v13.js --key NODE_BUDGET --values 400,3000,6000 --matches 15
 *
 * ★ 왜 hsweep.js 로는 안 되는가
 *   hsweep 는 같은 파일끼리 TUNE 만 바꿔 붙인다. 그런데 이 게임의 봇은
 *   결정론적이라, **거의 같은 두 봇**을 붙이면 아주 작은 차이가 랠리 전체를
 *   갈라 버린다. 실측: 완전히 같은 봇 같은 예산의 대조군이 전체 50% 인데
 *   **왼쪽 100% / 오른쪽 0%** 였다. 즉 한쪽이 전승한다.
 *   그래서 상수를 조금 바꾸면 승률이 37% -> 100% -> 44% 로 튄다. 이건 성능
 *   곡선이 아니라 나비효과다. NODE_BUDGET 스윕에서 실제로 이렇게 나왔다:
 *     400=84%  1000=37%  2000=44%  3000=100%  6000=50%(대조군)
 *
 *   해법은 **서로 다른 상대 여럿**에게 붙이는 것이다. 상대가 다르면 나비효과가
 *   특정 값에 유리하게 몰릴 이유가 없고, 합계가 실력을 반영한다.
 */
'use strict';
import { runParallel, warnIfBotMisbehaved } from './parallel.js';

const args = process.argv.slice(2).reduce((acc, t, i, all) => {
  if (!t.startsWith('--')) return acc;
  const n = all[i + 1];
  return { ...acc, [t.slice(2)]: n && !n.startsWith('--') ? n : true };
}, {});

const bot = args.bot || 'Leonyi_v13.js';
const key = args.key;
const values = String(args.values || '').split(',').map((v) => Number(v));
const matches = Number(args.matches || 15);
const panel = (args.panel || 'Leonyi_v10.js,Leonyi_v7.js,Leonyi_v1.js,LabA_v1.js,LabC_v1.js,ai').split(',');

console.log(`\n  ${bot} — ${key} 를 상대 ${panel.length}종에게 붙여 고른다`);
console.log(`  각 조합 ${matches * 2} sets · 좌우 스왑 · 시간 예산 해제(결정론적)\n`);
console.log(`  ${key.padEnd(12)} ` + panel.map((p) => p.replace(/\.js$/, '').padStart(11)).join(' ') + '     합계');
console.log('  ' + '-'.repeat(14 + panel.length * 12 + 10));

const rows = [];
for (const v of values) {
  const cells = [];
  let wins = 0;
  let total = 0;
  for (const opp of panel) {
    const r = await runParallel({
      aFile: bot, bFile: opp,
      // 시간 예산은 해제한다 -- 부하와 무관하게 재현되도록.
      aTune: { TIME_BUDGET_MS: 100000, [key]: v },
      bTune: opp === 'ai' ? null : { TIME_BUDGET_MS: 100000 },
      matches, seedBase: 5000,
    });
    warnIfBotMisbehaved(`${bot} (${key}=${v}, vs ${opp})`, r.aBad, { timeBudgetOff: true });
    warnIfBotMisbehaved(`${opp} (vs ${key}=${v})`, r.bBad, { timeBudgetOff: true });
    const decided = r.aWins + r.bWins;
    cells.push(decided ? (100 * r.aWins) / decided : 0);
    wins += r.aWins;
    total += decided;
  }
  const rate = total ? (100 * wins) / total : 0;
  const p = rate / 100;
  const ci = total ? 100 * 1.96 * Math.sqrt((p * (1 - p)) / total) : 100;
  rows.push({ v, rate, ci, wins, total });
  console.log(
    `  ${String(v).padEnd(12)} ` +
    cells.map((c) => (c.toFixed(1) + '%').padStart(11)).join(' ') +
    `   ${rate.toFixed(1)}% ±${ci.toFixed(1)}`
  );
}

console.log('');
rows.sort((a, b) => b.rate - a.rate);
const best = rows[0];
rows.forEach((r) => {
  const overlaps = r !== best && r.rate + r.ci >= best.rate - best.ci;
  console.log(`  ${r === best ? '★' : overlaps ? '=' : ' '} ${r.rate.toFixed(1)}% ±${r.ci.toFixed(1)}  (${r.wins}/${r.total})  ${key}=${r.v}`);
});
console.log('\n  ★ = 최고,  = = 구간이 겹쳐 구분 불가\n');
