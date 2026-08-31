/**
 * The one place that defines what a trace row is, so the browser recording and
 * the harness recording cannot drift apart in field order.
 * Mirrors the array pushed by the injected hook in the browser.
 */
'use strict';

export const FIELDS = [
  'ball.x', 'ball.y', 'ball.xVelocity', 'ball.yVelocity',
  'ball.expectedLandingPointX', 'ball.isPowerHit',
  'p1.x', 'p1.y', 'p1.yVelocity', 'p1.state', 'p1.frameNumber',
  'p1.divingDirection', 'p1.isCollisionWithBallHappened',
  'p2.x', 'p2.y', 'p2.yVelocity', 'p2.state', 'p2.frameNumber',
  'p2.divingDirection', 'p2.isCollisionWithBallHappened',
  'scores[0]', 'scores[1]', 'isPlayer2Serve',
  'input0.x', 'input0.y', 'input0.hit',
  'input1.x', 'input1.y', 'input1.hit',
];

/** @param {import('./engine/pikavolley.js').PikachuVolleyball} pv */
export const captureRow = (pv) => {
  const b = pv.physics.ball;
  const p1 = pv.physics.player1;
  const p2 = pv.physics.player2;
  const k0 = pv.keyboardArray[0];
  const k1 = pv.keyboardArray[1];
  return [
    b.x, b.y, b.xVelocity, b.yVelocity, b.expectedLandingPointX, b.isPowerHit ? 1 : 0,
    p1.x, p1.y, p1.yVelocity, p1.state, p1.frameNumber, p1.divingDirection,
    p1.isCollisionWithBallHappened ? 1 : 0,
    p2.x, p2.y, p2.yVelocity, p2.state, p2.frameNumber, p2.divingDirection,
    p2.isCollisionWithBallHappened ? 1 : 0,
    pv.scores[0], pv.scores[1], pv.isPlayer2Serve ? 1 : 0,
    k0.xDirection, k0.yDirection, k0.powerHit,
    k1.xDirection, k1.yDirection, k1.powerHit,
  ];
};
