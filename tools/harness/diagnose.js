/**
 * 봇이 "왜" 지는지 분류한다. 승률만 봐서는 무엇을 고쳐야 할지 알 수 없다.
 *
 *   node diagnose.js --left LabA_v1.js --right ai --matches 30
 *
 * 랠리마다 끝난 이유를 나누고, 봇이 실제로 무슨 행동을 했는지 센다.
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
const load = (spec) =>
  spec === 'ai'
    ? { kind: 'ai', label: 'built-in AI' }
    : {
        kind: 'bot',
        decide: compileBot(readFileSync(resolve(REPO, 'src/code-here', spec), 'utf8'), spec),
        label: spec,
      };

const A = load(args.left || 'ai');
const B = load(args.right || 'ai');
const matches = Number(args.matches || 30);
const NET = 216;

// 관점은 항상 A 기준. 좌우를 바꿔가며 돌린다.
const stat = {
  rallies: 0, aPoints: 0, bPoints: 0,
  lostBy: { touchLimit: 0, ballLandedOwnSide: 0 },
  ownGoal: 0,          // 내가 마지막으로 친 공이 내 코트에 떨어짐
  unreached: 0,        // 낙하지점이 내 코트인데 내가 그 근처에 없었음
  unreachedDist: [],   // 그때 얼마나 떨어져 있었나
  aPowerHits: 0, bPowerHits: 0,
  aJumps: 0, aDives: 0,
  aTouchesPerPossession: [],
};

// --side left|right|both : 관점 봇을 어느 진영에 고정할지. 진영별 약점을 볼 때 쓴다.
const sideArg = args.side || 'both';
const orientations = sideArg === 'left' ? [false] : sideArg === 'right' ? [true] : [false, true];
for (let m = 0; m < matches; m++) {
  for (const flipped of orientations) {
    const left = flipped ? B : A;
    const right = flipped ? A : B;
    const aIsLeft = !flipped;

    let prevScoreTotal = 0;
    let prevPowerHit = false;
    let lastToucher = null;        // 0=left, 1=right
    let prevState = [0, 0];
    let prevCollide = [false, false];
    let touchCount = 0;
    let prevBallLeft = null;
    let lastTouchLimitFired = 0;

    runMatch({
      left, right, seed: 1000 + m, touchLimit: true,
      onFrame: (pv, meta) => {
        if (!meta.isRoundFrame || !meta.simulated) return;
        const b = pv.physics.ball;
        const ps = [pv.physics.player1, pv.physics.player2];

        // 파워히트 / 점프 / 다이빙 카운트
        ps.forEach((p, i) => {
          const isA = (i === 0) === aIsLeft;
          if (prevState[i] !== 1 && p.state === 1 && isA) stat.aJumps++;
          if (prevState[i] !== 3 && p.state === 3 && isA) stat.aDives++;
          prevState[i] = p.state;
        });
        if (!prevPowerHit && b.isPowerHit) {
          if ((lastToucher === 0) === aIsLeft) stat.aPowerHits++;
          else stat.bPowerHits++;
        }
        prevPowerHit = b.isPowerHit;

        // 접촉 추적
        const ballLeft = b.x < NET;
        if (prevBallLeft !== null && ballLeft !== prevBallLeft) touchCount = 0;
        prevBallLeft = ballLeft;
        ps.forEach((p, i) => {
          const c = p.isCollisionWithBallHappened;
          if (c && !prevCollide[i]) { lastToucher = i; touchCount++; }
          prevCollide[i] = c;
        });

        // 랠리 종료
        const total = pv.scores[0] + pv.scores[1];
        if (total === prevScoreTotal) return;
        prevScoreTotal = total;
        stat.rallies++;

        const landedLeft = b.punchEffectX < NET;
        // 공이 땅에 닿아서 끝났는지, 터치리밋이 끊었는지 구분한다.
        // 터치리밋은 공이 공중에 있는 채로 점수를 준다.
        const byTouchLimit = b.y < 250;
        const aLost = byTouchLimit
          ? (lastToucher === 0) === aIsLeft
          : landedLeft === aIsLeft;

        if (aLost) {
          stat.bPoints++;
          if (byTouchLimit) stat.lostBy.touchLimit++;
          else {
            stat.lostBy.ballLandedOwnSide++;
            if ((lastToucher === 0) === aIsLeft) stat.ownGoal++;
            else {
              const meX = aIsLeft ? pv.physics.player1.x : pv.physics.player2.x;
              const d = Math.abs(b.punchEffectX - meX);
              if (d > 40) { stat.unreached++; stat.unreachedDist.push(d); }
            }
          }
        } else {
          stat.aPoints++;
        }
        if ((lastToucher === 0) === aIsLeft) stat.aTouchesPerPossession.push(touchCount);
        touchCount = 0;
      },
    });
  }
}

const games = matches * orientations.length;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (n) => ((100 * n) / stat.rallies).toFixed(1);

console.log(`\n  ${A.label}  (관점, ${sideArg})  vs  ${B.label}   —  ${games} sets, ${stat.rallies} rallies\n`);
console.log(`  득점        ${stat.aPoints}  (${pct(stat.aPoints)}%)`);
console.log(`  실점        ${stat.bPoints}  (${pct(stat.bPoints)}%)`);
console.log('');
console.log(`  실점 내역`);
console.log(`    터치리밋 자멸        ${stat.lostBy.touchLimit}  (${pct(stat.lostBy.touchLimit)}%)`);
console.log(`    내 코트에 떨어짐     ${stat.lostBy.ballLandedOwnSide}  (${pct(stat.lostBy.ballLandedOwnSide)}%)`);
console.log(`      - 자책 (내가 친 공) ${stat.ownGoal}`);
console.log(`      - 못 닿음 (40px+)   ${stat.unreached}, 평균 거리 ${mean(stat.unreachedDist).toFixed(0)}px`);
console.log('');
console.log(`  내 행동     파워히트 ${stat.aPowerHits}   점프 ${stat.aJumps}   다이빙 ${stat.aDives}`);
console.log(`  상대 행동   파워히트 ${stat.bPowerHits}`);
console.log(`  내 소유당 평균 접촉 ${mean(stat.aTouchesPerPossession).toFixed(2)}회 (5회면 실점)`);
console.log('');
