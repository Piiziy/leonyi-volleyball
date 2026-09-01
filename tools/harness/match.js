/**
 * HAND-WRITTEN -- headless match driver.
 *
 * Reproduces what main.js wires up in the browser, minus the renderer. The
 * per-frame callback order is the one main.js actually produces (setup() calls
 * start() BEFORE setUpTouchLimit, and setUpBotTestUI before both):
 *
 *     syncWithGameState()   <- bot/testSetup.js: installs bots at match start
 *     pikaVolley.gameLoop() <- start(): getInput x2, then the state function
 *     tracker.observe()     <- rules/touchLimit.js: sees the frame just simulated
 *
 * Intro and menu are skipped by jumping straight to startOfNewGame; they only
 * drive the title screen and the 1P/2P selection, neither of which exists here.
 * Everything from startOfNewGame onward is the repo's own code.
 */
'use strict';
import { PikachuVolleyball, SERVE_RULE } from './engine/pikavolley.js';
import { setCustomRng } from './engine/rand.js';
import { TouchLimitTracker } from './engine/rules/touchLimit.js';
import { awardPoint } from './engine/operator/console.js';
import { PikaKeyboard } from './engine/keyboard.js';
import { HarnessBotInput, AiInput } from './botInput.js';

export { SERVE_RULE };

/** @constant frames per second the engine runs at (pikavolley normalFPS) */
export const FPS = 25;

/**
 * mulberry32 -- small, fast, well-distributed. Installed through rand.js's
 * own setCustomRng hook so EVERY draw the game makes (serve, computerBoldness,
 * the ball's zero-xVelocity tiebreak) comes from this seed and a match replays
 * exactly.
 * @param {number} seed
 * @return {function(): number} uniform in [0, 1)
 */
export const makeRng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** @typedef {{kind: 'bot', decide: function(Object): Object}|{kind: 'ai'}} SideSpec */

/**
 * Play one match to completion.
 *
 * @param {Object} args
 * @param {SideSpec} args.left
 * @param {SideSpec} args.right
 * @param {number} args.seed
 * @param {number} [args.winningScore] default 10, the tournament's set length
 * @param {string} [args.serveRule] default RANDOM, the tournament default
 * @param {boolean} [args.touchLimit] default true (tournament rule: 5 contacts)
 * @param {number|null} [args.timeLimitFrames] 본선 4-minute set cap; null = none
 * @param {number} [args.maxFrames] runaway guard
 */
export const runMatch = ({
  left,
  right,
  seed,
  winningScore = 10,
  serveRule = SERVE_RULE.RANDOM,
  touchLimit = true,
  timeLimitFrames = null,
  maxFrames = 200000,
  serveScript = null,
  onFrame = null,
  seedAfterConstruction = false,
}) => {
  // 봇이 수를 섞을 때 Math.random을 쓴다. 평가가 재현 가능해야 어떤 변경이
  // 실제로 개선인지 판단할 수 있으므로, 매치마다 같은 시드로 고정한다.
  // (엔진의 rand()는 setCustomRng로 따로 제어된다 -- 서로 간섭하지 않는다)
  const realRandom = Math.random;
  const botRng = makeRng(seed ^ 0x5bf03635);
  Math.random = botRng;

  // ★ 생성 BEFORE 시드. GameView 생성자가 구름 10개를 만들며 rand() 를 40회
  //   뽑는데, 시드를 나중에 하면 그 40회가 **직전 매치가 남긴 난수기**에서
  //   나온다. 구름 위치가 매번 달라지고, 구름이 화면 밖으로 나갈 때마다 추가
  //   난수를 소비하므로 물리용 스트림이 어긋나 **같은 시드인데 결과가 달라진다**
  //   (실측: 내장 AI 끼리 같은 시드로 9:10 / 8:10 / 8:10).
  //
  //   seedAfterConstruction 은 브라우저 트레이스와 프레임 단위로 대조할 때만
  //   쓴다. 그때는 브라우저 쪽도 이미 만들어진 게임에 난수기를 갈아끼우므로
  //   양쪽 스트림 시작점을 맞춰야 하기 때문이다(compare.js).
  if (!seedAfterConstruction) setCustomRng(makeRng(seed));
  const pv = new PikachuVolleyball({ addChild: () => {} }, {});
  if (seedAfterConstruction) setCustomRng(makeRng(seed));
  pv.serveRule = serveRule;
  pv.winningScore = winningScore;

  // VALIDATION HOOK ONLY. Who serves is the single nondeterministic input a
  // match has that the harness cannot know in advance, so a frame-exact
  // comparison against a browser recording replays the browser's own serve
  // sequence instead of drawing its own. Never set in normal evaluation runs.
  if (serveScript !== null) {
    let serveIndex = 0;
    pv.decideNextServe = () => {
      const value = serveScript[Math.min(serveIndex, serveScript.length - 1)];
      serveIndex += 1;
      return value;
    };
  }

  pv.state = pv.startOfNewGame;
  pv.frameCounter = 0;

  const getMeta = () => ({
    scores: pv.scores,
    isPlayer2Serve: pv.isPlayer2Serve,
  });
  const buildInput = (spec, side) =>
    spec.kind === 'ai'
      ? new AiInput()
      : new HarnessBotInput({
          side,
          physics: pv.physics,
          getMeta,
          decide: spec.decide,
        });
  const inputs = [buildInput(left, 'LEFT'), buildInput(right, 'RIGHT')];
  const specs = [left, right];

  const touchLimitPoints = [0, 0];
  // null when the rule is switched off, which is how the ORIGINAL game plays:
  // MAX_TOUCHES_PER_SIDE is this tournament's addition, not part of the engine.
  const tracker = touchLimit
    ? new TouchLimitTracker((side) => {
        touchLimitPoints[side] += 1;
        awardPoint(pv, side);
      })
    : null;

  // bot/testSetup.js: bots hold the keyboard slots only while a match is
  // actually running, and are swapped back out for menu navigation.
  const isDuringMatch = () =>
    pv.state === pv.round ||
    pv.state === pv.afterEndOfRound ||
    pv.state === pv.beforeStartOfNextRound;
  let installed = false;
  const syncWithGameState = () => {
    if (isDuringMatch() && !installed) {
      [0, 1].forEach((slot) => {
        const player = slot === 0 ? pv.physics.player1 : pv.physics.player2;
        player.isComputer = specs[slot].kind === 'ai';
        pv.keyboardArray[slot] = inputs[slot];
      });
      installed = true;
    } else if (!isDuringMatch() && installed) {
      pv.keyboardArray[0] = new PikaKeyboard();
      pv.keyboardArray[1] = new PikaKeyboard();
      installed = false;
    }
  };

  const rallies = [];
  let previousScoreTotal = 0;
  let rallyStartFrame = 0;
  let rallyStartRoundFrames = 0;
  let roundFrames = 0;
  let frames = 0;
  let stopReason = 'gameEnded';

  while (!pv.gameEnded) {
    if (frames >= maxFrames) {
      stopReason = 'maxFrames';
      break;
    }
    if (timeLimitFrames !== null && frames >= timeLimitFrames) {
      stopReason = 'timeLimit';
      break;
    }
    syncWithGameState();
    // The state function that is about to run. `round` is the only one that
    // simulates play; the others are fades and "READY?" text. Counting them
    // separately keeps "how long is a rally" from silently including the ~65
    // frames of round transition that sit between two points.
    const isRoundFrame = pv.state === pv.round;
    // gameLoop() runs the physics on only one in five calls while the post-point
    // slow motion is playing; the other four return before touching anything.
    // slowMotionNumOfSkippedFrames going UP is exactly that early return, so it
    // is a direct observation rather than a copy of the engine's condition.
    const skippedBefore = pv.slowMotionNumOfSkippedFrames;
    pv.gameLoop();
    const simulated = pv.slowMotionNumOfSkippedFrames <= skippedBefore;
    if (onFrame !== null) onFrame(pv, { isRoundFrame, simulated });
    if (tracker !== null) tracker.observe(pv);
    frames += 1;
    if (isRoundFrame) roundFrames += 1;

    const scoreTotal = pv.scores[0] + pv.scores[1];
    if (scoreTotal !== previousScoreTotal) {
      rallies.push({
        frames: frames - rallyStartFrame,
        roundFrames: roundFrames - rallyStartRoundFrames,
        scores: [...pv.scores],
      });
      previousScoreTotal = scoreTotal;
      rallyStartFrame = frames;
      rallyStartRoundFrames = roundFrames;
    }
  }

  Math.random = realRandom;

  const [leftScore, rightScore] = pv.scores;
  const winner =
    leftScore === rightScore ? null : leftScore > rightScore ? 'LEFT' : 'RIGHT';

  return {
    scores: [leftScore, rightScore],
    winner,
    stopReason,
    frames,
    seconds: frames / FPS,
    rallies: rallies.length,
    rallyLog: rallies,
    roundFrames,
    meanRallyFrames:
      rallies.length === 0
        ? 0
        : rallies.reduce((sum, r) => sum + r.frames, 0) / rallies.length,
    touchLimitPoints,
    botStats: inputs.map((input) => (input.stats ? input.stats : null)),
  };
};
