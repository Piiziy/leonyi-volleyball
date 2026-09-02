/**
 * 수비 대기 위치 스윕 — "공이 넘어오기 전에 어디에 서 있어야 하는가".
 *
 *   node stand.js [봇] [시나리오당프레임리드]
 *
 * ★ 왜 이 실험인가
 *   coverage.js 로 알아낸 것: 우리 봇 계보(v1/v7/v10)의 수비 커버리지가 95.3%
 *   로 **완전히 같다**. 못 받는 공은 전부 "3프레임마다 결정 + 1프레임 지연"
 *   때문에 물리적으로 못 가는 공이다. 내장 AI 는 physics 안에서 매 프레임
 *   지연 없이 움직이므로 받지만, 제출 봇은 누구도 그럴 수 없다 -- 즉
 *   **탐색을 아무리 잘 해도 그 공들은 못 받는다.**
 *
 *   그러면 남은 조종 변수는 하나뿐이다: **출발 위치.** 지연이 3프레임이면
 *   18px 을 손해 보는데, 미리 18px 유리한 자리에 서 있으면 그만큼 되돌린다.
 *   이 도구는 대기 위치를 격자로 바꿔 가며 커버리지를 재서, 어디가 가장
 *   많은 공을 받아 내는지 직접 찾는다.
 *
 *   결과는 botsrc/common.js 의 bestDefensiveStand 가 목표로 삼을 자리다.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PikachuVolleyball } from './engine/pikavolley.js';
import { setCustomRng } from './engine/rand.js';
import { makeRng } from './match.js';
import { HarnessBotInput, AiInput, compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const NET = 216;
const GROUND_Y = 244;
const BALL_GROUND_Y = 252;

const botFile = process.argv[2] || 'Leonyi_v10.js';
const SRC = readFileSync(resolve(REPO, 'src/code-here', botFile), 'utf8');

const LEAD_FRAMES = 12;
const rewind = (sc) => {
  let x = NET, y = sc.y, vx = -sc.vx, vy = sc.vy;
  for (let i = 0; i < LEAD_FRAMES; i++) {
    const px = x - vx, pvy = vy - 1, py = y - pvy;
    if (px > 412 || py < 20 || py > 240) break;
    x = px; y = py; vy = pvy;
  }
  return { x, y, vx, vy };
};

const setup = (ph, sc, startX) => {
  const st = rewind(sc);
  Object.assign(ph.ball, { x: st.x, y: st.y, xVelocity: st.vx, yVelocity: st.vy,
    punchEffectRadius: 0, isPowerHit: false });
  Object.assign(ph.player1, { x: startX, y: GROUND_Y, yVelocity: 0, state: 0,
    frameNumber: 0, isCollisionWithBallHappened: false, lyingDownDurationLeft: -1,
    isComputer: false });
  Object.assign(ph.player2, { x: 324, y: GROUND_Y, yVelocity: 0, state: 0,
    frameNumber: 0, isCollisionWithBallHappened: false, isComputer: false });
};

const fresh = () => { setCustomRng(makeRng(12345)); return new PikachuVolleyball({ addChild: () => {} }, {}); };

/** 봇 없이 굴려 우리(왼쪽) 코트에 떨어지는 시나리오만 남긴다 */
const validate = (sc) => {
  const ph = fresh().physics;
  setup(ph, sc, 108);
  [ph.player1, ph.player2].forEach((p) => { p.y = -9999; });
  const idle = [new AiInput(), new AiInput()];
  for (let f = 0; f < 200; f++) {
    idle.forEach((k) => k.getInput());
    ph.runEngineForNextFrame(idle);
    if (ph.ball.y >= BALL_GROUND_Y) return ph.ball.x < NET ? { ok: true, landing: ph.ball.x } : { ok: false };
  }
  return { ok: false };
};

const trial = (sc, startX) => {
  const realRandom = Math.random;
  Math.random = makeRng(777);
  try {
    const ph = fresh().physics;
    setup(ph, sc, startX);
    const meta = { scores: [0, 0], isPlayer2Serve: false };
    const input = new HarnessBotInput({ side: 'LEFT', physics: ph, getMeta: () => meta,
      decide: compileBot(SRC, botFile) });
    const arr = [input, new AiInput()];
    let touched = false;
    for (let f = 0; f < 200; f++) {
      arr.forEach((k) => k.getInput());
      ph.runEngineForNextFrame(arr);
      if (ph.player1.isCollisionWithBallHappened) touched = true;
      if (touched && ph.ball.x > NET) return true;
      if (ph.ball.y >= BALL_GROUND_Y) return false;
    }
    return false;
  } finally { Math.random = realRandom; }
};

const YS  = [40, 70, 100, 130, 160, 190];
const VXS = [4, 6, 8, 10, 12, 16, 20];
const VYS = [-12, -6, -2, 0, 2, 6, 12, 20, 28];
const scenarios = [];
YS.forEach((y) => VXS.forEach((vx) => VYS.forEach((vy) => {
  const v = validate({ y, vx, vy });
  if (v.ok) scenarios.push({ y, vx, vy, landing: v.landing });
})));

// 왼쪽 코트에서 설 수 있는 범위는 32 ~ 184
const POSITIONS = [40, 56, 72, 88, 104, 120, 136, 152, 168, 184];

console.log(`\n  대기 위치 스윕 — ${botFile}, 유효 시나리오 ${scenarios.length}개\n`);
console.log('  대기x   돌려보냄     네트쪽(낙하>150)  가운데(80~150)  깊은쪽(<80)');
console.log('  ' + '-'.repeat(72));

const near = scenarios.filter((s) => s.landing > 150).length;
const mid  = scenarios.filter((s) => s.landing >= 80 && s.landing <= 150).length;
const deep = scenarios.filter((s) => s.landing < 80).length;
let bestPos = null, bestN = -1;
POSITIONS.forEach((px) => {
  let n = 0, a = 0, b = 0, c = 0;
  scenarios.forEach((sc) => {
    if (!trial(sc, px)) return;
    n++;
    if (sc.landing > 150) a++; else if (sc.landing >= 80) b++; else c++;
  });
  if (n > bestN) { bestN = n; bestPos = px; }
  const pct = (v, t) => t ? (100 * v / t).toFixed(1).padStart(5) + '%' : '    -';
  console.log(`  ${String(px).padStart(5)}   ${pct(n, scenarios.length)}        ` +
    `${pct(a, near)}          ${pct(b, mid)}         ${pct(c, deep)}`);
});
console.log(`\n  ★ 가장 많이 받아 내는 대기 위치: x = ${bestPos}  (${(100 * bestN / scenarios.length).toFixed(1)}%)`);
console.log(`     시나리오 분포: 네트쪽 ${near}  가운데 ${mid}  깊은쪽 ${deep}`);
console.log('');
