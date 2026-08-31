/**
 * 도메인 분석 — 이 게임에서 "점수가 나는 조건"을 계산으로 확정한다.
 * 승률을 보고 파라미터를 더듬는 대신, 물리에서 직접 유도한다.
 *
 *   node analyze.js
 *
 * 묻는 것:
 *   1) 파워히트가 실제로 네트를 넘는가 (엔진의 자체 예측 함수는 틀릴 때가 있다)
 *   2) 어떤 접촉 상태에서 "상대가 원리적으로 못 받는" 공이 나오는가
 *   3) 그렇다면 리시브로 공을 어디에 띄워야 하는가
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const core = readFileSync(resolve(HERE, 'botsrc/core.js'), 'utf8');
// eslint-disable-next-line no-new-func
const M = new Function(
  core + '\n;return {stepBallWorld, predictLanding, predictPowerHitLanding, isCollision};'
)();

const NET = 216;
const GROUND = 432;

/**
 * 진짜 물리로 파워히트 결과를 낸다. 엔진의 predictPowerHitLanding은 네트 기둥
 * 높이를 구분하지 않는 버그가 있어서(원작 그대로) 실제와 다를 수 있다.
 * @return {{landing, frames, cleared}} cleared=false면 네트에 막혔다
 */
const truePowerHit = (bx, by, bvy, ix, iy, fromLeft) => {
  const b = {
    x: bx, y: by,
    xVelocity: fromLeft ? (Math.abs(ix) + 1) * 10 : -(Math.abs(ix) + 1) * 10,
    yVelocity: Math.abs(bvy) * iy * 2,
  };
  const startSide = bx < NET;
  let crossed = false;
  for (let f = 1; f <= 300; f++) {
    const grounded = M.stepBallWorld(b);
    if ((b.x < NET) !== startSide) crossed = true;
    if (grounded) return { landing: b.x, frames: f, cleared: crossed };
  }
  return { landing: b.x, frames: 300, cleared: crossed };
};

// === 1) 엔진의 자체 예측이 얼마나 틀리는가 ==================================
let checked = 0, wrong = 0, worst = 0;
for (let bx = 40; bx <= 392; bx += 8) {
  for (let by = 20; by <= 220; by += 10) {
    for (const bvy of [-10, 0, 5, 10, 16, 20]) {
      for (const ix of [0, 1]) {
        for (const iy of [-1, 0, 1]) {
          const truth = truePowerHit(bx, by, bvy, ix, iy, bx < NET);
          const engine = M.predictPowerHitLanding(ix, iy, { x: bx, y: by, xVelocity: 0, yVelocity: bvy });
          checked++;
          const d = Math.abs(truth.landing - engine);
          if (d > 2) { wrong++; worst = Math.max(worst, d); }
        }
      }
    }
  }
}
console.log('\n=== 1) 엔진의 파워히트 예측 함수 정확도 ===');
console.log(`  표본 ${checked}개 중 실제와 어긋남: ${wrong} (${((100 * wrong) / checked).toFixed(1)}%), 최대 오차 ${worst}px`);
console.log('  → 어긋나는 만큼이 우리의 우위다. 내장 AI와 대부분의 봇은 이 함수를 믿는다.');

// === 2) 상대가 못 받는 공이 나오는 접촉 상태 ================================
// 상대의 최대 이동력: 다이빙 8px/프레임 + 히트박스 32px.
// 착지까지 f프레임이면 |착지점 - 상대x| > 8f + 32 인 공은 원리적으로 못 받는다.
const reachRadius = (f) => 8 * f + 32;

console.log('\n=== 2) 왼쪽에서 때릴 때, 접촉 높이별 최선의 스매시 ===');
console.log('  (상대는 자기 코트 한가운데 324에 서 있다고 본다)');
console.log('  접촉y  접촉x   최선조합   착지    비행f  여유(초과px)  판정');
const oppX = 324;
for (const by of [40, 60, 80, 100, 120, 140, 160, 180, 200]) {
  let best = null;
  for (let bx = 120; bx <= 210; bx += 6) {
    for (const ix of [0, 1]) {
      for (const iy of [-1, 0, 1]) {
        const r = truePowerHit(bx, by, 12, ix, iy, true);
        if (!r.cleared || r.landing <= NET) continue;      // 넘겨야 의미가 있다
        const margin = Math.abs(r.landing - oppX) - reachRadius(r.frames);
        if (best === null || margin > best.margin) best = { bx, ix, iy, ...r, margin };
      }
    }
  }
  if (best === null) { console.log(`  ${String(by).padStart(4)}   (넘길 수 있는 조합 없음)`); continue; }
  console.log(
    `  ${String(by).padStart(4)}  ${String(best.bx).padStart(4)}   x=${best.ix} y=${String(best.iy).padStart(2)}` +
    `   ${String(best.landing).padStart(4)}   ${String(best.frames).padStart(4)}` +
    `   ${(best.margin >= 0 ? '+' : '') + best.margin.toFixed(0).padStart(5)}` +
    `      ${best.margin > 0 ? '못 받음 ★' : '받힘'}`
  );
}

// === 3) 네트에서 얼마나 떨어진 곳에서 때려야 하나 ============================
console.log('\n=== 3) 접촉 x에 따른 최대 여유 (접촉 y=100, 낙하속도 12) ===');
console.log('  접촉x  네트거리  최선착지  여유');
for (let bx = 100; bx <= 212; bx += 8) {
  let best = null;
  for (const ix of [0, 1]) {
    for (const iy of [-1, 0, 1]) {
      const r = truePowerHit(bx, 100, 12, ix, iy, true);
      if (!r.cleared || r.landing <= NET) continue;
      const margin = Math.abs(r.landing - oppX) - reachRadius(r.frames);
      if (best === null || margin > best.margin) best = { ix, iy, ...r, margin };
    }
  }
  console.log(
    `  ${String(bx).padStart(4)}    ${String(NET - bx).padStart(4)}      ` +
    (best ? `${String(best.landing).padStart(4)}   ${(best.margin >= 0 ? '+' : '') + best.margin.toFixed(0)}` : '(못 넘김)')
  );
}
console.log('');
