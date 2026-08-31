/**
 * 봇이 점프해서 공격하는 장면을 프레임 단위로 찍는다. 승률 숫자만으로는
 * "왜" 실패하는지 알 수 없을 때 쓴다.
 *
 *   node trace.js --bot LabA_v1.js --opp ai --rallies 3
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
const botFile = args.bot || 'LabA_v1.js';
const wanted = Number(args.rallies || 3);

const src = readFileSync(resolve(REPO, 'src/code-here', botFile), 'utf8');
const opp = args.opp === 'ai' || !args.opp
  ? { kind: 'ai' }
  : { kind: 'bot', decide: compileBot(readFileSync(resolve(REPO, 'src/code-here', args.opp), 'utf8'), args.opp) };

let shown = 0;
let buffer = [];
let inJump = false;
let jumpStart = -1;
let frame = 0;

runMatch({
  left: { kind: 'bot', decide: compileBot(src, botFile) },
  right: opp,
  seed: 4242,
  touchLimit: true,
  maxFrames: 40000,
  onFrame: (pv, meta) => {
    if (shown >= wanted) return;
    if (!meta.isRoundFrame || !meta.simulated) return;
    frame++;
    const p = pv.physics.player1;   // LEFT = 우리 봇
    const b = pv.physics.ball;
    const k = pv.keyboardArray[0];

    const row =
      `  f${String(frame).padStart(5)}  me(${String(p.x).padStart(3)},${String(p.y).padStart(3)}) st${p.state}` +
      `  ball(${String(b.x).padStart(3)},${String(b.y).padStart(3)}) v(${String(b.xVelocity).padStart(3)},${String(b.yVelocity).padStart(3)})` +
      ` elp=${String(b.expectedLandingPointX).padStart(3)} pw=${b.isPowerHit ? 'Y' : '.'}` +
      `  in(${k.xDirection},${k.yDirection},${k.powerHit})  col=${p.isCollisionWithBallHappened ? 'Y' : '.'}`;

    if (!inJump && p.state === 1) { inJump = true; jumpStart = frame; buffer = []; }
    if (inJump) {
      buffer.push(row);
      const landed = b.y >= 250;
      if (landed || frame - jumpStart > 70) {
        inJump = false;
        const side = b.punchEffectX < 216 ? '우리 코트(실점)' : '상대 코트(득점)';
        console.log(`\n=== 점프 #${shown + 1} (f${jumpStart}~) → 착지: ${landed ? side : '(추적 종료)'} ===`);
        buffer.slice(0, 45).forEach((r) => console.log(r));
        shown++;
      }
    }
  },
});
