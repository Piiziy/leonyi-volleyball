/**
 * botsrc/core.js (봇 안에 들어갈 물리 미러)가 진짜 엔진과 일치하는지 검증한다.
 *
 *   node verifyMirror.js [matches]
 *
 * 방법: 실제 경기를 돌리면서 매 프레임,
 *   1) 엔진이 그 프레임을 계산하기 직전의 상태를 미러로 복사하고
 *   2) 그 프레임에 실제로 들어간 입력으로 미러를 한 프레임 굴린 뒤
 *   3) 엔진이 실제로 만들어낸 다음 상태와 필드별로 비교한다.
 *
 * 미러는 봇에 인라인될 소스 그대로를 new Function으로 로드한다 -- 검증한 것과
 * 배포되는 것이 같은 텍스트여야 의미가 있다.
 *
 * 난수가 개입한 프레임(공이 플레이어 중심 2px 이내)은 봇이 원리적으로 맞출 수
 * 없으므로 따로 센다. 그 외의 불일치는 전부 미러의 버그다.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from './match.js';
import { compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

const coreSource = readFileSync(resolve(HERE, 'botsrc/core.js'), 'utf8');
// eslint-disable-next-line no-new-func
const mirror = new Function(
  coreSource + '\n;return { stepFrame: stepFrame, predictLanding: predictLanding, predictPowerHitLanding: predictPowerHitLanding, isCollision: isCollision };'
)();

const snapshotWorld = (pv) => {
  const b = pv.physics.ball;
  const toP = (p) => ({
    x: p.x, y: p.y, yVelocity: p.yVelocity, state: p.state,
    frameNumber: p.frameNumber, divingDirection: p.divingDirection,
    lyingDownDurationLeft: p.lyingDownDurationLeft,
    delayBeforeNextFrame: p.delayBeforeNextFrame,
    armSwing: p.normalStatusArmSwingDirection,
    collided: p.isCollisionWithBallHappened,
    isPlayer2: p.isPlayer2,
  });
  return {
    ball: { x: b.x, y: b.y, xVelocity: b.xVelocity, yVelocity: b.yVelocity,
            isPowerHit: b.isPowerHit, expectedLandingPointX: b.expectedLandingPointX },
    p1: toP(pv.physics.player1),
    p2: toP(pv.physics.player2),
  };
};

const BALL_FIELDS = ['x', 'y', 'xVelocity', 'yVelocity', 'isPowerHit', 'expectedLandingPointX'];
const PLAYER_FIELDS = ['x', 'y', 'yVelocity', 'state', 'frameNumber', 'divingDirection',
                       'lyingDownDurationLeft', 'delayBeforeNextFrame', 'armSwing', 'collided'];

const matches = Number(process.argv[2] || 30);
const src = readFileSync(resolve(REPO, 'src/code-here/Example_v1.js'), 'utf8');

let frames = 0;
let uncertainFrames = 0;
let badFrames = 0;
const fieldCounts = {};
const samples = [];

for (let seed = 1; seed <= matches; seed++) {
  // Three matchups so the mirror is exercised on dives, power hits and long
  // rallies alike: the built-in AI dives and smashes, the example bot does not.
  const pick = (kind) =>
    kind === 'ai' ? { kind: 'ai' } : { kind: 'bot', decide: compileBot(src, 'ex') };
  const pairs = [['ai', 'ai'], ['bot', 'ai'], ['bot', 'bot']];
  const [lk, rk] = pairs[seed % 3];

  let previous = null;
  runMatch({
    left: pick(lk), right: pick(rk), seed, touchLimit: true, maxFrames: 30000,
    onFrame: (pv, meta) => {
      const now = snapshotWorld(pv);
      // getInput() writes these at the top of the frame and nothing clears them,
      // so after gameLoop they still hold the inputs THIS frame consumed --
      // which is what has to be applied to the PREVIOUS world state.
      const k0 = pv.keyboardArray[0], k1 = pv.keyboardArray[1];
      const i0 = { x: k0.xDirection, y: k0.yDirection, h: k0.powerHit };
      const i1 = { x: k1.xDirection, y: k1.yDirection, h: k1.powerHit };

      if (previous !== null && previous.wasRound && meta.isRoundFrame && meta.simulated) {
        const w = previous.world;
        const r = mirror.stepFrame(w, i0.x, i0.y, i0.h, i1.x, i1.y, i1.h);
        frames++;
        if (r.uncertain) {
          uncertainFrames++;
        } else {
          const diffs = [];
          BALL_FIELDS.forEach((f) => {
            if (w.ball[f] !== now.ball[f]) diffs.push(`ball.${f}: mirror=${w.ball[f]} engine=${now.ball[f]}`);
          });
          [['p1', w.p1, now.p1], ['p2', w.p2, now.p2]].forEach(([name, a, b]) => {
            PLAYER_FIELDS.forEach((f) => {
              if (a[f] !== b[f]) diffs.push(`${name}.${f}: mirror=${a[f]} engine=${b[f]}`);
            });
          });
          if (diffs.length > 0) {
            badFrames++;
            diffs.forEach((d) => {
              const key = d.split(':')[0];
              fieldCounts[key] = (fieldCounts[key] || 0) + 1;
            });
            if (samples.length < 3) samples.push({ seed, diffs });
          }
        }
      }
      previous = { wasRound: meta.isRoundFrame, world: snapshotWorld(pv) };
    },
  });
}

console.log('');
console.log(`  compared frames : ${frames}`);
console.log(`  random-involved : ${uncertainFrames}  (공이 플레이어 중심 2px 이내 — 봇이 예측 불가)`);
console.log(`  MISMATCHED      : ${badFrames}`);
if (badFrames > 0) {
  console.log(`  per-field       : ${JSON.stringify(fieldCounts, null, 2)}`);
  samples.forEach((s) => {
    console.log(`\n  sample (seed ${s.seed}):`);
    s.diffs.slice(0, 8).forEach((d) => console.log(`    ${d}`));
  });
} else {
  console.log('  => 미러가 엔진과 완전히 일치한다.');
}
console.log('');
