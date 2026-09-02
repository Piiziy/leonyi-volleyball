/**
 * 공격 선택 검사 — "그때 더 좋은 공이 있었는가".
 *
 *   node attack.js [봇] [수비수] [경기수]
 *
 * ★ 왜 필요한가
 *   coverage.js 로 알아낸 것: v1/v7/v10 의 **수비 커버리지가 95.3% 로 완전히
 *   같다**. 그런데 버전끼리 붙이면 승률이 갈린다(v7 대 v1 은 83%). 그러면
 *   차이는 수비가 아니라 **공격**에서 나온다.
 *
 *   사용자가 두 번 지적한 것도 같은 이야기였다 -- "상대가 바로 받을 수 있는
 *   위치에 있는데도 스매시를 때린다". 그걸 눈으로 세지 않고 직접 잰다.
 *
 * 방법
 *   봇이 공에 닿는 프레임마다 세계를 통째로 복사해 두고, 그 자리에서 낼 수
 *   있는 **모든 수를 하나씩 다시 쳐 본다**(파워히트 각도 3 × 방향 2, 그리고
 *   안 치기). 각 결과를 진짜 수비 봇에게 먹여 돌려받는지 본다.
 *   판정은 시뮬레이션이 아니라 **실제 엔진 + 실제 봇**이다 -- 봇이 쓰는
 *   여유(margin) 식으로 채점하면 자기 식으로 자기를 채점하는 셈이라 무의미하다.
 *
 *   나오는 값
 *   한 수만 보면 안 된다는 것을 먼저 확인했다. 접촉의 **92.7% 는 애초에
 *   결정타가 없는 자리**였고, 결정타가 있는 7.3% 에서는 봇이 이미 98.3% 를
 *   맞혔다. 그러니 "지금 죽이느냐"로 채점하면 개선 여지가 안 보인다.
 *   그래서 각 수를 **랠리가 끝날 때까지** 굴린다 -- 내가 넘긴 다음 상대가
 *   치고 내가 받는 것까지 진짜 봇으로 이어서, 그 점을 누가 따는지 본다.
 *   사용자가 지적한 장면("겨우 닿아서 넘겼더니 바로 강 스매시가 돌아온다")이
 *   정확히 여기에 잡힌다.
 *
 *   나오는 값
 *     실제 득점률   내가 실제로 친 수로 랠리를 이긴 비율
 *     최선 득점률   그 자리에서 최선의 수를 뒀다면 이겼을 비율
 *     ★ 격차       둘의 차이. 이게 탐색이 놓치고 있는 양이다.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PikachuVolleyball } from './engine/pikavolley.js';
import { setCustomRng } from './engine/rand.js';
import { runMatch, makeRng } from './match.js';
import { HarnessBotInput, AiInput, compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const NET = 216;
const BALL_GROUND_Y = 252;

const botFile = process.argv[2] || 'Leonyi_v10.js';
const defFile = process.argv[3] || botFile;
const matches = Number(process.argv[4] || 3);
const SRC = {};
const src = (f) => (SRC[f] = SRC[f] || readFileSync(resolve(REPO, 'src/code-here', f), 'utf8'));
const mk = (f) => ({ kind: 'bot', decide: compileBot(src(f), f) });

const BALL_KEYS = ['x','y','xVelocity','yVelocity','expectedLandingPointX','punchEffectRadius',
  'isPowerHit','punchEffectX','punchEffectY','previousX','previousPreviousX','previousY',
  'previousPreviousY','rotation','fineRotation'];
const PLAYER_KEYS = ['x','y','yVelocity','state','frameNumber','normalStatus','divingDirection',
  'lyingDownDurationLeft','isCollisionWithBallHappened','delayBeforeNextFrame','isComputer'];
const grab = (o, keys) => keys.reduce((a, k) => (a[k] = o[k], a), {});
const put = (o, snap) => Object.keys(snap).forEach((k) => { o[k] = snap[k]; });

const snapshot = (ph) => ({
  ball: grab(ph.ball, BALL_KEYS),
  p1: grab(ph.player1, PLAYER_KEYS),
  p2: grab(ph.player2, PLAYER_KEYS),
});

/** 고정 입력을 내는 키보드 대역 */
class Fixed extends AiInput {
  constructor(a) { super(); this.a = a; }
  getInput() { this.xDirection = this.a.x; this.yDirection = this.a.y; this.powerHit = this.a.hit; }
}

/**
 * 저장해 둔 상태에서 내가 `act` 를 3프레임 유지하고, 그 뒤로는 **양쪽 다 진짜
 * 봇**이 두게 해서 랠리가 끝날 때까지 굴린다.
 * @return {{win:boolean}} win = 이 점을 내가 땄다
 */
const replay = (snap, iAmLeft, act) => {
  const realRandom = Math.random;
  Math.random = makeRng(31337);
  try {
    setCustomRng(makeRng(31337));
    const ph = new PikachuVolleyball({ addChild: () => {} }, {}).physics;
    put(ph.ball, snap.ball); put(ph.player1, snap.p1); put(ph.player2, snap.p2);
    ph.player1.isComputer = false; ph.player2.isComputer = false;
    const meIdx = iAmLeft ? 0 : 1;
    const meta = { scores: [0, 0], isPlayer2Serve: false };
    const def = new HarnessBotInput({ side: iAmLeft ? 'RIGHT' : 'LEFT', physics: ph,
      getMeta: () => meta, decide: compileBot(src(defFile), defFile) });
    // 내 쪽: 3프레임은 검사할 수를 그대로 내고, 그 뒤에는 내 봇이 이어서 둔다.
    const myBot = new HarnessBotInput({ side: iAmLeft ? 'LEFT' : 'RIGHT', physics: ph,
      getMeta: () => meta, decide: compileBot(src(botFile), botFile) });
    const arr = meIdx === 0 ? [new Fixed(act), def] : [def, new Fixed(act)];
    for (let f = 0; f < 400; f++) {
      if (f === 3) arr[meIdx] = myBot;
      arr.forEach((k) => k.getInput());
      ph.runEngineForNextFrame(arr);
      if (ph.ball.y >= BALL_GROUND_Y) {
        const landedOnThem = iAmLeft ? ph.ball.x > NET : ph.ball.x < NET;
        return { win: landedOnThem };
      }
    }
    return { win: false };   // 안 끝나면 못 딴 것으로 본다(드물다)
  } finally { Math.random = realRandom; }
};

// 낼 수 있는 수: 파워히트 각도 3가지 × 좌우 3가지, 그리고 안 치기
const OPTIONS = [];
[-1, 0, 1].forEach((y) => [-1, 0, 1].forEach((x) => OPTIONS.push({ x, y, hit: 1 })));
[-1, 0, 1].forEach((x) => OPTIONS.push({ x, y: 0, hit: 0 }));

let contacts = 0, actualWins = 0, bestWins = 0, sameAsBest = 0;
const byAngle = { '-1': 0, '0': 0, '1': 0, 'none': 0 };
/** 최선의 수는 어떤 종류였나 (실제와 달랐던 경우만) */
const betterKind = { '스매시 아래': 0, '스매시 수평': 0, '스매시 위': 0, '안 치고 이동': 0 };
const KIND = (o) => o.hit === 1 ? (o.y === -1 ? '스매시 아래' : o.y === 0 ? '스매시 수평' : '스매시 위') : '안 치고 이동';

for (let m = 0; m < matches; m++) {
  let prev = null;
  let prevSnap = null;
  runMatch({
    left: mk(botFile), right: mk(defFile), seed: 4200 + m, touchLimit: true,
    onFrame: (pv, meta) => {
      if (!meta.simulated || !meta.isRoundFrame) return;
      const ph = pv.physics;
      const hit = ph.player1.isCollisionWithBallHappened && !prev;
      prev = ph.player1.isCollisionWithBallHappened;
      if (!hit || prevSnap === null) { prevSnap = snapshot(ph); return; }

      // 실제로 낸 입력
      const k = pv.keyboardArray[0];
      const actual = { x: k.xDirection, y: k.yDirection, hit: k.powerHit };
      contacts++;
      byAngle[actual.hit === 1 ? String(actual.y) : 'none']++;

      const got = replay(prevSnap, true, actual);
      if (got.win) actualWins++;
      let anyWin = false;
      let same = false;
      const winners = [];
      OPTIONS.forEach((o) => {
        if (replay(prevSnap, true, o).win) {
          anyWin = true;
          winners.push(o);
          if (o.x === actual.x && o.y === actual.y && o.hit === actual.hit) same = true;
        }
      });
      if (anyWin) bestWins++;
      if (!anyWin || got.win || same) sameAsBest++;
      if (anyWin && !got.win) winners.forEach((o) => { betterKind[KIND(o)]++; });
      prevSnap = snapshot(ph);
    },
  });
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0') + '%';
console.log(`\n  공격 선택 검사 — ${botFile} (수비: ${defFile}), ${matches} 세트\n`);
console.log(`  접촉                 ${contacts}`);
console.log(`  실제 득점률          ${pct(actualWins, contacts)}   (실제로 친 수로 랠리를 이긴 비율)`);
console.log(`  최선 득점률          ${pct(bestWins, contacts)}   (최선의 수를 뒀다면)`);
console.log(`  ★ 격차              ${(100 * (bestWins - actualWins) / contacts).toFixed(1)}%p  <- 탐색이 놓치는 양`);
console.log(`  최선과 일치          ${pct(sameAsBest, contacts)}`);
const tot = Object.values(betterKind).reduce((a, b) => a + b, 0);
if (tot > 0) {
  console.log('\n  놓친 자리에서 정답이었던 수:');
  Object.keys(betterKind).forEach((k) => {
    if (betterKind[k]) console.log(`    ${k.padEnd(14)} ${pct(betterKind[k], tot)}`);
  });
}
console.log(`\n  실제로 고른 각도:  아래(-1) ${pct(byAngle['-1'], contacts)}   ` +
  `수평(0) ${pct(byAngle['0'], contacts)}   위(1) ${pct(byAngle['1'], contacts)}   ` +
  `안 침 ${pct(byAngle['none'], contacts)}`);
console.log('');
