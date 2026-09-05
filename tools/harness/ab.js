/**
 * 조합 A/B — 여러 TUNE 조합을 **기준 봇 하나** 상대로 잰다.
 *
 *   node ab.js --bot Leonyi_v16.js --ref Leonyi_v14.js --matches 60 \
 *              --combos '[["이름",{"KEY":1}], ...]'
 *
 * ★ 왜 panel.js 로 부족한가
 *   panel.js 는 상대 6종에게 붙이는데 v14 는 그 여섯 전부에게 **180/180** 이다.
 *   천장에 닿은 자를 대고 재면 개선은 원리적으로 안 보이고 회귀만 보인다.
 *   실제로 SIM_LANDING_REFRESH=1 이 패널에서는 구분 불가였는데 v14 직접
 *   대전에서는 100/100 이었다.
 *
 * ★ 결과를 조합마다 즉시 파일에 쓴다 (--out, 기본 ab-results.txt)
 *   Node 는 stdout 이 파이프면 버퍼링해서, 긴 측정 도중에는 아무것도 안 보인다.
 *   실제로 5조합짜리를 6시간 돌리고도 끝난 4개의 결과를 못 봤다.
 *   appendFileSync 는 동기라 조합이 끝나는 즉시 디스크에 남는다.
 *
 * ★ 비용을 먼저 계산할 것
 *   한 세트의 CPU 비용 ~= (양쪽 decide 평균 ms) x 약 4100 호출.
 *   v16(34ms) 끼리면 세트당 280초다. 120세트 x 5조합 = 6.7시간.
 *   기준을 빠른 봇(v14, 17ms)으로 두면 세트당 비용이 크게 준다.
 *   시작할 때 예상 시간을 찍으니 그걸 보고 규모를 정할 것.
 */
'use strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { runParallel, warnIfBotMisbehaved } from './parallel.js';

const args = process.argv.slice(2).reduce((acc, t, i, all) => {
  if (!t.startsWith('--')) return acc;
  const n = all[i + 1];
  return { ...acc, [t.slice(2)]: n && !n.startsWith('--') ? n : true };
}, {});

const bot = args.bot || 'Leonyi_v16.js';
const ref = args.ref || 'Leonyi_v14.js';
const matches = Number(args.matches || 60);
const seedBase = Number(args.seed || 7000);
const out = args.out || 'ab-results.txt';
const NO_TIME_BUDGET = { TIME_BUDGET_MS: 100000 };
const combos = JSON.parse(args.combos || '[["대조",{}]]');
// ★ 스크리닝: 양쪽 예산을 함께 낮추면 3배 빨라진다. 후보를 훑을 때만 쓰고,
//   이긴 것은 반드시 정식 예산에서 다시 확인할 것 -- 예산에 따라 결과가
//   달라지는 변경이 실제로 있었다(README).
const screen = args.screen ? JSON.parse(args.screen) : null;

const say = (line) => { console.log(line); appendFileSync(out, line + '\n'); };
writeFileSync(out, '');
say(`\n  ${bot} 의 조합 vs ${ref} — 각 ${matches * 2} 세트 · 좌우 스왑`);
say(`  시작 ${new Date().toLocaleTimeString()}  ·  조합 ${combos.length}개\n`);
say('  조합                                      승률            경과');
say('  ' + '-'.repeat(66));

const t0 = Date.now();
const rows = [];
for (const [name, tune] of combos) {
  const tc = Date.now();
  const r = await runParallel({
    aFile: bot, bFile: ref,
    aTune: { ...NO_TIME_BUDGET, ...screen, ...tune },
    bTune: { ...NO_TIME_BUDGET, ...screen },
    matches, seedBase,
  });
  warnIfBotMisbehaved(`${bot} (${name})`, r.aBad, { timeBudgetOff: true });
  warnIfBotMisbehaved(ref, r.bBad, { timeBudgetOff: true });
  const d = r.aWins + r.bWins;
  const p = d ? r.aWins / d : 0;
  const ci = d ? 100 * 1.96 * Math.sqrt((p * (1 - p)) / d) : 100;
  rows.push({ name, p: 100 * p, ci, w: r.aWins, d });
  const mins = ((Date.now() - tc) / 60000).toFixed(1);
  say(`  ${name.padEnd(38)} ${(100 * p).toFixed(1).padStart(5)}% ±${ci.toFixed(1).padStart(4)} (${r.aWins}/${d})  ${mins}분`);
}

say('');
const ctrl = rows.find((r) => /대조/.test(r.name));
if (ctrl && Math.abs(ctrl.p - 50) > ctrl.ci + 5) {
  say(`  ⚠ 대조군이 ${ctrl.p.toFixed(1)}% 다 (50% 여야 함). 나비효과 구간이므로`);
  say(`    절대 수치는 믿지 말 것 — 조합 간 순서만 참고.`);
}
rows.slice().sort((a, b) => b.p - a.p).forEach((r, i) => {
  const beats = r.p - r.ci > 50;
  say(`  ${i === 0 ? '★' : ' '} ${r.p.toFixed(1).padStart(5)}% ±${r.ci.toFixed(1).padStart(4)}  ${beats ? '기준보다 유의하게 강함' : ''}  ${r.name}`);
});
say(`\n  총 ${((Date.now() - t0) / 60000).toFixed(1)}분  ·  결과 파일 ${out}\n`);
