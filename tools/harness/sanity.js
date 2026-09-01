/**
 * 롤아웃 정책이 물리적으로 말이 되는지 검사한다.
 *
 *   node sanity.js [봇파일]
 *
 * ★ 왜 필요한가
 *   봇의 평가는 사실상 롤아웃 정책이 전부다(롤아웃의 95%가 지평선 전에 끝난다).
 *   그런데 그 정책이 물리적으로 말이 안 되는 행동을 하면 -- 예를 들어 시뮬 속
 *   선수가 자기 코트에 스매시를 꽂으면 -- 봇은 "상대가 알아서 자멸한다"고
 *   계산하고 받기 좋은 공을 상대에게 준다.
 *
 *   그리고 이런 오류는 **자기 대전 승률로는 절대 안 잡힌다.** 양쪽이 같은
 *   착각을 공유하면 대가가 서로 상쇄되기 때문이다. 실제로 이 버그는 사용자가
 *   경기를 눈으로 보고 발견했고, 그 전까지 300세트 측정은 "25%p 개선"이라고
 *   말하고 있었다.
 *
 *   그래서 승률과 별개로 물리 자체를 검사한다. 봇을 고칠 때마다 돌릴 것.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const file = process.argv[2] || 'Leonyi_v5.js';
const src = readFileSync(resolve(REPO, 'src/code-here', file), 'utf8');

// 봇 안의 실제 정책과 상수를 그대로 꺼내 쓴다 -- 사본을 만들면 그 사본이 낡는다.
const B = new Function(
  src +
    '\n;return {policyFor: policyFor, stepBallWorld: stepBallWorld, TUNE: TUNE,' +
    ' NET: GROUND_HALF_WIDTH};'
)();
const NET = B.NET;

/** 그 각도로 때리면 공이 실제로 어디에 떨어지는가 */
const landingOf = (bx, by, bvy, ix, iy, fromLeft) => {
  const b = {
    x: bx,
    y: by,
    xVelocity: fromLeft ? (Math.abs(ix) + 1) * 10 : -(Math.abs(ix) + 1) * 10,
    yVelocity: Math.abs(bvy) * iy * 2,
  };
  for (let f = 1; f <= 300; f++) if (B.stepBallWorld(b)) return b.x;
  return b.x;
};

/** 정책에 물어보기 위한 가상의 세계 하나 */
const makeWorld = (bx, by, fromLeft) => {
  const player = (x, y, state, isP2) => ({
    x, y, state,
    yVelocity: 0, frameNumber: 0, divingDirection: 0,
    lyingDownDurationLeft: -1, delayBeforeNextFrame: 0,
    armSwing: 1, collided: false, isPlayer2: isP2,
  });
  return {
    ball: { x: bx, y: by, xVelocity: 0, yVelocity: 12, isPowerHit: false, expectedLandingPointX: bx },
    // 때리려는 쪽은 공 바로 옆에 떠 있고, 반대쪽은 자기 코트에 서 있다
    p1: fromLeft ? player(bx, by, 1, false) : player(100, 244, 0, false),
    p2: fromLeft ? player(330, 244, 0, true) : player(bx, by, 1, true),
  };
};

let checked = 0;
let selfGoals = 0;
const samples = [];

for (const fromLeft of [true, false]) {
  for (let d = 10; d <= 190; d += 10) {           // 네트로부터의 거리
    for (const by of [70, 90, 110, 130, 150]) {   // 접촉 높이
      const bx = fromLeft ? NET - d : NET + d;
      const action = B.policyFor(makeWorld(bx, by, fromLeft), fromLeft, true);
      if (action.hit !== 1) continue;             // 안 때리면 검사 대상이 아니다
      checked++;
      const landing = landingOf(bx, by, 12, action.x, action.y, fromLeft);
      const ownSide = fromLeft ? landing < NET : landing > NET;
      if (!ownSide) continue;
      selfGoals++;
      if (samples.length < 6) {
        samples.push(
          `${fromLeft ? 'LEFT ' : 'RIGHT'} 네트거리 ${String(d).padStart(3)} 높이 ${by}` +
            `  ->  정책이 y=${action.y} 선택, 착지 ${landing} (자기 코트)`
        );
      }
    }
  }
}

console.log(`\n  ${file}  롤아웃 정책 물리 검사`);
console.log('  ' + '-'.repeat(62));
console.log(`  정책이 "때린다"고 답한 상황   ${checked}`);
console.log(
  `  그중 자기 코트에 꽂는 경우    ${selfGoals}` +
    `  (${checked ? ((100 * selfGoals) / checked).toFixed(1) : 0}%)`
);
if (selfGoals > 0) {
  console.log('\n  ★ 실패 — 시뮬 속 선수가 자멸한다. 봇이 상대를 과소평가하게 된다.');
  samples.forEach((s) => console.log('    ' + s));
  console.log('\n  SMASH_NEAR_NET / SMASH_MID_NET 을 조정하거나 정책을 고칠 것.');
  process.exitCode = 1;
} else {
  console.log('\n  통과 — 정책이 때리기로 한 모든 상황에서 공이 네트를 넘는다.');
}
console.log('');
