// ============================================================================
// [2] 게임 상수 — ★ 룰 자체가 바뀌면 여기 ★
// ============================================================================
var MAX_TOUCHES = 5;   // 한 진영이 이 횟수째로 공에 닿으면 실점 (rules/touchLimit.js)
var TICK_FRAMES = 3;   // 봇 결정 1회가 유지되는 프레임 수 (config.tickFrameGroupSize)
                       // ★ decide()에서 스냅샷의 실제 값으로 덮어쓴다. 여기 값은 기본값일 뿐

// ============================================================================
// [3] 물리 미러 — 게임 엔진(physics.js) 복사본
// ----------------------------------------------------------------------------
// 봇은 파일 하나여야 해서 엔진을 import할 수 없다. 그래서 필요한 부분만 그대로
// 옮겨왔다. 여기가 틀리면 아래 모든 판단이 틀린다.
//
// ★ 당일 새 스킬이 추가되면 고칠 곳은 여기다. 다른 섹션은 건드릴 필요 없다.
//
// 원본과 다른 점(의도적):
//   - 소리, 스프라이트 회전, 타격 이펙트는 뺐다. 궤적에 영향이 없다.
//   - rand()를 못 쓴다. 난수가 개입하는 지점은 uncertain 플래그로 알린다.
// ============================================================================

var GROUND_WIDTH = 432;
var GROUND_HALF_WIDTH = 216;              // 네트 x좌표
var PLAYER_LENGTH = 64;
var PLAYER_HALF_LENGTH = 32;              // 히트박스 반폭·반높이
var PLAYER_TOUCHING_GROUND_Y_COORD = 244; // 땅에 선 플레이어의 y
var BALL_RADIUS = 20;
var BALL_TOUCHING_GROUND_Y_COORD = 252;   // 공이 바닥에 닿는 y
var NET_PILLAR_HALF_WIDTH = 25;
var NET_PILLAR_TOP_TOP_Y_COORD = 176;
var NET_PILLAR_TOP_BOTTOM_Y_COORD = 192;
var INFINITE_LOOP_LIMIT = 1000;

// 공 중심이 이 범위를 벗어나면 벽에서 튄다. 좌우 대칭이다(ADR-0031).
var BALL_BOUNCE_MIN_X = 0;
var BALL_BOUNCE_MAX_X = GROUND_WIDTH;

/** 공의 한 프레임. 바닥에 닿으면 true. (원본: processCollisionBetweenBallAndWorldAndSetBallPosition) */
function stepBallWorld(b) {
  var futureX = b.x + b.xVelocity;
  if (futureX < BALL_BOUNCE_MIN_X || futureX > BALL_BOUNCE_MAX_X) {
    b.xVelocity = -b.xVelocity;
  }
  var futureY = b.y + b.yVelocity;
  if (futureY < 0) {
    b.yVelocity = 1;
  }
  // 네트 충돌: 기둥 꼭대기(176~192)에 맞으면 위로 튕기고, 그 아래면 옆으로 막힌다.
  if (
    Math.abs(b.x - GROUND_HALF_WIDTH) < NET_PILLAR_HALF_WIDTH &&
    b.y > NET_PILLAR_TOP_TOP_Y_COORD
  ) {
    if (b.y <= NET_PILLAR_TOP_BOTTOM_Y_COORD) {
      if (b.yVelocity > 0) b.yVelocity = -b.yVelocity;
    } else if (b.x < GROUND_HALF_WIDTH) {
      b.xVelocity = -Math.abs(b.xVelocity);
    } else {
      b.xVelocity = Math.abs(b.xVelocity);
    }
  }

  futureY = b.y + b.yVelocity;
  if (futureY > BALL_TOUCHING_GROUND_Y_COORD) {
    // 착지. 어느 쪽 코트에 떨어졌는지는 이 순간의 x로 정해진다(= punchEffectX).
    b.yVelocity = -b.yVelocity;
    b.y = BALL_TOUCHING_GROUND_Y_COORD;
    return true;
  }
  b.y = futureY;
  b.x = b.x + b.xVelocity;
  b.yVelocity += 1;
  return false;
}

/** 플레이어 한 프레임. (원본: processPlayerMovementAndSetPlayerPosition, 컴퓨터AI 분기 제외) */
function stepPlayer(p, ix, iy, ihit) {
  // 다이빙 후 경직. 이 동안은 어떤 입력도 안 먹는다.
  if (p.state === 4) {
    p.lyingDownDurationLeft -= 1;
    if (p.lyingDownDurationLeft < -1) p.state = 0;
    return;
  }

  var vx = 0;
  if (p.state < 5) {
    vx = p.state < 3 ? ix * 6 : p.divingDirection * 8; // 걷기 6, 다이빙 8
  }
  var futureX = p.x + vx;
  p.x = futureX;
  if (!p.isPlayer2) {
    if (futureX < PLAYER_HALF_LENGTH) p.x = PLAYER_HALF_LENGTH;
    else if (futureX > GROUND_HALF_WIDTH - PLAYER_HALF_LENGTH)
      p.x = GROUND_HALF_WIDTH - PLAYER_HALF_LENGTH;
  } else {
    if (futureX < GROUND_HALF_WIDTH + PLAYER_HALF_LENGTH)
      p.x = GROUND_HALF_WIDTH + PLAYER_HALF_LENGTH;
    else if (futureX > GROUND_WIDTH - PLAYER_HALF_LENGTH)
      p.x = GROUND_WIDTH - PLAYER_HALF_LENGTH;
  }

  // 점프: 땅에 있을 때 y=-1
  if (p.state < 3 && iy === -1 && p.y === PLAYER_TOUCHING_GROUND_Y_COORD) {
    p.yVelocity = -16;
    p.state = 1;
    p.frameNumber = 0;
  }

  var futureY = p.y + p.yVelocity;
  p.y = futureY;
  if (futureY < PLAYER_TOUCHING_GROUND_Y_COORD) {
    p.yVelocity += 1;
  } else if (futureY > PLAYER_TOUCHING_GROUND_Y_COORD) {
    p.yVelocity = 0;
    p.y = PLAYER_TOUCHING_GROUND_Y_COORD;
    p.frameNumber = 0;
    if (p.state === 3) {
      p.state = 4;
      p.frameNumber = 0;
      p.lyingDownDurationLeft = 3; // 착지 후 5프레임 경직
    } else {
      p.state = 0;
    }
  }

  if (ihit === 1) {
    if (p.state === 1) {
      // 점프 중 → 파워히트
      p.delayBeforeNextFrame = 5;
      p.frameNumber = 0;
      p.state = 2;
    } else if (p.state === 0 && ix !== 0) {
      // 지상 + 이동 중 → 다이빙. hit을 계속 들고 있으면 여기서 락에 걸린다.
      p.state = 3;
      p.frameNumber = 0;
      p.divingDirection = ix;
      p.yVelocity = -5;
    }
  }

  // 애니메이션 프레임. state 2 → 1 복귀 타이밍을 결정하므로 생략하면 안 된다.
  if (p.state === 1) {
    p.frameNumber = (p.frameNumber + 1) % 3;
  } else if (p.state === 2) {
    if (p.delayBeforeNextFrame < 1) {
      p.frameNumber += 1;
      if (p.frameNumber > 4) {
        p.frameNumber = 0;
        p.state = 1;
      }
    } else {
      p.delayBeforeNextFrame -= 1;
    }
  } else if (p.state === 0) {
    p.delayBeforeNextFrame += 1;
    if (p.delayBeforeNextFrame > 3) {
      p.delayBeforeNextFrame = 0;
      var f = p.frameNumber + p.armSwing;
      if (f < 0 || f > 4) p.armSwing = -p.armSwing;
      p.frameNumber = p.frameNumber + p.armSwing;
    }
  }
}

/** 공이 플레이어에 닿았나. 사각 히트박스 64x64. */
function isCollision(b, px, py) {
  return (
    Math.abs(b.x - px) <= PLAYER_HALF_LENGTH &&
    Math.abs(b.y - py) <= PLAYER_HALF_LENGTH
  );
}

/**
 * 충돌 처리. (원본: processCollisionBetweenBallAndPlayer)
 * 반환: 난수가 개입했으면 true (예측 불가 구간).
 *
 * 주의 — 공이 플레이어 중심에서 2px 이내면 xVelocity가 0이 되어 엔진이 난수를
 * 뽑는다((rand()%3)-1). 봇은 난수를 재현할 수 없으므로 0으로 가정하고 알린다.
 */
function processHit(b, playerX, ix, iy, playerState) {
  if (b.x < playerX) b.xVelocity = -((Math.abs(b.x - playerX) / 3) | 0);
  else if (b.x > playerX) b.xVelocity = (Math.abs(b.x - playerX) / 3) | 0;

  var uncertain = false;
  if (b.xVelocity === 0) {
    uncertain = true; // 엔진은 여기서 -1/0/1 중 하나를 무작위로 고른다
  }

  var absYV = Math.abs(b.yVelocity);
  b.yVelocity = -absYV;
  if (absYV < 15) b.yVelocity = -15;

  if (playerState === 2) {
    // 파워히트. 방향은 x 입력이 아니라 "공이 네트의 어느 쪽에 있는가"로 정해진다.
    // x 입력은 속도 배율만 결정한다(0이면 10, ±1이면 20).
    b.xVelocity =
      b.x < GROUND_HALF_WIDTH
        ? (Math.abs(ix) + 1) * 10
        : -(Math.abs(ix) + 1) * 10;
    b.yVelocity = Math.abs(b.yVelocity) * iy * 2; // y=0이면 완전 수평(0)
    b.isPowerHit = true;
  } else {
    b.isPowerHit = false;
  }
  return uncertain;
}

/** 현재 궤적 그대로 두면 공이 어디에 떨어지는가. (원본: calculateExpectedLandingPointXFor) */
function predictLanding(ball) {
  var c = {
    x: ball.x,
    y: ball.y,
    xVelocity: ball.xVelocity,
    yVelocity: ball.yVelocity,
  };
  var loop = 0;
  while (true) {
    loop++;
    var futureX = c.xVelocity + c.x;
    if (futureX < BALL_BOUNCE_MIN_X || futureX > BALL_BOUNCE_MAX_X) {
      c.xVelocity = -c.xVelocity;
    }
    if (c.y + c.yVelocity < 0) c.yVelocity = 1;
    if (
      Math.abs(c.x - GROUND_HALF_WIDTH) < NET_PILLAR_HALF_WIDTH &&
      c.y > NET_PILLAR_TOP_TOP_Y_COORD
    ) {
      // 원본은 여기서 <= 가 아니라 < 를 쓴다. 원작의 실수로 보이지만 그대로 둔다.
      if (c.y < NET_PILLAR_TOP_BOTTOM_Y_COORD) {
        if (c.yVelocity > 0) c.yVelocity = -c.yVelocity;
      } else if (c.x < GROUND_HALF_WIDTH) {
        c.xVelocity = -Math.abs(c.xVelocity);
      } else {
        c.xVelocity = Math.abs(c.xVelocity);
      }
    }
    c.y = c.y + c.yVelocity;
    if (c.y > BALL_TOUCHING_GROUND_Y_COORD || loop >= INFINITE_LOOP_LIMIT) break;
    c.x = c.x + c.xVelocity;
    c.yVelocity += 1;
  }
  return c.x;
}

/**
 * 지금 파워히트하면 어디에 떨어지는가. 공격 조준의 핵심.
 * (원본: expectedLandingPointXWhenPowerHit)
 */
function predictPowerHitLanding(ix, iy, ball) {
  var c = {
    x: ball.x,
    y: ball.y,
    xVelocity: ball.xVelocity,
    yVelocity: ball.yVelocity,
  };
  if (c.x < GROUND_HALF_WIDTH) c.xVelocity = (Math.abs(ix) + 1) * 10;
  else c.xVelocity = -(Math.abs(ix) + 1) * 10;
  c.yVelocity = Math.abs(c.yVelocity) * iy * 2;

  var loop = 0;
  while (true) {
    loop++;
    var futureX = c.x + c.xVelocity;
    if (futureX < BALL_BOUNCE_MIN_X || futureX > BALL_BOUNCE_MAX_X) {
      c.xVelocity = -c.xVelocity;
    }
    if (c.y + c.yVelocity < 0) c.yVelocity = 1;
    if (
      Math.abs(c.x - GROUND_HALF_WIDTH) < NET_PILLAR_HALF_WIDTH &&
      c.y > NET_PILLAR_TOP_TOP_Y_COORD
    ) {
      // 원본은 여기서 기둥 높이를 구분하지 않는다. 그래서 내장 AI는 네트에 튕겨
      // 돌아오는 공을 가끔 잘못 친다. 원본 그대로 둬야 예측이 엔진과 일치한다.
      if (c.yVelocity > 0) c.yVelocity = -c.yVelocity;
    }
    c.y = c.y + c.yVelocity;
    if (c.y > BALL_TOUCHING_GROUND_Y_COORD || loop >= INFINITE_LOOP_LIMIT) {
      return c.x;
    }
    c.x = c.x + c.xVelocity;
    c.yVelocity += 1;
  }
}

/**
 * 한 프레임 전체. 엔진의 physicsEngine()과 호출 순서까지 같아야 한다.
 * 반환: {ground: 바닥에 닿았나, landedX: 닿았다면 그 x, uncertain: 난수 개입}
 */
function stepFrame(w, i1x, i1y, i1h, i2x, i2y, i2h, skipLandingPrediction) {
  var vx0 = w.ball.xVelocity;
  var vy0 = w.ball.yVelocity;
  var ground = stepBallWorld(w.ball);
  var landedX = ground ? w.ball.x : -1;

  stepPlayer(w.p1, i1x, i1y, i1h);
  stepPlayer(w.p2, i2x, i2y, i2h);

  var uncertain = false;
  var hitHappened = false;
  var players = [w.p1, w.p2];
  var ins = [[i1x, i1y], [i2x, i2y]];
  for (var i = 0; i < 2; i++) {
    var p = players[i];
    if (isCollision(w.ball, p.x, p.y)) {
      if (!p.collided) {
        if (processHit(w.ball, p.x, ins[i][0], ins[i][1], p.state)) uncertain = true;
        p.collided = true;
        hitHappened = true;
      }
    } else {
      p.collided = false;
    }
  }
  // 착지 예측은 매 프레임 다시 계산한다. 엔진이 그렇게 하기 때문이다.
  //
  // "자유낙하 중엔 착지점이 안 변하니 건너뛰어도 된다"는 최적화는 틀렸다.
  // 엔진의 예측 함수는 네트 판정에 `<`를, 실제 물리는 `<=`를 써서(원작의
  // 불일치, physics.js 주석에 명시) 예측 궤적이 실제 궤적과 미세하게 다르고,
  // 그래서 예측값이 프레임마다 조금씩 달라질 수 있다. 50만 프레임 검증에서
  // 30건이 어긋났다.
  //
  // 탐색처럼 이 값이 필요 없는 곳에서는 skipLandingPrediction으로 끈다.
  // 물리는 항상 정확해야 하지만, 정책의 근사는 허용된다.
  //
  // ★ 다만 완전히 끄면 시뮬레이션 속 선수들이 **낡은 낙하지점**을 향해 걷는다.
  //   공이 타격당해 방향이 반대로 바뀌어도 계속 옛 지점으로 뛴다. 그래서
  //   속도가 바뀐 프레임(타격·벽·네트·바닥 반사)에만 다시 계산한다. 자유낙하
  //   중에는 착지점이 거의 변하지 않으므로 비용은 타격당 한 번뿐이다.
  //   (엄밀히는 예측 함수의 네트 판정이 실제 물리와 미세하게 달라 완전 불변은
  //   아니지만, 정책의 조준점으로 쓰기에는 충분하다.)
  var velocityChanged =
    hitHappened || ground || w.ball.xVelocity !== vx0 || w.ball.yVelocity !== vy0 + 1;
  // ★ 서브 구간에서만 켤 수도 있다([1] SIM_LANDING_REFRESH_ON_SERVE).
  //   서브는 선택지가 극히 좁아(자책 안 나는 수가 사실상 둘) 낙하지점 갱신의
  //   이득이 순수하게 나타나는 반면, 랠리 중에는 v14 의 움직임을 그대로 둔다.
  var refresh =
    TUNE.SIM_LANDING_REFRESH === 1 ||
    (TUNE.SIM_LANDING_REFRESH_ON_SERVE === 1 && G.inServe);
  if (!skipLandingPrediction || (refresh && velocityChanged)) {
    w.ball.expectedLandingPointX = predictLanding(w.ball);
  }
  return { ground: ground, landedX: landedX, uncertain: uncertain };
}
