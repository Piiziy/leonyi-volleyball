/**
 * CLI: play two bots against each other many times and report who is better.
 *
 *   node run.js --left Alpha_v2.js --right Alpha_v1.js --matches 400
 *   node run.js --left MyBot_v1.js --right ai --matches 200
 *
 * A "match" here is one 10-point set, the tournament's 예선 format. Every seed
 * is played TWICE with the sides swapped (disable with --no-swap): this fork's
 * court is not perfectly symmetric -- physics.js ADR-0031 measured the left
 * side winning only 42.6-46.3% of default-AI-vs-default-AI points -- so a
 * one-sided comparison would credit the bot that happened to draw the right
 * court.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch, FPS } from './match.js';
import { compileBot } from './botInput.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const parseArgs = (argv) =>
  argv.reduce((acc, token, i, all) => {
    if (!token.startsWith('--')) return acc;
    const key = token.slice(2);
    const next = all[i + 1];
    return { ...acc, [key]: next && !next.startsWith('--') ? next : true };
  }, {});

/**
 * Resolve `ai` or a bot filename (bare name looks in src/code-here/).
 *
 * `tuneOverride` is applied to BOTH sides. Two search bots playing each other
 * take ~10s per set, which makes a 60-set comparison a 10-minute wait; halving
 * NODE_BUDGET on both sides halves that. Fair because both sides get the same
 * handicap -- but only trust it for large effects: a change that only matters
 * at full search depth can hide here. Confirm anything close at full budget.
 */
const loadSide = (spec, tuneOverride) => {
  if (spec === 'ai') return { kind: 'ai', label: 'built-in AI' };
  const path = spec.includes('/')
    ? resolve(spec)
    : resolve(REPO, 'src/code-here', spec);
  const source = readFileSync(path, 'utf8');
  const patched = tuneOverride
    ? source + '\n;Object.assign(TUNE, ' + tuneOverride + ');'
    : source;
  return {
    kind: 'bot',
    decide: compileBot(patched, spec),
    label: spec.replace(/^.*\//, ''),
  };
};

const pct = (n, d) => (d === 0 ? '0.0' : ((100 * n) / d).toFixed(1));

/**
 * 95% Wald confidence interval half-width for a win rate. Printed so a result
 * is never read as more precise than the sample size supports.
 */
const ci95 = (wins, n) => {
  if (n === 0) return 0;
  const p = wins / n;
  return 100 * 1.96 * Math.sqrt((p * (1 - p)) / n);
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const tune = typeof args.tune === 'string' ? args.tune : null;
  const a = loadSide(args.left || 'ai', tune);
  const b = loadSide(args.right || 'ai', tune);
  const matches = Number(args.matches || 100);
  const baseSeed = Number(args.seed || 1);
  const swap = args['no-swap'] !== true;
  const touchLimit = args['no-touch-limit'] !== true;
  const timeLimitFrames = args['time-limit']
    ? Number(args['time-limit']) * FPS
    : null;

  // Tally per BOT, not per court, so swapped games aggregate correctly.
  const tally = { a: 0, b: 0, draw: 0 };
  // 진영별로 쪼개서 본다. 한쪽에서만 약하면 그건 부호 실수 같은 버그다.
  const perSide = { aLeft: { w: 0, n: 0 }, aRight: { w: 0, n: 0 } };
  const courtWins = { LEFT: 0, RIGHT: 0 };
  const points = { a: 0, b: 0 };
  const stops = {};
  const timing = { a: { max: 0, sum: 0, calls: 0, over: 0, hard: 0, bad: 0, exc: 0, err: null },
                   b: { max: 0, sum: 0, calls: 0, over: 0, hard: 0, bad: 0, exc: 0, err: null } };
  let totalFrames = 0;
  let totalRallies = 0;
  let rallyFrameSum = 0;
  let touchLimitTotal = 0;

  const absorb = (who, stats) => {
    if (!stats) return;
    const t = timing[who];
    t.max = Math.max(t.max, stats.maxMs);
    t.sum += stats.totalMs;
    t.calls += stats.decideCalls;
    t.over += stats.overBudget;
    t.hard += stats.overHardTimeout;
    t.bad += stats.invalidActions;
    t.exc += stats.exceptions;
    if (t.err === null && stats.firstError) t.err = stats.firstError;
  };

  const started = performance.now();
  const orientations = swap ? [false, true] : [false];
  for (let i = 0; i < matches; i++) {
    for (const flipped of orientations) {
      const left = flipped ? b : a;
      const right = flipped ? a : b;
      const result = runMatch({
        left,
        right,
        seed: baseSeed + i,
        touchLimit,
        timeLimitFrames,
      });

      stops[result.stopReason] = (stops[result.stopReason] || 0) + 1;
      totalFrames += result.frames;
      totalRallies += result.rallies;
      rallyFrameSum += result.meanRallyFrames * result.rallies;
      touchLimitTotal += result.touchLimitPoints[0] + result.touchLimitPoints[1];

      const [leftScore, rightScore] = result.scores;
      points.a += flipped ? rightScore : leftScore;
      points.b += flipped ? leftScore : rightScore;
      absorb(flipped ? 'b' : 'a', result.botStats[0]);
      absorb(flipped ? 'a' : 'b', result.botStats[1]);

      if (result.winner === null) tally.draw += 1;
      else {
        courtWins[result.winner] += 1;
        const winnerIsA = (result.winner === 'LEFT') !== flipped;
        if (winnerIsA) tally.a += 1;
        else tally.b += 1;
        const bucket = flipped ? perSide.aRight : perSide.aLeft;
        bucket.n += 1;
        if (winnerIsA) bucket.w += 1;
      }
    }
  }

  const games = matches * orientations.length;
  const decided = tally.a + tally.b;
  const elapsed = (performance.now() - started) / 1000;

  console.log('');
  console.log(`  ${a.label}   vs   ${b.label}`);
  console.log(`  ${games} sets (${matches} seeds${swap ? ' x 2 orientations' : ', no swap'})`
    + `  ·  touch limit ${touchLimit ? 'on' : 'off'}`
    + (timeLimitFrames ? `  ·  time limit ${timeLimitFrames / FPS}s` : '')
    + (tune ? `  ·  양쪽 TUNE 덮어쓰기 ${tune}` : ''));
  console.log('  ' + '-'.repeat(66));
  console.log(`  ${a.label.padEnd(28)} ${String(tally.a).padStart(5)} wins   ${pct(tally.a, decided).padStart(5)}%  +-${ci95(tally.a, decided).toFixed(1)}`);
  console.log(`  ${b.label.padEnd(28)} ${String(tally.b).padStart(5)} wins   ${pct(tally.b, decided).padStart(5)}%  +-${ci95(tally.b, decided).toFixed(1)}`);
  if (tally.draw) console.log(`  ${'draw'.padEnd(28)} ${String(tally.draw).padStart(5)}`);
  console.log('');
  console.log(`  mean score        ${(points.a / games).toFixed(2)} : ${(points.b / games).toFixed(2)}`);
  console.log(`  court wins        LEFT ${courtWins.LEFT}  RIGHT ${courtWins.RIGHT}   (${pct(courtWins.LEFT, decided)}% left)`);
  if (swap) {
    console.log(`  ${a.label} 진영별     LEFT일 때 ${pct(perSide.aLeft.w, perSide.aLeft.n)}% (${perSide.aLeft.w}/${perSide.aLeft.n})` +
      `   RIGHT일 때 ${pct(perSide.aRight.w, perSide.aRight.n)}% (${perSide.aRight.w}/${perSide.aRight.n})`);
  }
  console.log(`  rallies/set       ${(totalRallies / games).toFixed(1)}`);
  console.log(`  mean rally        ${(rallyFrameSum / totalRallies).toFixed(0)} frames  (${(rallyFrameSum / totalRallies / FPS).toFixed(1)}s, incl. round transitions)`);
  console.log(`  set length        ${(totalFrames / games / FPS).toFixed(0)}s of game time`);
  console.log(`  touch-limit pts   ${touchLimitTotal}  (${(touchLimitTotal / games).toFixed(2)}/set)`);
  console.log(`  stop reasons      ${JSON.stringify(stops)}`);
  console.log(`  wall clock        ${elapsed.toFixed(2)}s  (${(totalFrames / elapsed / 1000).toFixed(0)}k frames/s)`);

  [['a', a], ['b', b]].forEach(([key, side]) => {
    const t = timing[key];
    if (t.calls === 0) return;
    console.log('');
    console.log(`  ${side.label} decide(): ${t.calls} calls, mean ${(t.sum / t.calls).toFixed(3)}ms, max ${t.max.toFixed(2)}ms`);
    if (t.over) console.log(`    !! ${t.over} calls over the 120ms tick target`);
    if (t.hard) console.log(`    !! ${t.hard} calls over the 360ms hard timeout -- would be DISCARDED in the browser`);
    if (t.bad) console.log(`    !! ${t.bad} invalid actions returned (neutral substituted)`);
    if (t.exc) console.log(`    !! ${t.exc} exceptions thrown; first:\n${t.err}`);
  });
  console.log('');
};

main();
