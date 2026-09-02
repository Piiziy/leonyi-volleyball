/**
 * 수비 커버리지 전수 조사 — "이런 공이 넘어오면 받는가"를 격자로 다 돌린다.
 *
 *   node coverage.js [기준봇] [비교봇들,쉼표구분]
 *   node coverage.js Leonyi_v10.js Leonyi_v7.js,Leonyi_v1.js,ai
 *
 * ★ 왜 필요한가
 *   지금까지의 측정은 전부 **내 계보의 봇끼리** 붙인 것이다(v1/v7/LabA/LabC +
 *   내장 AI). 대회 상대는 남이 짠 봇이고, 실제로 무서운 것은 "더 센 봇"이
 *   아니라 **누구나 우연히 밟을 수 있는 구멍**이다. 구멍은 상대 없이도 잴 수
 *   있다: 공 상태를 격자로 만들어 놓고 받는지 보면 된다.
 *
 *   판정에 오라클 공식을 쓰지 않는다. "물리적으로 받을 수 있었는가"를 식으로
 *   재려다 틀리면 거짓 경보만 쌓인다. 대신 **다른 봇을 같은 상태에 넣는다.**
 *   v1 이나 내장 AI 가 받는 공을 v10 이 못 받으면, 그건 논쟁의 여지 없이
 *   우리 봇의 구멍이다.
 *
 * 시나리오 만드는 법
 *   공을 네트 바로 위(x = 216)에 놓고 우리 코트로 보낸다. 속도는 실제 엔진이
 *   만들어 내는 값의 범위를 쓴다 -- 파워히트는 xVelocity 가 ±10/±20 이고
 *   yVelocity 가 |v|*2 라, 넘어오는 공은 대체로 이 안에 들어온다.
 *   물리는 봇을 넣지 않은 채로 먼저 한 번 굴려 **우리 코트에 떨어지는 공만**
 *   남긴다(네트에 맞거나 상대 코트로 되돌아가는 조합은 시나리오가 아니다).
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

const baseBot = process.argv[2] || 'Leonyi_v10.js';
const others = (process.argv[3] || 'Leonyi_v7.js,Leonyi_v1.js,ai').split(',');

// ★ 시나리오마다 **새 봇**을 쓴다. 봇은 틱을 세고, 물리가 예상과 다르면
//   안전 모드로 내려가는 감시견을 갖고 있다. 인스턴스를 돌려 쓰면 시나리오가
//   바뀔 때마다 공이 순간이동하는 것을 "엔진이 바뀌었다"로 읽고 안전 모드에
//   빠진다 -- 실제로 그래서 없는 구멍이 2개 나왔다.
const SOURCE = {};
const load = (f) => {
  if (f === 'ai') return { kind: 'ai' };
  if (SOURCE[f] === undefined) SOURCE[f] = readFileSync(resolve(REPO, 'src/code-here', f), 'utf8');
  return { kind: 'bot', decide: compileBot(SOURCE[f], f) };
};

/**
 * 네트 통과 상태에서 LEAD_FRAMES 만큼 되감는다. 상대 코트 밖으로 나가거나
 * 천장/바닥을 넘으면 거기서 멈춘다.
 */
const LEAD_FRAMES = 12;
const rewind = (sc, iAmLeft) => {
  let x = NET;
  let y = sc.y;
  let vx = iAmLeft ? -sc.vx : sc.vx;
  let vy = sc.vy;
  for (let i = 0; i < LEAD_FRAMES; i++) {
    const px = x - vx;
    const pvy = vy - 1;              // 앞 프레임의 수직 속도 (중력 +1 의 역)
    const py = y - pvy;
    const outside = iAmLeft ? px > 432 - 20 : px < 20;
    if (outside || py < 20 || py > 240) break;
    x = px; y = py; vy = pvy;
  }
  return { x, y, vx, vy };
};

/**
 * 한 시나리오를 끝까지 굴린다. 상대편은 세워만 두고 아무것도 하지 않는다.
 * (상대가 움직이면 "우리가 못 받았다"가 상대 탓인지 우리 탓인지 섞인다.)
 *
 * @return {{touched:boolean, returned:boolean, frames:number}}
 */
const runScenario = (spec, sc, iAmLeft, seed) => {
  setCustomRng(makeRng(seed));
  const realRandom = Math.random;
  Math.random = makeRng(seed ^ 0x5bf03635);
  try {
    const pv = new PikachuVolleyball({ addChild: () => {} }, {});
    const ph = pv.physics;
    const meIdx = iAmLeft ? 0 : 1;
    const me = iAmLeft ? ph.player1 : ph.player2;
    const opp = iAmLeft ? ph.player2 : ph.player1;

    // ★ 공을 네트에서 바로 시작하면 봇이 불리하다. 봇은 3프레임마다 한 번
    //   결정하고 그 결과가 1프레임 뒤에 적용되므로, 비행이 5프레임인 공은
    //   결정 기회가 한 번뿐이다. 실전에서는 상대가 친 순간부터 공이 보인다.
    //   그래서 자유낙하를 거꾸로 풀어 상대 코트에서 시작한다(중력 +1의 역).
    const st = rewind(sc, iAmLeft);
    Object.assign(ph.ball, {
      x: st.x, y: st.y, xVelocity: st.vx, yVelocity: st.vy,
      punchEffectRadius: 0, isPowerHit: false,
    });
    // 나: 내 코트 한가운데에서 서 있는 상태로 시작
    Object.assign(me, {
      x: iAmLeft ? 108 : 324, y: GROUND_Y, yVelocity: 0, state: 0,
      frameNumber: 0, normalStatus: 0, isCollisionWithBallHappened: false,
      lyingDownDurationLeft: -1, isComputer: spec.kind === 'ai',
    });
    Object.assign(opp, {
      x: iAmLeft ? 324 : 108, y: GROUND_Y, yVelocity: 0, state: 0,
      frameNumber: 0, isCollisionWithBallHappened: false, isComputer: false,
    });

    const meta = { scores: [0, 0], isPlayer2Serve: false };
    const input = spec.kind === 'ai'
      ? new AiInput()
      : new HarnessBotInput({ side: iAmLeft ? 'LEFT' : 'RIGHT', physics: ph,
          getMeta: () => meta, decide: spec.decide });
    const idle = new AiInput();
    const arr = meIdx === 0 ? [input, idle] : [idle, input];

    let touched = false;
    let returned = false;
    let f = 0;
    for (; f < 200; f++) {
      arr.forEach((k) => k.getInput());
      ph.runEngineForNextFrame(arr);
      if (me.isCollisionWithBallHappened) touched = true;
      const onOpp = iAmLeft ? ph.ball.x > NET : ph.ball.x < NET;
      if (touched && onOpp) { returned = true; break; }
      if (ph.ball.y >= BALL_GROUND_Y) break;   // 바닥에 닿음
    }
    return { touched, returned, frames: f };
  } finally {
    Math.random = realRandom;
  }
};

/** 봇 없이 공만 굴려 우리 코트에 떨어지는 시나리오인지 본다 */
const isValidScenario = (sc, iAmLeft) => {
  setCustomRng(makeRng(1));
  const pv = new PikachuVolleyball({ addChild: () => {} }, {});
  const ph = pv.physics;
  const st = rewind(sc, iAmLeft);
  Object.assign(ph.ball, {
    x: st.x, y: st.y, xVelocity: st.vx, yVelocity: st.vy,
    punchEffectRadius: 0, isPowerHit: false,
  });
  // 두 선수를 코트 밖으로 치워 접촉이 없게 한다
  [ph.player1, ph.player2].forEach((p) => { p.y = -9999; p.isComputer = false; });
  const idle = [new AiInput(), new AiInput()];
  for (let f = 0; f < 200; f++) {
    idle.forEach((k) => k.getInput());
    ph.runEngineForNextFrame(idle);
    if (ph.ball.y >= BALL_GROUND_Y) {
      const landedMine = iAmLeft ? ph.ball.x < NET : ph.ball.x > NET;
      return landedMine ? { ok: true, flight: f, landing: ph.ball.x } : { ok: false };
    }
  }
  return { ok: false };
};

// --- 격자 -------------------------------------------------------------------
// 네트를 넘는 높이(y), 수평 속도(vx), 수직 속도(vy).
// vx/vy 는 파워히트가 실제로 만드는 값(±10/±20, |v|*2)을 포함하도록 잡았다.
const YS  = [40, 70, 100, 130, 160, 190];
const VXS = [4, 6, 8, 10, 12, 16, 20];
const VYS = [-12, -6, -2, 0, 2, 6, 12, 20, 28];

const scenarios = [];
[true, false].forEach((iAmLeft) => {
  YS.forEach((y) => VXS.forEach((vx) => VYS.forEach((vy) => {
    const sc = { y, vx, vy };
    const v = isValidScenario(sc, iAmLeft);
    if (v.ok) scenarios.push({ ...sc, iAmLeft, flight: v.flight, landing: v.landing });
  })));
});

const bots = [baseBot, ...others];
bots.forEach(load);           // 소스 캐시를 채운다

const stat = {};
bots.forEach((b) => { stat[b] = { touched: 0, returned: 0 }; });
const holes = [];

scenarios.forEach((sc) => {
  const r = {};
  bots.forEach((b) => {
    r[b] = runScenario(load(b), sc, sc.iAmLeft, 12345);
    if (r[b].touched) stat[b].touched++;
    if (r[b].returned) stat[b].returned++;
  });
  // 구멍: 기준봇은 못 돌려보냈는데 다른 봇 중 하나는 돌려보낸 시나리오
  if (!r[baseBot].returned) {
    const savedBy = others.filter((b) => r[b].returned);
    if (savedBy.length > 0) holes.push({ sc, savedBy, base: r[baseBot] });
  }
});

console.log(`\n  수비 커버리지 — 유효 시나리오 ${scenarios.length}개 (좌우 각각)\n`);
console.log('  봇                     닿음      돌려보냄');
console.log('  ' + '-'.repeat(48));
bots.forEach((b) => {
  const t = (100 * stat[b].touched / scenarios.length).toFixed(1);
  const rr = (100 * stat[b].returned / scenarios.length).toFixed(1);
  console.log(`  ${b.padEnd(20)} ${t.padStart(6)}%   ${rr.padStart(6)}%`);
});

console.log(`\n  ★ ${baseBot} 만 못 돌려보낸 시나리오: ${holes.length}개`);
if (holes.length > 0) {
  console.log('  진영  높이  vx   vy   비행  낙하지점  닿음  받아낸 봇');
  console.log('  ' + '-'.repeat(66));
  holes.slice(0, 40).forEach((h) => {
    const s = h.sc;
    console.log(
      `  ${(s.iAmLeft ? 'L' : 'R').padEnd(4)} ${String(s.y).padStart(4)} ` +
      `${String(s.vx).padStart(3)} ${String(s.vy).padStart(4)} ` +
      `${String(s.flight).padStart(5)} ${String(Math.round(s.landing)).padStart(8)}  ` +
      `${(h.base.touched ? ' O' : ' X').padEnd(5)} ${h.savedBy.join(' ')}`
    );
  });
  if (holes.length > 40) console.log(`  ... 그리고 ${holes.length - 40}개 더`);
}
console.log('');
