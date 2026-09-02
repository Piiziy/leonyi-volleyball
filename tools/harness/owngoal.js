/**
 * 자책골 해부 — 내가 친 공이 내 코트에 떨어진 순간을 그대로 찍는다.
 *
 *   node owngoal.js [봇] [상대] [경기수]
 *
 * ★ 왜 필요한가
 *   anomaly.js 가 "내가 친 공이 내 코트에 낙하 11.1%" 를 셌는데, 진영별로
 *   **왼쪽 0.0% / 오른쪽 22.4%** 였다. 자기 대전이라 양쪽이 같은 봇인데
 *   한쪽만 자책한다. 비율만으로는 원인을 알 수 없고, 그 순간의 상태를 봐야
 *   한다. 실점의 40% 이상이 여기서 나온다(세트당 약 1.4점 / 실점 3.33점).
 *
 *   찍는 것: 마지막 접촉 시점의 공 위치·속도, 내 위치·상태, 그때 낸 입력.
 *   같은 모양이 반복되면 그게 원인이다.
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

const botFile = process.argv[2] || 'Leonyi_v12.js';
const oppFile = process.argv[3] || botFile;
const matches = Number(process.argv[4] || 6);
const load = (f) => f === 'ai'
  ? { kind: 'ai' }
  : { kind: 'bot', decide: compileBot(readFileSync(resolve(REPO, 'src/code-here', f), 'utf8'), f) };

const rows = [];
let points = 0;

for (let m = 0; m < matches; m++) {
  for (const flipped of [false, true]) {
    const meIdx = flipped ? 1 : 0;
    const myCourtLeft = meIdx === 0;
    let prevCollide = [false, false];
    let lastTouch = null;       // 마지막으로 공을 만진 쪽의 정보
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
        ps.forEach((p, i) => {
          const c = p.isCollisionWithBallHappened;
          if (c && !prevCollide[i]) {
            const k = pv.keyboardArray[i];
            lastTouch = {
              who: i,
              ball: { x: Math.round(b.x), y: Math.round(b.y),
                vx: Math.round(b.xVelocity), vy: Math.round(b.yVelocity) },
              me: { x: Math.round(p.x), y: Math.round(p.y), state: p.state },
              act: { x: k.xDirection, y: k.yDirection, hit: k.powerHit },
              // 공이 네트 어느 쪽에 있었나 -- 파워히트 방향을 정하는 값이다
              ballLeftOfNet: b.x < NET,
            };
          }
          prevCollide[i] = c;
        });

        const total = pv.scores[0] + pv.scores[1];
        if (total === prevTotal) return;
        prevTotal = total;
        points++;
        if (lastTouch === null || lastTouch.who !== meIdx) return;
        const byTouchLimit = b.y < 250;
        if (byTouchLimit) return;
        const landedOnMe = (b.punchEffectX < NET) === myCourtLeft;
        if (!landedOnMe) return;
        rows.push({ side: myCourtLeft ? 'L' : 'R', landed: Math.round(b.punchEffectX), ...lastTouch });
      },
    });
  }
}

console.log(`\n  자책골 해부 — ${botFile} vs ${oppFile}, ${matches * 2} sets`);
console.log(`  전체 득점 ${points} 중 자책 ${rows.length} (${(100 * rows.length / points).toFixed(1)}%)\n`);
console.log('  진영  낙하   공(x,y)      공속도(vx,vy)  내위치(x,y) 상태  입력(x,y,hit)  공이네트왼쪽');
console.log('  ' + '-'.repeat(94));
rows.slice(0, 30).forEach((r) => {
  console.log(
    `  ${r.side.padEnd(4)} ${String(r.landed).padStart(5)}  ` +
    `(${String(r.ball.x).padStart(3)},${String(r.ball.y).padStart(3)})   ` +
    `(${String(r.ball.vx).padStart(4)},${String(r.ball.vy).padStart(4)})     ` +
    `(${String(r.me.x).padStart(3)},${String(r.me.y).padStart(3)})   ${r.me.state}    ` +
    `(${r.act.x},${r.act.y},${r.act.hit})        ${r.ballLeftOfNet ? 'Y' : 'N'}`
  );
});
if (rows.length > 30) console.log(`  ... 그리고 ${rows.length - 30}개 더`);

// 요약: 어떤 모양이 반복되는가
const tally = (f) => rows.reduce((a, r) => { const k = f(r); a[k] = (a[k] || 0) + 1; return a; }, {});
const show = (name, t) => {
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  console.log(`\n  ${name}`);
  Object.keys(t).sort((a, b) => t[b] - t[a]).forEach((k) =>
    console.log(`    ${String(k).padEnd(28)} ${t[k]}  (${(100 * t[k] / total).toFixed(1)}%)`));
};
show('진영', tally((r) => r.side));
show('접촉 시 내 상태 (0=서기 1=점프 2=파워히트 3=다이빙)', tally((r) => r.me.state));
show('그때 낸 입력', tally((r) => `x=${r.act.x} y=${r.act.y} hit=${r.act.hit}`));
show('공이 네트 왼쪽에 있었나 / 내 진영', tally((r) => `${r.side} · 공네트왼쪽=${r.ballLeftOfNet ? 'Y' : 'N'}`));
show('접촉 시 공 높이', tally((r) => r.ball.y < 100 ? '높음(<100)' : r.ball.y < 180 ? '중간(100~180)' : '낮음(>180)'));
console.log('');
