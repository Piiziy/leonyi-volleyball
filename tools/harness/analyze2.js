/**
 * 도메인 분석 2 — "못 받는 공"의 조건을 정확히 확정한다.
 *
 * 도달 모델을 현실적으로 다듬는다:
 *   - 상대도 1틱(3프레임) 지연을 겪고, 판단 자체에도 최소 1프레임이 든다
 *   - 걷기 6px/f, 다이빙 8px/f (단 다이빙은 지상 state 0에서만 시작 가능)
 *   - 히트박스 반폭 32px
 *   => 닿을 수 있는 범위 = SPEED * max(0, f - REACTION) + 32
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const core = readFileSync(resolve(HERE, 'botsrc/core.js'), 'utf8');
// eslint-disable-next-line no-new-func
const M = new Function(core + '\n;return {stepBallWorld};')();

const NET = 216;
const REACTION = 4;   // 1프레임 지연 + 3프레임 유지 = 실질 반응 지연
const DIVE_SPEED = 8;
const HALF = 32;

const reach = (f) => DIVE_SPEED * Math.max(0, f - REACTION) + HALF;

const shot = (bx, by, bvy, ix, iy, fromLeft) => {
  const b = {
    x: bx, y: by,
    xVelocity: fromLeft ? (Math.abs(ix) + 1) * 10 : -(Math.abs(ix) + 1) * 10,
    yVelocity: Math.abs(bvy) * iy * 2,
  };
  const startLeft = bx < NET;
  let crossed = false;
  for (let f = 1; f <= 300; f++) {
    const g = M.stepBallWorld(b);
    if ((b.x < NET) !== startLeft) crossed = true;
    if (g) return { landing: b.x, frames: f, cleared: crossed };
  }
  return { landing: b.x, frames: 300, cleared: false };
};

/** 이 접촉 상태에서 낼 수 있는 최선의 여유 (상대가 oppX에 있을 때) */
const bestMargin = (bx, by, bvy, oppX) => {
  let best = null;
  for (const ix of [0, 1]) {
    for (const iy of [-1, 0, 1]) {
      const r = shot(bx, by, bvy, ix, iy, bx < NET);
      if (!r.cleared || r.landing <= NET) continue;   // 왼쪽 기준: 넘겨야 한다
      const m = Math.abs(r.landing - oppX) - reach(r.frames);
      if (best === null || m > best.margin) best = { ix, iy, margin: m, ...r };
    }
  }
  return best;
};

// === A) 상대 위치별로, 접촉 지점이 어디여야 이기는가 =========================
console.log('\n=== A) 접촉 지점 지도 (왼쪽 공격, 낙하속도 12) ===');
console.log('   여유가 양수 = 상대가 원리적으로 못 받음. 숫자는 여유(px).\n');
const oppPositions = [248, 280, 324, 368, 400];
process.stdout.write('   접촉x\\상대x ');
oppPositions.forEach((o) => process.stdout.write(String(o).padStart(7)));
console.log('     ← 상대 위치');
for (let bx = 130; bx <= 210; bx += 10) {
  process.stdout.write(`   ${String(bx).padStart(5)}       `);
  oppPositions.forEach((o) => {
    let best = -999;
    for (const by of [80, 100, 120, 140]) {
      const r = bestMargin(bx, by, 12, o);
      if (r && r.margin > best) best = r.margin;
    }
    const cell = best > 0 ? `+${best.toFixed(0)}` : best.toFixed(0);
    process.stdout.write(cell.padStart(7));
  });
  console.log('');
}

// === B) 접촉 높이가 얼마나 중요한가 ==========================================
console.log('\n=== B) 접촉 높이별 최선 여유 (상대는 자기 코트 중앙 324) ===');
console.log('   접촉y   최선 접촉x   조합       착지   비행f   여유');
for (const by of [40, 60, 80, 100, 120, 140, 160, 180]) {
  let best = null;
  for (let bx = 120; bx <= 212; bx += 2) {
    const r = bestMargin(bx, by, 12, 324);
    if (r && (best === null || r.margin > best.margin)) best = { bx, ...r };
  }
  if (!best) { console.log(`   ${String(by).padStart(4)}    (없음)`); continue; }
  console.log(
    `   ${String(by).padStart(4)}    ${String(best.bx).padStart(8)}   x=${best.ix} y=${String(best.iy).padStart(2)}` +
    `   ${String(best.landing).padStart(6)}   ${String(best.frames).padStart(5)}   ` +
    `${(best.margin > 0 ? '+' : '') + best.margin.toFixed(0)}`
  );
}

// === C) 점프 궤적과 겹쳐보기 — 실제로 그 높이에서 칠 수 있나 ==================
console.log('\n=== C) 점프 궤적 (땅 244에서 y=-16으로 점프) ===');
console.log('   프레임   내 y   히트박스 상단   그 높이에서 칠 수 있는 공 y');
let y = 244, vy = -16;
for (let f = 1; f <= 32; f++) {
  y += vy; vy += 1;
  if (y > 244) break;
  if (f % 3 === 0 || f === 1) {
    console.log(`   ${String(f).padStart(5)}   ${String(y).padStart(4)}   ${String(y - 32).padStart(11)}   ${y - 32} ~ ${y + 32}`);
  }
}
console.log('');
