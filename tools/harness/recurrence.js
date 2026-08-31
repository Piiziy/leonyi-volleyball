/**
 * "한 세트(10점) 안에 상대 패턴을 배울 수 있는가?"를 재는 도구.
 *
 *   node recurrence.js --left Leonyi_v1.js --right Leonyi_v1.js --matches 20
 *
 * 상대 모델링이 성립하려면 두 가지가 필요하다:
 *   (1) 같은 상황이 한 세트 안에 다시 나와야 한다 (재현율)
 *   (2) 같은 상황에서 상대가 같은 행동을 해야 한다 (일관성)
 * 둘 다 측정한다. 재현율이 낮으면 표본이 아무리 많아도 배울 수 없다.
 *
 * 상황은 거칠게 버킷팅한다. 세밀하게 나눌수록 재현율이 떨어지므로, 실제로
 * 쓸 수 있는 해상도가 어디까지인지 세 가지 굵기로 함께 잰다.
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
const load = (f) =>
  f === 'ai' ? { kind: 'ai' } : { kind: 'bot', decide: compileBot(readFileSync(resolve(REPO, 'src/code-here', f), 'utf8'), f) };

const NET = 216;
const matches = Number(args.matches || 20);

// 굵기 세 단계. 숫자가 작을수록 거칠다(= 재현율은 높고 정보량은 적다).
const GRAINS = [
  { name: '거침  (공x 4칸, 낙하여부)', bx: 108, vy: 1, px: 216 },
  { name: '보통  (공x 8칸, 내x 4칸)', bx: 54, vy: 1, px: 108 },
  { name: '세밀  (공x 16칸, 내x 8칸, 속도)', bx: 27, vy: 1, px: 54 },
];

const stats = GRAINS.map(() => ({ decisions: 0, seenBefore: 0, consistent: 0, seenAndSame: 0 }));

for (let m = 0; m < matches; m++) {
  // 세트마다 기억을 지운다 -- 봇도 매치가 바뀌면 전역 상태가 초기화되기 때문.
  const memories = GRAINS.map(() => new Map());
  let prevOppState = 0;
  let prevBallVx = 0;

  runMatch({
    left: load(args.left || 'Leonyi_v1.js'),
    right: load(args.right || 'Leonyi_v1.js'),
    seed: 7000 + m,
    touchLimit: true,
    onFrame: (pv, meta) => {
      if (!meta.isRoundFrame || !meta.simulated) return;
      const b = pv.physics.ball;
      const opp = pv.physics.player2;  // 오른쪽을 "상대"로 본다
      const me = pv.physics.player1;

      // 상대의 "결정 이벤트" = 공을 실제로 친 순간. 그때의 상황과 결과를 기록한다.
      const hitNow = opp.isCollisionWithBallHappened;
      const justHit = hitNow && b.xVelocity !== prevBallVx;
      prevBallVx = b.xVelocity;
      prevOppState = opp.state;
      if (!justHit) return;

      // 결과 = 이 타격으로 공이 어디로 갔는가 (착지점을 4칸으로)
      const outcome = Math.floor(Math.max(0, Math.min(431, b.expectedLandingPointX)) / 108);

      GRAINS.forEach((g, i) => {
        const key = [
          Math.floor(b.x / g.bx),
          b.yVelocity > 0 ? 1 : 0,
          Math.floor(me.x / g.px),
          opp.state,
        ].join(':');
        const st = stats[i];
        st.decisions++;
        const mem = memories[i];
        if (mem.has(key)) {
          st.seenBefore++;
          if (mem.get(key) === outcome) st.seenAndSame++;
        }
        mem.set(key, outcome);
      });
    },
  });
}

console.log(`\n  ${args.left || 'Leonyi_v1.js'}  관점: 오른쪽 상대의 타격 결정을 관찰`);
console.log(`  ${matches} 세트 (세트마다 기억 초기화 — 실전과 동일)\n`);
console.log('  상황 해상도                        결정수   재본상황   재현율   그중 같은결과   예측정확도');
GRAINS.forEach((g, i) => {
  const s = stats[i];
  const recur = s.decisions ? (100 * s.seenBefore) / s.decisions : 0;
  const acc = s.seenBefore ? (100 * s.seenAndSame) / s.seenBefore : 0;
  console.log(
    `  ${g.name.padEnd(34)} ${String(s.decisions).padStart(5)}` +
    `   ${String(s.seenBefore).padStart(6)}   ${recur.toFixed(1).padStart(5)}%` +
    `   ${String(s.seenAndSame).padStart(9)}   ${acc.toFixed(1).padStart(6)}%`
  );
});
console.log(`\n  세트당 상대 타격 관측 ${(stats[0].decisions / matches).toFixed(1)}회`);
console.log('');
