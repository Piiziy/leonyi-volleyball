/**
 * 행동 결함 자동 검출 — 승률로는 안 보이는 "왜"를 잡는다.
 *
 *   node behavior.js --left Leonyi_v5.js --right Leonyi_v5.js --matches 10
 *
 * ★ 승률만 보면 "나빠졌다"까지만 알 수 있다. 어떤 장면에서 지는지는 행동을
 *   직접 세야 나온다. 자가 대전을 돌릴 때마다 이걸 같이 돌릴 것.
 *
 * 검출하는 것 (전부 관점은 LEFT 봇 기준):
 *   서서 받을 공을 점프로 놓침 — 가장 비싼 실수. 공이 내 히트박스 높이로
 *                                오는데 점프해서 위에 있느라 흘려보낸 경우
 *   헛점프                     — 점프했는데 공중에 있는 동안 공에 한 번도
 *                                안 닿음
 *   자책                       — 내가 마지막으로 친 공이 내 코트에 떨어짐
 *   못 닿음                    — 낙하지점이 히트박스 밖이라 물리적으로 무리
 *   터치리밋                   — 한 진영 5회 접촉 자멸
 *   워밍업 구간 실점           — 매치 첫 WARMUP_TICKS 구간에서 잃은 점수
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
const tune = typeof args.tune === 'string' ? args.tune : null;
const load = (f) => {
  if (f === 'ai') return { kind: 'ai' };
  let src = readFileSync(resolve(REPO, 'src/code-here', f), 'utf8');
  if (tune) src += '\n;Object.assign(TUNE, ' + tune + ');';
  return { kind: 'bot', decide: compileBot(src, f) };
};

const NET = 216;
const HALF = 32;                 // 히트박스 반폭·반높이
const GROUND_Y = 244;            // 서 있을 때의 y
const matches = Number(args.matches || 10);
const leftFile = args.left || 'Leonyi_v5.js';
const rightFile = args.right || 'Leonyi_v5.js';

const stat = {
  rallies: 0, lost: 0, won: 0,
  jumpedAndMissed: 0,   // 서서 받을 공을 점프해서 놓침
  wastedJumps: 0, jumps: 0,
  ownGoal: 0,
  unreachable: 0,
  touchLimit: 0,
  earlyTickLoss: 0,     // 매치 초반(워밍업 구간)에 잃은 점수
  missDetail: [],
};

// ★ 좌우를 바꿔가며 돌린다. 같은 봇끼리 붙이면서 한쪽만 세면 진영 편향이
//   개선으로 둔갑한다(이 포크는 코트가 완전 대칭이 아니다). 관점은 항상
//   "후보 봇"이고, flipped 일 때는 오른쪽이 후보다.
for (let m = 0; m < matches; m++) {
 for (const flipped of [false, true]) {
  let prevTotal = 0;
  let lastToucher = null;
  let prevCollide = [false, false];
  let prevState = 0;
  let jumpOpen = false;        // 지금 점프 중인가
  let jumpTouched = false;     // 그 점프 동안 공에 닿았나
  let touchCount = 0;
  let prevBallLeft = null;
  let frameNo = 0;

  const meIndex = flipped ? 1 : 0;
  runMatch({
    left: flipped ? load(rightFile) : load(leftFile),
    right: flipped ? load(leftFile) : load(rightFile),
    seed: 5000 + m, touchLimit: true,
    onFrame: (pv, meta) => {
      if (!meta.simulated || !meta.isRoundFrame) return;
      frameNo++;
      const b = pv.physics.ball;
      const me = meIndex === 0 ? pv.physics.player1 : pv.physics.player2;
      const ps = [pv.physics.player1, pv.physics.player2];

      // 점프 구간 추적
      if (prevState !== 1 && me.state === 1) { jumpOpen = true; jumpTouched = false; stat.jumps++; }
      if (jumpOpen) {
        if (me.isCollisionWithBallHappened) jumpTouched = true;
        if (me.state === 0 || me.state === 3 || me.state === 4) {
          if (!jumpTouched) stat.wastedJumps++;
          jumpOpen = false;
        }
      }
      prevState = me.state;

      // 접촉 추적
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
      stat.rallies++;

      const byTouchLimit = b.y < 250;          // 공중인데 점수가 났다 = 터치리밋
      const landedOnMe = (b.punchEffectX < NET) === (meIndex === 0);
      const iLost = byTouchLimit ? lastToucher === meIndex : landedOnMe;
      if (!iLost) { stat.won++; return; }
      stat.lost++;
      if (frameNo < 60) stat.earlyTickLoss++;   // 매치 극초반 실점

      if (byTouchLimit) { stat.touchLimit++; return; }
      if (lastToucher === meIndex) { stat.ownGoal++; return; }

      // ★ 핵심 검출: 서 있었으면 받을 수 있었나?
      // 공이 내 x 히트박스 안에 떨어졌는데 내가 공중에 있었다면, 가만히
      // 서 있기만 했어도 받았을 공을 점프해서 흘려보낸 것이다.
      const dx = Math.abs(b.punchEffectX - me.x);
      if (dx <= HALF && me.y < GROUND_Y) {
        stat.jumpedAndMissed++;
        if (stat.missDetail.length < 3) {
          stat.missDetail.push(
            `seed ${5000 + m} ${flipped ? 'RIGHT' : 'LEFT'}: 공 x=${b.punchEffectX} 착지, 내 x=${me.x} (차이 ${dx}px) 인데 y=${me.y} 로 공중 (state ${me.state})`
          );
        }
      } else if (dx > HALF) {
        stat.unreachable++;
      }
    },
  });
 }
}

const pct = (n) => (stat.lost ? ((100 * n) / stat.lost).toFixed(1) + '%' : '-');
console.log(`\n  ${leftFile}  vs  ${rightFile}   —  ${matches * 2} sets (좌우 스왑), ${stat.rallies} rallies`);
console.log(`  득점 ${stat.won}   실점 ${stat.lost}\n`);
console.log('  실점 원인 (실점 대비 비율)');
console.log(`    ★ 서서 받을 공을 점프로 놓침   ${String(stat.jumpedAndMissed).padStart(4)}  ${pct(stat.jumpedAndMissed)}`);
console.log(`      자책 (내가 친 공)             ${String(stat.ownGoal).padStart(4)}  ${pct(stat.ownGoal)}`);
console.log(`      물리적으로 못 닿음            ${String(stat.unreachable).padStart(4)}  ${pct(stat.unreachable)}`);
console.log(`      터치리밋 자멸                 ${String(stat.touchLimit).padStart(4)}  ${pct(stat.touchLimit)}`);
console.log('');
console.log(`  점프 ${stat.jumps}회 중 헛점프(공에 안 닿음) ${stat.wastedJumps}회 ` +
            `(${stat.jumps ? ((100 * stat.wastedJumps) / stat.jumps).toFixed(1) : 0}%)`);
console.log(`  매치 극초반(첫 60프레임) 실점 ${stat.earlyTickLoss}회`);
if (stat.missDetail.length) {
  console.log('\n  놓친 장면 예시:');
  stat.missDetail.forEach((d) => console.log(`    ${d}`));
}
console.log('');
