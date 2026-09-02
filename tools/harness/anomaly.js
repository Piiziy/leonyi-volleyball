/**
 * 이상행동 검사 — 사람이 경기를 보면 "저건 이상한데" 할 만한 것들을 자동으로 센다.
 *
 *   node anomaly.js Leonyi_v8.js [상대] [경기수]
 *
 * ★ 왜 필요한가
 *   승률은 "나빠졌다"만 알려주고, behavior.js 는 내가 그때그때 떠올린 몇 가지만
 *   본다. 실제로 "공이 상대 코트에 있는데 91% 가만히 서 있음", "다이빙의 2/3 가
 *   공이 상대 쪽에 있을 때" 같은 것들은 목록에 없어서 못 잡았고, 사용자가 직접
 *   경기를 돌려보고 발견했다.
 *
 *   그래서 **물리적으로 말이 안 되거나 명백히 손해인 행동**을 폭넓게 센다.
 *   각 항목은 "왜 손해인가"가 분명한 것만 넣었다. 애매한 건 넣지 않는다 --
 *   거짓 경보가 많으면 아무도 안 보게 된다.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from './match.js';
import { compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const botFile = process.argv[2] || 'Leonyi_v8.js';
const oppFile = process.argv[3] || botFile;
const matches = Number(process.argv[4] || 6);

const NET = 216;
const HALF = 32;          // 히트박스 반폭
const GROUND_Y = 244;     // 서 있을 때의 y
const WALK = 6;           // 걷기 속도 (px/프레임)

const load = (f) =>
  f === 'ai'
    ? { kind: 'ai' }
    : { kind: 'bot', decide: compileBot(readFileSync(resolve(REPO, 'src/code-here', f), 'utf8'), f) };

/** 각 항목: 이름, 설명, 카운터 */
const A = {
  diveOnOppSide:    { n: 0, of: 0, nL: 0, ofL: 0, label: '공이 상대 코트인데 다이빙',       why: '5프레임 경직만 손해. 공이 올 수 없다' },
  diveWhenWalkable: { n: 0, of: 0, nL: 0, ofL: 0, label: '걸어서 닿는데 다이빙',            why: '경직 5프레임이 순손해' },
  // ★ 점프의 비용을 오해했었다. physics.js 를 다시 읽어 보니 점프 중에도
  //   x 이동은 그대로 6px/프레임이다(playerVelocityX 는 state < 3 이면 입력을
  //   따른다). 그러니 헛점프가 잃는 것은 "궤도"가 아니라 **그 32프레임 동안
  //   다이빙도 재점프도 못 한다**는 것뿐이다. 손해가 작아서 우선순위도 낮다.
  jumpNoContact:    { n: 0, of: 0, nL: 0, ofL: 0, label: '공에 닿지 않은 점프',             why: '착지까지 다이빙·재점프를 못 한다(손해는 작다)' },
  jumpOnOppSide:    { n: 0, of: 0, nL: 0, ofL: 0, label: '비행 내내 공이 상대 코트인 점프', why: '착지까지 다이빙·재점프를 못 한다(손해는 작다)' },
  idleWhileIncoming:{ n: 0, of: 0, nL: 0, ofL: 0, label: '공이 오는데 낙하지점에서 멀리 정지', why: '갈 시간이 있는데 안 간다' },
  awayFromBall:     { n: 0, of: 0, nL: 0, ofL: 0, label: '공이 오는데 반대로 이동',         why: '거리가 벌어진다' },
  ownGoal:          { n: 0, of: 0, nL: 0, ofL: 0, label: '내가 친 공이 내 코트에 낙하',     why: '자책' },
  touchLimit:       { n: 0, of: 0, nL: 0, ofL: 0, label: '터치리밋 자멸',                   why: '5회 접촉 실점' },
  standingIdle:     { n: 0, of: 0, nL: 0, ofL: 0, label: '공이 상대 코트일 때 정지',        why: '수비 준비를 안 한다(참고용)' },
};

for (let m = 0; m < matches; m++) {
  for (const flipped of [false, true]) {
    const meIdx = flipped ? 1 : 0;
    let prevState = 0;
    let jumpOpen = false;
    let jumpTouched = false;
    let jumpBallCameOver = false;
    let jumpWasLeft = false;
    let lastToucher = null;
    let prevCollide = [false, false];
    let touchCount = 0;
    let prevBallLeft = null;
    let prevTotal = 0;

    runMatch({
      left: flipped ? load(oppFile) : load(botFile),
      right: flipped ? load(botFile) : load(oppFile),
      seed: 7000 + m,
      touchLimit: true,
      onFrame: (pv, meta) => {
        if (!meta.simulated || !meta.isRoundFrame) return;
        const b = pv.physics.ball;
        const ps = [pv.physics.player1, pv.physics.player2];
        const me = ps[meIdx];
        const k = pv.keyboardArray[meIdx];
        const myCourtLeft = meIdx === 0;
        // 좌/우를 따로 세기 위한 헬퍼 (n 은 전체, nL 은 LEFT 일 때만)
        const bump = (r, hit) => {
          r.of++; if (myCourtLeft) r.ofL++;
          if (hit) { r.n++; if (myCourtLeft) r.nL++; }
        };
        const ballOnMySide = myCourtLeft ? b.x < NET : b.x > NET;
        const landing = b.expectedLandingPointX;
        const landingMine = myCourtLeft ? landing < NET : landing > NET;

        // --- 다이빙 -------------------------------------------------------
        if (prevState !== 3 && me.state === 3) {
          bump(A.diveOnOppSide, !ballOnMySide);
          bump(A.diveWhenWalkable, ballOnMySide && Math.abs(landing - me.x) <= HALF);
        }

        // --- 점프 ---------------------------------------------------------
        if (prevState !== 1 && me.state === 1) {
          jumpOpen = true;
          jumpTouched = false;
          jumpBallCameOver = ballOnMySide;   // 시작 시점에 이미 우리 쪽이면 정상
          jumpWasLeft = myCourtLeft;
        }
        if (jumpOpen) {
          if (me.isCollisionWithBallHappened) jumpTouched = true;
          // ★ 점프 시작 시점의 공 위치만 보면 안 된다. 곧 넘어올 공을 미리
          //   맞이하는 점프는 정상이다. 비행 중에 한 번이라도 우리 쪽으로
          //   넘어왔는지를 본다.
          if (ballOnMySide) jumpBallCameOver = true;
          if (me.state === 0 || me.state === 3 || me.state === 4) {
            bump(A.jumpNoContact, !jumpTouched);
            bump(A.jumpOnOppSide, !jumpBallCameOver);
            jumpOpen = false;
          }
        }
        prevState = me.state;

        // --- 이동 ---------------------------------------------------------
        if (ballOnMySide && landingMine && me.state === 0) {
          const gap = Math.abs(landing - me.x);
          bump(A.idleWhileIncoming, gap > HALF && k.xDirection === 0);
          bump(A.awayFromBall, gap > HALF && k.xDirection !== 0 &&
            Math.sign(landing - me.x) !== Math.sign(k.xDirection));
        }
        if (!ballOnMySide && me.state === 0) {
          bump(A.standingIdle, k.xDirection === 0);
        }

        // --- 접촉/실점 ----------------------------------------------------
        const ballLeft = b.x < NET;
        if (prevBallLeft !== null && ballLeft !== prevBallLeft) touchCount = 0;
        prevBallLeft = ballLeft;
        ps.forEach((p, i) => {
          const c = p.isCollisionWithBallHappened;
          if (c && !prevCollide[i]) { lastToucher = i; touchCount++; }
          prevCollide[i] = c;
        });

        const total = pv.scores[0] + pv.scores[1];
        if (total === prevTotal) return;
        prevTotal = total;
        const byTouchLimit = b.y < 250;
        const landedOnMe = (b.punchEffectX < NET) === myCourtLeft;
        bump(A.touchLimit, byTouchLimit && lastToucher === meIdx);
        bump(A.ownGoal, !byTouchLimit && landedOnMe && lastToucher === meIdx);
      },
    });
  }
}

console.log(`\n  ${botFile}  vs  ${oppFile}   —  ${matches * 2} sets (좌우 스왑)\n`);
console.log('  이상행동                          전체      LEFT      RIGHT');
console.log('  ' + '-'.repeat(68));
Object.keys(A).forEach((key) => {
  const r = A[key];
  const pct = r.of ? (100 * r.n) / r.of : 0;
  const mark = pct >= 20 ? '★ ' : '  ';
  const pl = r.ofL ? (100 * r.nL) / r.ofL : 0;
  const pr = (r.of - r.ofL) ? (100 * (r.n - r.nL)) / (r.of - r.ofL) : 0;
  const gap = Math.abs(pl - pr);
  console.log(
    `  ${mark}${r.label.padEnd(32)} ${pct.toFixed(1).padStart(5)}%   ` +
      `L ${pl.toFixed(1).padStart(5)}%  R ${pr.toFixed(1).padStart(5)}%` +
      (gap >= 15 ? '   ← 진영 격차' : '')
  );
});
console.log('\n  ★ = 20% 이상. 왜 손해인지:');
Object.keys(A).forEach((key) => {
  const r = A[key];
  const pct = r.of ? (100 * r.n) / r.of : 0;
  if (pct >= 20) console.log(`    ${r.label} — ${r.why}`);
});
console.log('');
