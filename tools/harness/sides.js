/**
 * 좌우 비대칭 해부 — "왼쪽이 유리한 것이 행동 차이 때문인가".
 *
 *   node sides.js [봇] [경기수]
 *
 * ★ 무엇을 가리려는가
 *   같은 봇끼리 붙이면 한쪽이 거의 전승한다. 두 가지 설명이 가능하다.
 *
 *   (A) 나비효과 -- 좌우 행동은 같은데 아주 작은 비대칭이 매번 같은 쪽으로
 *       승패를 몰아준다. 그러면 **행동 지표는 좌우가 같아야 한다.**
 *   (B) 실제 비대칭 -- 한쪽이 상대에게 때리기 좋은 공을 준다. 그러면
 *       **반대쪽이 스매시 기회를 더 많이 받고 결정타도 더 많아야 한다.**
 *
 *   "소유권(possession)" 단위로 센다: 공이 네트를 넘어 한쪽 코트에 들어온
 *   순간부터 다시 넘어가거나 바닥에 닿을 때까지가 한 번의 소유다.
 *   앞선 판(版)은 프레임 단위로 세다가 계수가 어긋나 "건드림 100.8%" 같은
 *   불가능한 값을 냈다. 비율이 100% 를 넘으면 도구가 고장 난 것이다.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from './match.js';
import { compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const NET = 216;

const botFile = process.argv[2] || 'Leonyi_v14.js';
const matches = Number(process.argv[3] || 10);
const src = readFileSync(resolve(REPO, 'src/code-here', botFile), 'utf8');
const mk = () => ({ kind: 'bot', decide: compileBot(src, botFile) });

const blank = () => ({
  poss: 0,          // 우리 코트로 공이 들어온 횟수
  touched: 0,       // 그중 건드린 소유
  smashed: 0,       // 그중 파워히트(state 2)로 친 소유
  returned: 0,      // 그중 네트 너머로 돌려보낸 소유
  lostUntouched: 0, // 손도 못 대고 실점한 소유
  smashHeightSum: 0, smashHeightN: 0,  // 파워히트 접촉 시 공 높이 (작을수록 높은 공)
  giveHeightSum: 0, giveHeightN: 0,    // 우리가 넘긴 공이 네트를 지날 때 높이
  points: 0, setsWon: 0,
});
const S = [blank(), blank()];   // 0 = LEFT(player1), 1 = RIGHT(player2)

for (let m = 0; m < matches; m++) {
  let prevCollide = [false, false];
  let prevBallLeft = null;
  let owner = null;              // 지금 공을 받아야 하는 쪽 (0/1)
  let ownerTouched = false;
  let ownerSmashed = false;
  let prevTotal = 0;

  /** 한 소유가 끝났다. 결과를 집계한다. */
  const closePossession = (returned, lostHere) => {
    if (owner === null) return;
    S[owner].poss++;
    if (ownerTouched) S[owner].touched++;
    if (ownerSmashed) S[owner].smashed++;
    if (returned) S[owner].returned++;
    if (lostHere && !ownerTouched) S[owner].lostUntouched++;
    ownerTouched = false;
    ownerSmashed = false;
  };

  const r = runMatch({
    left: mk(), right: mk(), seed: 8000 + m, touchLimit: true,
    onFrame: (pv, meta) => {
      if (!meta.simulated || !meta.isRoundFrame) return;
      const b = pv.physics.ball;
      const ps = [pv.physics.player1, pv.physics.player2];
      const ballLeft = b.x < NET;

      // --- 접촉 (통과 판정보다 먼저: 이 프레임의 접촉은 지금 소유에 속한다) ---
      ps.forEach((p, i) => {
        const c = p.isCollisionWithBallHappened;
        if (c && !prevCollide[i] && i === owner) {
          ownerTouched = true;
          if (p.state === 2) {
            ownerSmashed = true;
            S[i].smashHeightSum += b.y; S[i].smashHeightN++;
          }
        }
        prevCollide[i] = c;
      });

      // --- 네트 통과 = 소유 이전 -------------------------------------------
      if (prevBallLeft !== null && ballLeft !== prevBallLeft) {
        const sender = owner;
        closePossession(true, false);
        if (sender !== null) { S[sender].giveHeightSum += b.y; S[sender].giveHeightN++; }
        owner = ballLeft ? 0 : 1;
      } else if (owner === null) {
        owner = ballLeft ? 0 : 1;          // 서브 시작
      }
      prevBallLeft = ballLeft;

      // --- 득점 -------------------------------------------------------------
      const total = pv.scores[0] + pv.scores[1];
      if (total !== prevTotal) {
        prevTotal = total;
        const byTouchLimit = b.y < 250;
        if (!byTouchLimit) {
          const loser = b.punchEffectX < NET ? 0 : 1;
          S[1 - loser].points++;
          closePossession(false, loser === owner);
        } else {
          closePossession(false, false);
        }
        owner = null;
        prevBallLeft = null;
      }
    },
  });
  if (r.scores[0] > r.scores[1]) S[0].setsWon++; else if (r.scores[1] > r.scores[0]) S[1].setsWon++;
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '0.0') + '%';
const avg = (s, n) => (n ? (s / n).toFixed(0) : '-');
console.log(`\n  좌우 비대칭 해부 — ${botFile} 자기 대전 ${matches} 세트\n`);
console.log('  지표                                  LEFT        RIGHT');
console.log('  ' + '-'.repeat(56));
const row = (label, l, r) => console.log(`  ${label.padEnd(34)} ${String(l).padStart(9)}   ${String(r).padStart(9)}`);
row('세트 승', S[0].setsWon, S[1].setsWon);
row('득점', S[0].points, S[1].points);
console.log('  ' + '-'.repeat(56));
row('공이 우리 코트에 들어온 횟수', S[0].poss, S[1].poss);
row('  건드림', pct(S[0].touched, S[0].poss), pct(S[1].touched, S[1].poss));
row('  ★ 파워히트로 침', pct(S[0].smashed, S[0].poss), pct(S[1].smashed, S[1].poss));
row('  돌려보냄', pct(S[0].returned, S[0].poss), pct(S[1].returned, S[1].poss));
row('  손도 못 대고 실점', pct(S[0].lostUntouched, S[0].poss), pct(S[1].lostUntouched, S[1].poss));
console.log('  ' + '-'.repeat(56));
row('파워히트 접촉 높이 (작을수록 높은 공)', avg(S[0].smashHeightSum, S[0].smashHeightN), avg(S[1].smashHeightSum, S[1].smashHeightN));
row('넘긴 공의 네트 통과 높이', avg(S[0].giveHeightSum, S[0].giveHeightN), avg(S[1].giveHeightSum, S[1].giveHeightN));
console.log(`
  읽는 법
    "파워히트로 침" 이 좌우로 크게 다르면 -> 한쪽이 때리기 좋은 공을 받고
    있다(가설 B). 거의 같은데 승패만 갈리면 -> 나비효과(가설 A).
    "넘긴 공의 네트 통과 높이" 는 **작을수록 높이 넘긴 것** = 상대가 때리기 쉽다.
`);
