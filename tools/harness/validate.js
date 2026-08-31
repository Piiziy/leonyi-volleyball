/**
 * Validation #1 -- reproduce the repo's own published measurement.
 *
 * physics.js carries a measured result for THIS fork, in the ADR-0031 note
 * above INFINITE_LOOP_LIMIT and the one inside
 * processCollisionBetweenBallAndWorldAndSetBallPosition:
 *
 *   "Measured over 1800 rallies x 3 seeds ... the left side still scores only
 *    42.6-46.3% ... rallies run shorter (607-641 frames vs 888-912)"
 *
 * measured with default-AI vs default-AI. Those numbers were produced by the
 * repo authors with their own harness, so they are an independent control: if
 * this harness lands in both bands, the whole loop -- engine, round state
 * machine, scoring, serve rule -- is faithful, not just the physics file.
 *
 *   node validate.js
 */
'use strict';
import { runMatch } from './match.js';

const RALLIES_PER_GROUP = 1800;
const GROUPS = 3;

const runGroup = (startSeed, touchLimit) => {
  const points = [0, 0];
  let rallies = 0;
  let ralliesFrameSum = 0;
  let roundFramesSum = 0;
  let seed = startSeed;
  while (rallies < RALLIES_PER_GROUP) {
    const r = runMatch({
      left: { kind: 'ai' },
      right: { kind: 'ai' },
      seed,
      touchLimit,
    });
    points[0] += r.scores[0];
    points[1] += r.scores[1];
    rallies += r.rallies;
    r.rallyLog.forEach((rally) => {
      ralliesFrameSum += rally.frames;
      roundFramesSum += rally.roundFrames;
    });
    seed += 1;
  }
  return {
    seeds: seed - startSeed,
    rallies,
    leftPointShare: (100 * points[0]) / (points[0] + points[1]),
    meanPointToPoint: ralliesFrameSum / rallies,
    meanRoundOnly: roundFramesSum / rallies,
  };
};

const band = (value, lo, hi) =>
  value >= lo && value <= hi ? 'IN BAND' : 'OUT OF BAND';

console.log('');
console.log('  ADR-0031 reference (default AI vs default AI, this fork):');
console.log('    left point share  42.6 - 46.3 %');
console.log('    rally length      607 - 641 frames');
console.log('');

[true, false].forEach((touchLimit) => {
  console.log(`  === touch limit ${touchLimit ? 'ON (tournament rule)' : 'OFF (original game)'} ===`);
  const started = performance.now();
  for (let g = 0; g < GROUPS; g++) {
    const r = runGroup(1 + g * 10000, touchLimit);
    console.log(
      `    group ${g + 1}: ${String(r.rallies).padStart(4)} rallies / ${String(r.seeds).padStart(3)} sets` +
        `   left ${r.leftPointShare.toFixed(1)}% [${band(r.leftPointShare, 42.6, 46.3)}]` +
        `   rally ${r.meanPointToPoint.toFixed(0)}f point-to-point` +
        ` / ${r.meanRoundOnly.toFixed(0)}f round-only [${band(r.meanRoundOnly, 607, 641)}]`
    );
  }
  console.log(`    (${((performance.now() - started) / 1000).toFixed(1)}s)`);
  console.log('');
});
