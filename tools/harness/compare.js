/**
 * Validation #2 -- frame-exact comparison against the real browser.
 *
 *   node compare.js browser-trace.json
 *
 * browser-trace.json is what the injected hook recorded in Chrome while the
 * game ran the REAL engine, the REAL round loop and the REAL Web Worker bots.
 * This replays the same match here and diffs every field of every frame.
 *
 * Only one input is replayed rather than re-derived: the serve sequence, which
 * is drawn from Math.random in the browser and so cannot be reproduced from a
 * seed. Everything else -- ball trajectory, expectedLandingPointX, collisions,
 * player animation state, and the per-frame input triples the bots produced --
 * is recomputed here and must match exactly.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from './match.js';
import { compileBot } from './botInput.js';
import { FIELDS, captureRow } from './traceRow.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BOT = 'Example_v1.js';

const browser = JSON.parse(readFileSync(process.argv[2] || 'browser-trace.json', 'utf8'));
if (!Array.isArray(browser) || browser.length === 0) {
  console.error('empty or malformed trace');
  process.exit(1);
}

const IS_PLAYER2_SERVE = FIELDS.indexOf('isPlayer2Serve');
// The serve for round N is already latched in isPlayer2Serve on every frame of
// round N, so the distinct values in order ARE the serve sequence.
const serveScript = browser.reduce(
  (acc, row) => (acc.length === 0 || acc[acc.length - 1] !== !!row[IS_PLAYER2_SERVE]
    ? [...acc, !!row[IS_PLAYER2_SERVE]]
    : acc),
  []
);

const source = readFileSync(resolve(REPO, 'src/code-here', BOT), 'utf8');
const side = () => ({ kind: 'bot', decide: compileBot(source, BOT) });

const mine = [];
runMatch({
  left: side(),
  right: side(),
  seed: 1,
  touchLimit: true, // main.js wires setUpTouchLimit unconditionally
  // serveScript deliberately NOT used: with the browser's Math.random replaced
  // by the same seeded generator, the harness has to DERIVE the same serves.
  serveScript: null,
  // 브라우저는 이미 만들어진 게임에 난수기를 갈아끼운다. 여기도 같은 시점에
  // 맞춰야 양쪽 난수 스트림의 시작점이 일치한다.
  seedAfterConstruction: true,
  maxFrames: browser.length + 10,
  onFrame: (pv) => {
    if (mine.length < browser.length) mine.push(captureRow(pv));
  },
});

const n = Math.min(browser.length, mine.length);
const mismatches = [];
const badFrames = new Set();
for (let i = 0; i < n; i++) {
  for (let f = 0; f < FIELDS.length; f++) {
    if (browser[i][f] !== mine[i][f]) {
      mismatches.push({ frame: i, field: FIELDS[f], browser: browser[i][f], harness: mine[i][f] });
      badFrames.add(i);
    }
  }
}
const perField = mismatches.reduce(
  (acc, m) => ({ ...acc, [m.field]: (acc[m.field] || 0) + 1 }),
  {}
);
console.log('');
console.log(`  frames with any mismatch: ${badFrames.size} / ${n}`);
if (badFrames.size > 0) {
  console.log(`  divergent frame indices: ${[...badFrames].slice(0, 20).join(', ')}${badFrames.size > 20 ? ' ...' : ''}`);
  console.log(`  per-field counts: ${JSON.stringify(perField)}`);
}

console.log('');
console.log(`  browser frames: ${browser.length}   harness frames: ${mine.length}   compared: ${n}`);
console.log(`  serve sequence replayed: ${serveScript.map((s) => (s ? 'R' : 'L')).join('')}`);
console.log('');
if (mismatches.length === 0) {
  console.log(`  MATCH -- all ${FIELDS.length} fields identical across all ${n} frames.`);
  const scored = browser[n - 1];
  console.log(`  final compared frame: score ${scored[20]}:${scored[21]}, ball (${scored[0]}, ${scored[1]})`);
} else {
  const frame = mismatches[0].frame;
  console.log(`  DIVERGENCE at frame ${frame} (${mismatches.length} fields differ):`);
  mismatches.forEach((m) =>
    console.log(`    ${m.field.padEnd(30)} browser=${String(m.browser).padStart(6)}   harness=${String(m.harness).padStart(6)}`)
  );
  console.log('');
  console.log('  previous frame (identical in both):');
  if (frame > 0) {
    FIELDS.forEach((name, f) => {
      if (browser[frame - 1][f] !== 0) console.log(`    ${name.padEnd(30)} ${browser[frame - 1][f]}`);
    });
  }
}
console.log('');
