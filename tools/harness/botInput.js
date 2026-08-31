/**
 * HAND-WRITTEN -- the harness counterpart of src/resources/js/bot/botInput.js.
 *
 * Only the TRANSPORT differs. The browser runs decide() in a Web Worker and
 * cannot block on the reply, so a decision taken on frame N lands in
 * latestAction by frame N+1 (botInput.js, decision D-009). Here decide() is a
 * plain synchronous call, so the one-frame delay is reproduced explicitly with
 * `pendingAction` instead of arriving for free from the event loop.
 *
 * Everything else -- the tick counter, TICK_FRAME_GROUP_SIZE grouping, the
 * rallyFrameCount reset, the snapshot itself, the validity check and the
 * neutral-action fallback -- comes from the verbatim engine/bot/botContract.js,
 * so the bot sees byte-identical input to what it sees in the browser.
 *
 * Timing this reproduces (tick counter starts at 0, group size 3):
 *   frame 3  -> decide(S3) computed, held in pendingAction
 *   frame 4  -> pendingAction becomes latestAction, applied
 *   frames 4,5,6 -> that same action is applied every frame
 *   frame 6  -> decide(S6) computed
 * i.e. one frame of latency, then three frames of hold. A bot that returns
 * hit:1 therefore has powerHit pressed for three consecutive frames.
 */
'use strict';
import { PikaUserInput } from './engine/physics.js';
import {
  buildGameStateSnapshot,
  isValidBotAction,
  NEUTRAL_ACTION,
  TICK_FRAME_GROUP_SIZE,
} from './engine/bot/botContract.js';

/**
 * Compile bot source the same way botWorker.js does: the file body runs once
 * in its own function scope and `decide` closes over whatever it declared, so
 * top-level state persists between ticks exactly as the guide promises.
 * @param {string} source
 * @param {string} label for error messages
 * @return {function(Object): Object}
 */
export const compileBot = (source, label) => {
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    source + "\n;return (typeof decide === 'function') ? decide : null;"
  );
  const decide = factory();
  if (typeof decide !== 'function') {
    throw new Error(`${label}: no top-level \`decide\` function`);
  }
  return decide;
};

export class HarnessBotInput extends PikaUserInput {
  /**
   * @param {Object} args
   * @param {'LEFT'|'RIGHT'} args.side
   * @param {import('./engine/physics.js').PikaPhysics} args.physics
   * @param {function(): {scores: number[], isPlayer2Serve: boolean}} args.getMeta
   * @param {function(Object): Object} args.decide
   */
  constructor({ side, physics, getMeta, decide }) {
    super();
    this.side = side;
    this.physics = physics;
    this.getMeta = getMeta;
    this.decide = decide;

    this.tick = 0;
    this.rallyFrameCount = 0;
    this.previousScoreTotal = 0;
    this.latestAction = { ...NEUTRAL_ACTION };
    /** @type {{x:number,y:number,hit:number}|null} decided this frame, applied next */
    this.pendingAction = null;

    /** Divergence watch: the browser would time out a slow bot, the harness cannot. */
    this.stats = {
      decideCalls: 0,
      invalidActions: 0,
      exceptions: 0,
      overBudget: 0, // calls that would have missed the 120ms tick target
      overHardTimeout: 0, // calls the browser would have discarded (360ms)
      totalMs: 0,
      maxMs: 0,
      firstError: null,
    };
  }

  getInput() {
    // The Worker's reply lands between frames in the browser. Deliver before
    // applying, so a decision made on frame N first takes effect on N+1.
    if (this.pendingAction !== null) {
      this.latestAction = this.pendingAction;
      this.pendingAction = null;
    }

    this.xDirection = this.latestAction.x;
    this.yDirection = this.latestAction.y;
    this.powerHit = this.latestAction.hit;

    const meta = this.getMeta();
    const currentScoreTotal = meta.scores[0] + meta.scores[1];
    if (currentScoreTotal !== this.previousScoreTotal) {
      this.rallyFrameCount = 0;
      this.previousScoreTotal = currentScoreTotal;
    } else {
      this.rallyFrameCount++;
    }

    this.tick++;
    if (this.tick % TICK_FRAME_GROUP_SIZE !== 0) {
      return;
    }

    const snapshot = buildGameStateSnapshot({
      tick: this.tick,
      side: this.side,
      physics: this.physics,
      meta,
      rallyFrameCount: this.rallyFrameCount,
    });

    const started = performance.now();
    let action = null;
    try {
      action = this.decide(snapshot);
    } catch (error) {
      this.stats.exceptions++;
      if (this.stats.firstError === null) {
        this.stats.firstError = String(error && error.stack ? error.stack : error);
      }
    }
    const elapsed = performance.now() - started;
    this.stats.decideCalls++;
    this.stats.totalMs += elapsed;
    this.stats.maxMs = Math.max(this.stats.maxMs, elapsed);
    if (elapsed > 120) this.stats.overBudget++;
    if (elapsed > 360) this.stats.overHardTimeout++;

    if (isValidBotAction(action)) {
      this.pendingAction = { x: action.x, y: action.y, hit: action.hit };
    } else {
      if (action !== null) this.stats.invalidActions++;
      this.pendingAction = { ...NEUTRAL_ACTION };
    }
  }
}

/**
 * Input slot for the ORIGINAL built-in AI. The engine overwrites this object
 * every frame inside letComputerDecideUserInput (physics.js) whenever
 * player.isComputer is true, so the values here are never actually consumed.
 *
 * DELIBERATE DEVIATION from the browser's NullInput: this one zeroes the
 * fields, NullInput does not. round() reads keyboardArray[i].powerHit at the
 * top of every frame, and if BOTH players are isComputer and either flag is
 * still 1 from the AI's previous decision, the game bails out to the intro
 * screen. That makes AI-vs-AI unrunnable in the browser's bot panel. Zeroing
 * is what a real keyboard with nothing held does, is physically equivalent
 * (the engine recomputes all three fields before reading them), and lets the
 * harness run AI vs AI -- which is the matchup the ADR-0031 reference numbers
 * were measured on.
 */
export class AiInput extends PikaUserInput {
  getInput() {
    this.xDirection = 0;
    this.yDirection = 0;
    this.powerHit = 0;
  }
}
