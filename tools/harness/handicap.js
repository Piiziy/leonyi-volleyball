/**
 * 계산량 핸디캡 대전 — 개선을 실제로 잴 수 있는 수단.
 *
 *   node handicap.js --a 새봇.js --b 기존봇.js --aBudget 1000 --bBudget 2000 --matches 100
 *   node handicap.js --a X.js --b X.js --aBudget 1000 --bBudget 2000    # 보정
 *
 * ★ 왜 핸디캡인가
 *   같은 예산으로 자기 대전을 하면 좌우 스왑 때문에 정의상 50%가 나온다.
 *   평가함수를 바꿔도 승률이 안 움직여 개선인지 알 수 없다. 상대에게 계산량을
 *   더 주면 대결이 비대칭이 되어 그 함정이 사라진다. **적은 계산으로 같은
 *   결과를 내면 평가함수가 좋아진 것이다.**
 *
 * ★ 왜 결정론적인가
 *   탐색은 노드 한도와 시간 한도 중 먼저 걸리는 쪽에서 끊긴다. 시간은
 *   Date.now() 라 CPU 부하에 좌우된다(같은 설정이 30%와 40%로 갈린 적이 있다).
 *   여기서는 시간 예산을 크게 줘 **노드 한도만** 물게 한다.
 *
 * ★ 결론을 함부로 내지 않는다
 *   신뢰구간이 50%를 걸치면 "결론 불가"로 표시하고, 몇 세트가 더 필요한지
 *   알려준다. 30세트의 신뢰구간은 ±18%p 라 웬만한 비교가 전부 결론 불가다.
 */
'use strict';
import { runParallel } from './parallel.js';

const parseArgs = (argv) =>
  argv.reduce((acc, t, i, all) => {
    if (!t.startsWith('--')) return acc;
    const n = all[i + 1];
    return { ...acc, [t.slice(2)]: n && !n.startsWith('--') ? n : true };
  }, {});
const args = parseArgs(process.argv.slice(2));

const aFile = args.a || 'Leonyi_v1.js';
const bFile = args.b || 'Leonyi_v1.js';
const aBudget = Number(args.aBudget || 1000);
const bBudget = Number(args.bBudget || 2000);
const matches = Number(args.matches || 100);
const TIME_OFF = 100000;   // 시간 한도를 사실상 해제 -> 노드 한도만 물게

const tuneFor = (budget, extra) =>
  Object.assign(
    { NODE_BUDGET: budget, WARMUP_NODE_BUDGET: Math.min(budget, 300), TIME_BUDGET_MS: TIME_OFF },
    extra ? JSON.parse(extra) : {}
  );

console.log(`  측정 시작... ${matches * 2} sets (진행 중 출력 없음, 끝날 때 한 번에 나옵니다)`);
const started = Date.now();
const r = await runParallel({
  aFile, bFile,
  aTune: tuneFor(aBudget, args.aTune),
  bTune: tuneFor(bBudget, args.bTune),
  matches,
  seedBase: 3000,
});

const decided = r.aWins + r.bWins;
const p = decided ? r.aWins / decided : 0;
const ci = decided ? 100 * 1.96 * Math.sqrt((p * (1 - p)) / decided) : 100;
const rate = 100 * p;
const sidePct = (s) => (s[1] ? ((100 * s[0]) / s[1]).toFixed(1) : '-');

console.log('');
console.log(`  A: ${aFile}  (노드 ${aBudget})`);
console.log(`  B: ${bFile}  (노드 ${bBudget})`);
console.log(`  ${matches * 2} sets · 좌우 스왑 · 노드 한도만(부하 무관, 결정론적)`);
console.log('  ' + '-'.repeat(62));
console.log(`  A 승률        ${rate.toFixed(1)}%  ±${ci.toFixed(1)}   (${r.aWins}승 ${r.bWins}패${r.draws ? ' ' + r.draws + '무' : ''})`);
console.log(`  평균 스코어   ${(r.aPts / (matches * 2)).toFixed(2)} : ${(r.bPts / (matches * 2)).toFixed(2)}`);
console.log(`  A 진영별      LEFT ${sidePct(r.left)}%   RIGHT ${sidePct(r.right)}%`);
console.log(`  소요          ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('');

// --- 결론을 낼 수 있는가 -----------------------------------------------------
const lo = rate - ci;
const hi = rate + ci;
if (lo > 50) {
  console.log(`  판정: A 가 낫다 (구간 ${lo.toFixed(1)}~${hi.toFixed(1)}% 가 전부 50% 위)`);
} else if (hi < 50) {
  console.log(`  판정: B 가 낫다 (구간 ${lo.toFixed(1)}~${hi.toFixed(1)}% 가 전부 50% 아래)`);
} else {
  // 관측된 차이를 확정하려면 몇 세트가 필요한가 (같은 비율이 유지된다고 가정)
  const diff = Math.abs(p - 0.5);
  const needed = diff > 0.005
    ? Math.ceil((1.96 * 1.96 * p * (1 - p)) / (diff * diff))
    : Infinity;
  console.log(`  판정: ★ 결론 불가 — 구간 ${lo.toFixed(1)}~${hi.toFixed(1)}% 가 50% 를 걸친다.`);
  console.log(`        이 차이를 확정하려면 약 ${needed === Infinity ? '매우 많은' : needed} 판(decided)이 필요하다.`);
  console.log(`        지금 ${decided}판. --matches 를 ${Math.ceil((needed / 2) * 1.1) || '더'} 이상으로.`);
}
console.log('');
