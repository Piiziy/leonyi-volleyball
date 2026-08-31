/**
 * 특정 랠리의 첫 N프레임을 찍는다. "왜 저기서 점프하지?" 같은 눈에 띈 이상
 * 동작을 재현해 원인을 보기 위한 도구.
 *
 *   node serveTrace.js --bot Leonyi_v5.js --from 1 --to 3 --frames 34
 *   node serveTrace.js --bot Leonyi_v5.js --from 5 --to 5 --tune '{"WARMUP_TICKS":0}'
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
const file = args.bot || 'Leonyi_v5.js';
let src = readFileSync(resolve(REPO, 'src/code-here', file), 'utf8');
if (typeof args.tune === 'string') src += '\n;Object.assign(TUNE, ' + args.tune + ');';

const from = Number(args.from || 1);
const to = Number(args.to || 2);
const maxFrames = Number(args.frames || 34);

let rally = 1;          // 지금 진행 중인 랠리 번호
let framesInRally = 0;  // 그 랠리에서 실제로 시뮬레이션된 round 프레임 수
let prevTotal = 0;
let headerShown = -1;

runMatch({
  left: { kind: 'bot', decide: compileBot(src, file) },
  right: { kind: 'bot', decide: compileBot(src, file) },
  seed: Number(args.seed || 11),
  touchLimit: true,
  maxFrames: 40000,
  onFrame: (pv, meta) => {
    const total = pv.scores[0] + pv.scores[1];
    if (total !== prevTotal) { prevTotal = total; rally++; framesInRally = 0; }
    if (!meta.simulated || !meta.isRoundFrame) return;
    if (rally < from || rally > to) { framesInRally++; return; }
    if (framesInRally === 0 && headerShown !== rally) {
      headerShown = rally;
      console.log(`\n=== 랠리 #${rally}  서브: ${pv.isPlayer2Serve ? 'RIGHT' : 'LEFT'}  (스코어 ${pv.scores[0]}:${pv.scores[1]}) ===`);
      console.log('   f   ball(x,y)  v(x,y)   elp | L(x,y) st in | R(x,y) st in');
    }
    if (framesInRally < maxFrames) {
      const b = pv.physics.ball, p1 = pv.physics.player1, p2 = pv.physics.player2;
      const k0 = pv.keyboardArray[0], k1 = pv.keyboardArray[1];
      const mark = (p) => (p.state === 1 ? '점프' : p.state === 2 ? '스매' : p.state === 3 ? '다이' : p.state === 4 ? '누움' : '  ');
      console.log(
        `  ${String(framesInRally).padStart(3)} ` +
        `(${String(b.x).padStart(3)},${String(b.y).padStart(3)}) ` +
        `(${String(b.xVelocity).padStart(3)},${String(b.yVelocity).padStart(3)}) ` +
        `${String(b.expectedLandingPointX).padStart(4)} | ` +
        `(${String(p1.x).padStart(3)},${String(p1.y).padStart(3)}) ${mark(p1)} ` +
        `(${k0.xDirection},${k0.yDirection},${k0.powerHit}) | ` +
        `(${String(p2.x).padStart(3)},${String(p2.y).padStart(3)}) ${mark(p2)} ` +
        `(${k1.xDirection},${k1.yDirection},${k1.powerHit})`
      );
    }
    framesInRally++;
  },
});
