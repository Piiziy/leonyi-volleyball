'use strict';
// ============================================================================
//  리온이 배구 봇 — LabC
//
//  이 봇은 게임 물리 엔진의 복사본을 안에 들고 있다. 매 틱 앞으로 몇 수를
//  실제로 시뮬레이션해 보고, "상대가 원리적으로 못 받는 공"을 만드는 수를 고른다.
// ============================================================================
//
//  ★★ 대회 당일 빠른 대응표 ★★
//
//  증상 / 상황                          고칠 곳
//  ----------------------------------  --------------------------------------
//  봇이 느리다 / 응답이 씹힌다          [1] NODE_BUDGET 을 절반으로
//                                       (예산 초과는 무입력 처리된다)
//  너무 소극적이다 (안 때린다)          [1] MARGIN_WEIGHT 올리기
//  자책골이 많다                        [1] AIR_CHASE_OFFSET 올리기
//  상대가 우리 공을 다 받아낸다          [1] OPP_DIVE_SPEED 올리기 (상대를 더
//                                       빠르게 가정 -> 더 확실한 공만 노린다)
//  터치리밋으로 자주 진다               [2] MAX_TOUCHES 가 룰과 맞는지 확인
//  새 스킬이 추가됐다 (물리가 바뀜)      [3] 물리 미러에 그 규칙을 반영
//  스냅샷에 새 필드가 생겼다             [4] 필요하면 buildWorld 에서 읽기
//                                       (안 읽어도 봇은 정상 동작한다)
//
//  ----------------------------------------------------------------------------
//  파일 구조
//    [1] 튜닝 상수   숫자만 바꿔 성격을 조절 (제일 먼저 볼 곳)
//    [2] 게임 상수   룰 자체가 바뀌었을 때
//    [3] 물리 미러   엔진 복사본. 새 스킬은 여기
//    [4] 상태 추정   스냅샷에 없는 값(플레이어 y속도 등) 복원
//    [5] 목적함수    "여유" -- 이 봇의 모든 판단 기준
//    [6] 전략        판단 로직
//    [7] decide()    엔진이 매 틱 호출하는 진입점
//
//  자동 생성: tools/harness/build.js (원본 조각은 tools/harness/botsrc/)
// ============================================================================

// ============================================================================
// [1] 튜닝 상수 — ★ 당일 여기부터 보세요 ★
// ----------------------------------------------------------------------------
// 봇의 성격을 정하는 숫자는 전부 여기 모여 있다. 로직을 건드리지 않고
// 이 값만 바꿔도 봇이 달라진다. 각 값 옆에 "올리면 어떻게 되는지"를 적어뒀다.
// ============================================================================
var TUNE = {
  // --- 이동 ---------------------------------------------------------------
  MOVE_DEADBAND: 6,          // 목표와 이만큼 차이나야 걷는다. 올리면 덜 흔들리고 둔해진다
  HOME_X_LEFT: 100,          // 대기 위치(왼쪽 기준). 올리면 네트에 붙어 선다

  // --- 켜고 끄는 스위치 (원인 추적용. 0=끔, 1=켬) ---------------------------
  ENABLE_JUMP_ATTACK: 1,     // 점프해서 파워히트로 공격한다
  ENABLE_DIVE: 1,            // 못 닿는 공에 다이빙한다
  ENABLE_AIR_CHASE: 1,       // 공중에서 공 쪽으로 좌우 이동한다

  // --- 공격 ---------------------------------------------------------------
  ATTACK_ZONE_FROM_NET: 90,  // 네트에서 이 안쪽에 공이 떨어질 때만 점프 공격. 올리면 공격적
  ATTACK_MIN_BALL_HEIGHT: 170, // 공이 이보다 높아야(y가 작아야) 공격. 올리면 낮은 공도 친다
  ATTACK_ALIGN_X: 40,        // 낙하지점과 내 위치가 이 안이어야 점프. 올리면 무리한 점프가 는다
  HIT_WINDOW_FRAMES: 4,      // 지금 낸 hit이 유효한 프레임 창(1프레임 지연 + 3프레임 유지).
                             // 이 안에 접촉이 예측되면 친다. 늘리면 성급하게 친다
  AIR_CHASE_OFFSET: 12,      // 점프 중 공에서 네트 반대쪽으로 비켜설 거리.
                             // 0이면 정중앙(파워히트 불발 시 자책 위험)
  FAST_HIT_BONUS: 25,        // 2배속 파워히트 가산점. 올리면 각도보다 속도를 택한다
  JUMP_LOOKAHEAD_FRAMES: 40, // 점프가 공에 닿는지 몇 프레임까지 시뮬레이션할지

  // --- 리시브 -------------------------------------------------------------
  SET_TARGET_FROM_NET: 55,   // 리시브한 공을 네트에서 이만큼 떨어진 곳에 띄운다
                             // 작을수록 네트에 붙어 공격이 매섭지만 자책 위험이 는다
  ENABLE_SETUP: 1,           // 1이면 첫 터치를 네트 앞에 띄워 공격을 준비한다.
                             // 0이면 항상 바로 넘긴다(자책이 줄고 공격은 약해진다)
  RECEIVE_SEARCH: 30,        // 낙하지점 기준 ±이 범위에서 설 자리를 찾는다
  RECEIVE_LOOKAHEAD: 140,    // 공이 나에게 오기까지 몇 프레임까지 굴려볼지
  SETUP_MAX_BALL_Y: 210,     // 공이 이보다 낮으면 세우지 말고 바로 넘긴다
  FALLBACK_OFFSET: 12,       // 아무 계산도 안 될 때 낙하지점에서 비켜설 거리

  // --- 다이빙 -------------------------------------------------------------
  DIVE_DISTANCE: 34,         // 목표가 이보다 멀면 다이빙. 낮추면 자주 다이빙(착지 5프레임 경직 주의)
  DIVE_MIN_BALL_Y: 174,      // 공이 이보다 낮게 내려왔을 때만 다이빙

  // --- 여유(margin) 모델 — 전략 C의 핵심 ---------------------------------
  // 여유 = |착지점-상대x| - (OPP_DIVE_SPEED * max(0, 비행f - OPP_REACTION_FRAMES) + 32)
  OPP_DIVE_SPEED: 8,         // 상대가 낼 수 있는 최대 속도(다이빙). 걷기는 6
  OPP_REACTION_FRAMES: 4,    // 상대의 반응 지연(1틱 지연 3 + 판단 1).
                             // 올리면 상대를 느리게 보고 더 공격적이 된다
  SHOT_SIM_FRAMES: 200,      // 공을 착지까지 굴릴 최대 프레임
  JUMP_MARGIN_THRESHOLD: 0,  // 이 여유를 넘겨야 점프한다. 올리면 확실할 때만 공격
  ATTACK_BEST_Y_MIN: 80,     // 세트업이 노리는 타격 높이의 위쪽 한계
  ATTACK_BEST_Y_MAX: 140,    // 같은 것의 아래쪽 한계 (분석상 100~120이 최적)
  SETUP_SCAN_FRAMES: 60,     // 띄운 공의 궤적을 몇 프레임까지 살필지
  SETUP_COST: 10,            // 터치를 하나 더 쓰는 대가. 올리면 세트업을 덜 한다
  RECEIVE_STEP: 3,           // 리시브 위치 후보 간격 (작을수록 정밀·느림)
  DEFENSE_STEP: 8,           // 수비 위치 후보 간격
  DEFENSE_LOOKAHEAD: 90,     // 상대가 공을 칠 시점을 몇 프레임까지 찾을지

  // --- 전략 B(전탐색) 전용 ------------------------------------------------
  // 탐색은 고정 깊이가 아니라 예산으로 끊는다(반복 심화). 얕은 깊이부터 풀고
  // 예산이 남는 동안 계속 깊이 판다.
  NODE_BUDGET: 6000,        // ★ 주 제어. 한 번의 decide()가 펼칠 최대 탐색 노드 수.
                             // 기계 속도와 무관해서 결과가 항상 재현된다.
                             // 올리면 강해지고 느려진다. 개발 머신 기준 깊이 4 수준
  TIME_BUDGET_MS: 45,        // 안전망. 대회 PC가 느려도 타임아웃하지 않게 한다.
                             // 목표 주기 120ms, 하드 타임아웃 360ms의 절반 이하
  WARMUP_TICKS: 6,           // 첫 이만큼의 틱은 예산을 줄인다(JIT 컴파일 스파이크 회피)
  WARMUP_NODE_BUDGET: 300,   // 그동안 쓸 작은 예산
  MAX_SEARCH_DEPTH: 8,       // 예산이 남아돌 때의 상한. 실제로는 대개 3~4에서 끊긴다
  ROLLOUT_FRAMES: 90,        // 탐색이 끝난 뒤 랠리 결말을 볼 프레임 수
  UNRESOLVED_OPP_SIDE: 50,   // 지평선 안에 안 끝났을 때, 공이 상대 쪽이면 주는 점수
  MARGIN_WEIGHT: 1.0,        // 결말이 안 났을 때 '여유'를 얼마나 반영할지.
                             // 0이면 순수 탐색, 올리면 공격 자세를 더 중시한다   // 지평선 안에 안 끝났을 때, 공이 상대 쪽이면 주는 점수

  // --- 안전장치 -----------------------------------------------------------
  STALE_PREDICTION_FRAMES: 34, // 랠리 시작 후 이 프레임까지는 expectedLandingPointX를
                               // 믿지 않는다(직전 랠리 값이 남아 있는 구간)
};

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
  var ground = stepBallWorld(w.ball);
  var landedX = ground ? w.ball.x : -1;

  stepPlayer(w.p1, i1x, i1y, i1h);
  stepPlayer(w.p2, i2x, i2y, i2h);

  var uncertain = false;
  var players = [w.p1, w.p2];
  var ins = [[i1x, i1y], [i2x, i2y]];
  for (var i = 0; i < 2; i++) {
    var p = players[i];
    if (isCollision(w.ball, p.x, p.y)) {
      if (!p.collided) {
        if (processHit(w.ball, p.x, ins[i][0], ins[i][1], p.state)) uncertain = true;
        p.collided = true;
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
  if (!skipLandingPrediction) {
    w.ball.expectedLandingPointX = predictLanding(w.ball);
  }
  return { ground: ground, landedX: landedX, uncertain: uncertain };
}

// ============================================================================
// [4] 상태 추정 — 스냅샷에 없는 값 복원
// ----------------------------------------------------------------------------
// 스냅샷은 x, y, state, frameNumber, divingDirection만 준다. 시뮬레이션에는
// yVelocity와 내부 카운터(경직·애니메이션 지연)도 필요하다.
//
// 핵심 아이디어: 내 캐릭터는 내가 낸 입력을 알고 있으므로 미러를 그대로 굴리면
// 정확하다. 상대는 입력을 모르니 위치 변화로 추정한다.
//
// ★ 타이밍 (검증 완료). 틱 T의 스냅샷 = 프레임 T 직전 상태.
//   틱 T에서 고른 행동은 프레임 T+1, T+2, T+3에 적용된다(1프레임 지연 + 3프레임 유지).
//   따라서 스냅샷 T에서 스냅샷 T+3 사이에 실행되는 프레임은
//     프레임 T   -> 직전 행동(A_prev)
//     프레임 T+1, T+2 -> 이번에 고른 행동(A_now)
//   이 순서를 틀리면 예측이 통째로 어긋난다.
// ============================================================================

var G = {
  prevSnapshot: null,
  prevAction: { x: 0, y: 0, hit: 0 }, // 직전 틱에 반환한 행동
  selfMirror: null,                   // 내 캐릭터의 정확한 미러
  oppMirror: null,                    // 상대 캐릭터의 추정 미러
  rallyId: -1,                        // 랠리가 바뀌면 미러를 다시 세운다
  ticks: 0,
  // --- 터치 카운트 (룰: 한 진영 5회째 접촉 시 실점, 즉 4회까지만 안전) --------
  myTouches: 0,       // 공이 네트를 넘은 이후 내가 만진 횟수
  wasTouching: false, // 직전 틱에 내 히트박스 안에 공이 있었나 (에지 판정용)
  prevBallLeft: null, // 직전 틱에 공이 왼쪽 코트에 있었나 (네트 통과 판정용)
};

/** 스냅샷의 플레이어를 미러가 쓰는 형태로. 숨은 값은 기본값으로 채운다. */
function newPlayerMirror(p, isPlayer2) {
  return {
    x: p.x,
    y: p.y,
    yVelocity: 0,
    state: p.state,
    frameNumber: p.frameNumber,
    divingDirection: p.divingDirection,
    lyingDownDurationLeft: -1,
    delayBeforeNextFrame: 0,
    armSwing: 1,
    collided: false,
    isPlayer2: isPlayer2,
  };
}

/**
 * 공중에 있는 캐릭터의 yVelocity를 y좌표에서 역산한다.
 * 점프는 항상 yVelocity=-16에서 시작해 매 프레임 +1이므로 궤적이 하나뿐이다:
 *   k프레임 후  y = 244 - 16k + k(k-1)/2,  yVelocity = -16 + k
 * 같은 y를 주는 k가 상승/하강 두 개일 수 있어 직전 y로 방향을 가린다.
 * 미러를 이어붙일 수 없을 때(랠리 시작, 상대 추정 실패)만 쓰는 보조 수단.
 */
function inferJumpYVelocity(y, prevY) {
  if (y >= PLAYER_TOUCHING_GROUND_Y_COORD) return 0;
  var rising = prevY === null || prevY > y;
  var fallback = 0;
  for (var k = 1; k <= 34; k++) {
    var yk = PLAYER_TOUCHING_GROUND_Y_COORD - 16 * k + (k * (k - 1)) / 2;
    if (yk !== y) continue;
    var v = -16 + k;
    if (rising && v < 0) return v;
    if (!rising && v >= 0) return v;
    fallback = v;
  }
  return fallback;
}

/** 미러 하나를 스냅샷에 맞춰 다시 앉힌다. 눈에 보이는 값은 스냅샷이 정답. */
function reanchor(mirror, p, prevY) {
  var jumped = mirror.state !== p.state && (p.state === 1 || p.state === 3);
  mirror.x = p.x;
  mirror.state = p.state;
  mirror.frameNumber = p.frameNumber;
  mirror.divingDirection = p.divingDirection;
  if (mirror.y !== p.y || jumped) {
    // 예측이 빗나갔다 -- yVelocity를 y에서 다시 뽑는다.
    mirror.yVelocity =
      p.state === 3 || p.state === 4 ? mirror.yVelocity : inferJumpYVelocity(p.y, prevY);
  }
  mirror.y = p.y;
}

/** 스냅샷 + 미러 → 미러가 굴릴 수 있는 world 객체 (공은 스냅샷이 항상 정확) */
function buildWorld(s, selfM, oppM) {
  var iAmLeft = s.side === 'LEFT';
  var world = {
    ball: {
      x: s.ball.x,
      y: s.ball.y,
      xVelocity: s.ball.xVelocity,
      yVelocity: s.ball.yVelocity,
      isPowerHit: s.ball.isPowerHit,
      expectedLandingPointX: s.ball.expectedLandingPointX,
    },
    p1: iAmLeft ? selfM : oppM,
    p2: iAmLeft ? oppM : selfM,
  };
  // 충돌 플래그는 관측 가능하다: 지금 겹쳐 있으면 true다.
  world.p1.collided = isCollision(world.ball, world.p1.x, world.p1.y);
  world.p2.collided = isCollision(world.ball, world.p2.x, world.p2.y);
  return world;
}

/**
 * 이미 있는 객체에 상태를 덮어쓴다. 새로 만들지 않는다.
 *
 * 탐색은 수천 번 복사하는데, 그때마다 객체를 새로 만들면 쓰레기가 쌓여 GC가
 * 돈다. 측정상 그 정지가 한 번에 150ms까지 튀어 틱 예산(120ms)을 넘겼다.
 * 미리 만들어 둔 버퍼에 값만 옮기면 할당이 사라진다.
 */
function copyPlayerInto(d, p) {
  d.x = p.x; d.y = p.y; d.yVelocity = p.yVelocity; d.state = p.state;
  d.frameNumber = p.frameNumber; d.divingDirection = p.divingDirection;
  d.lyingDownDurationLeft = p.lyingDownDurationLeft;
  d.delayBeforeNextFrame = p.delayBeforeNextFrame;
  d.armSwing = p.armSwing; d.collided = p.collided; d.isPlayer2 = p.isPlayer2;
  return d;
}
function copyWorldInto(d, w) {
  var a = d.ball, b = w.ball;
  a.x = b.x; a.y = b.y; a.xVelocity = b.xVelocity; a.yVelocity = b.yVelocity;
  a.isPowerHit = b.isPowerHit; a.expectedLandingPointX = b.expectedLandingPointX;
  copyPlayerInto(d.p1, w.p1);
  copyPlayerInto(d.p2, w.p2);
  return d;
}

/** 미러를 깊은 복사 (탐색은 원본을 건드리면 안 된다) */
function cloneWorld(w) {
  var cp = function (p) {
    return {
      x: p.x, y: p.y, yVelocity: p.yVelocity, state: p.state,
      frameNumber: p.frameNumber, divingDirection: p.divingDirection,
      lyingDownDurationLeft: p.lyingDownDurationLeft,
      delayBeforeNextFrame: p.delayBeforeNextFrame,
      armSwing: p.armSwing, collided: p.collided, isPlayer2: p.isPlayer2,
    };
  };
  return {
    ball: {
      x: w.ball.x, y: w.ball.y, xVelocity: w.ball.xVelocity,
      yVelocity: w.ball.yVelocity, isPowerHit: w.ball.isPowerHit,
      expectedLandingPointX: w.ball.expectedLandingPointX,
    },
    p1: cp(w.p1),
    p2: cp(w.p2),
  };
}

/** 매 틱 처음에 불러 미러를 최신 상태로 만든다. */
function syncMirrors(s) {
  var newRally = G.prevSnapshot === null || s.meta.rallyFrameCount < G.prevSnapshot.meta.rallyFrameCount;
  var iAmLeft = s.side === 'LEFT';

  if (newRally || G.selfMirror === null) {
    G.selfMirror = newPlayerMirror(s.self, !iAmLeft);
    G.oppMirror = newPlayerMirror(s.opp, iAmLeft);
  } else {
    var prevSelfY = G.prevSnapshot.self.y;
    var prevOppY = G.prevSnapshot.opp.y;
    // 내 미러는 실제로 실행된 입력으로 3프레임 굴린 뒤 스냅샷으로 보정한다.
    reanchor(G.selfMirror, s.self, prevSelfY);
    reanchor(G.oppMirror, s.opp, prevOppY);
  }
  // --- 터치 카운트 갱신 ------------------------------------------------------
  // rules/touchLimit.js와 같은 논리다: 공이 네트를 넘으면 리셋하고, 히트박스에
  // 새로 들어온 순간을 1회로 센다. 봇은 3프레임마다 보므로 아주 짧은 접촉은
  // 놓칠 수 있다 -- 그래서 정책은 항상 "애매하면 넘긴다" 쪽으로 잡는다.
  var ballLeft = s.ball.x < GROUND_HALF_WIDTH;
  if (newRally || (G.prevBallLeft !== null && ballLeft !== G.prevBallLeft)) {
    G.myTouches = 0;
    G.wasTouching = false;
  }
  G.prevBallLeft = ballLeft;
  var touchingNow = isCollision(s.ball, s.self.x, s.self.y);
  if (touchingNow && !G.wasTouching) G.myTouches++;
  G.wasTouching = touchingNow;

  G.prevSnapshot = s;
  G.ticks++;
}

/**
 * 공을 자유낙하로 굴려서, 내가 standX에 서 있으면 언제 어떻게 맞는지 예측한다.
 * 리시브 판단의 핵심 -- "여기 서면 공이 어디로 튀는가"를 정확히 답한다.
 *
 * @return {{ok, frames, landing, uncertain, contactY}} ok=false면 못 받는다
 */
function simulateBodyHit(ball, standX, standY, maxFrames) {
  var b = {
    x: ball.x, y: ball.y,
    xVelocity: ball.xVelocity, yVelocity: ball.yVelocity,
  };
  for (var f = 0; f < maxFrames; f++) {
    if (stepBallWorld(b)) return { ok: false };  // 먼저 땅에 닿았다
    if (!isCollision(b, standX, standY)) continue;

    // 몸 타격: 중심에서 벗어난 거리에 비례해 옆으로 튄다 (processHit의 일반 분기)
    var d = b.x - standX;
    var vx = d < 0 ? -((Math.abs(d) / 3) | 0) : (d > 0 ? (Math.abs(d) / 3) | 0 : 0);
    var absYV = Math.abs(b.yVelocity);
    var vy = -Math.max(15, absYV);
    return {
      ok: true,
      frames: f,
      landing: predictLanding({ x: b.x, y: b.y, xVelocity: vx, yVelocity: vy }),
      // vx가 0이면 엔진이 난수를 뽑는다. 결과를 보장할 수 없으니 피해야 한다.
      uncertain: vx === 0,
      contactY: b.y,
    };
  }
  return { ok: false };
}

/** 상대가 다음 프레임들에 낼 법한 입력. 낙하지점을 향해 걷는다고 본다. */
function guessOpponentInput(w, iAmLeft) {
  var opp = iAmLeft ? w.p2 : w.p1;
  var target = w.ball.expectedLandingPointX;
  var dx = target - opp.x;
  return { x: Math.abs(dx) > 8 ? (dx > 0 ? 1 : -1) : 0, y: 0, hit: 0 };
}

// --- 코트 기하 ---------------------------------------------------------------

/** 내 코트의 [최소x, 최대x] */
function ownCourt(iAmLeft) {
  return iAmLeft ? [0, GROUND_HALF_WIDTH] : [GROUND_HALF_WIDTH, GROUND_WIDTH];
}
function oppCourt(iAmLeft) {
  return iAmLeft ? [GROUND_HALF_WIDTH, GROUND_WIDTH] : [0, GROUND_HALF_WIDTH];
}
/** 착지점이 상대 코트 안인가 (= 내 득점) */
function landsOnOpponent(x, iAmLeft) {
  return iAmLeft ? x > GROUND_HALF_WIDTH : x < GROUND_HALF_WIDTH;
}


// ============================================================================
// [5] 공통 목적함수 — "여유(margin)"
// ----------------------------------------------------------------------------
// 이 봇의 모든 판단은 하나의 숫자로 통일된다.
//
//   여유 = |착지점 − 상대x|  −  ( 8·max(0, 비행프레임−4) + 32 )
//          └공이 떨어지는 곳    └상대가 그때까지 갈 수 있는 거리
//            8 = 다이빙 속도, 4 = 상대의 1틱 반응 지연, 32 = 히트박스 반폭
//
//   여유 > 0  이면 상대가 원리적으로 못 받는 공이다.
//
// ★ "상대에게서 멀리 보낸다"가 아니다. 멀리 보낼수록 비행시간이 길어져 상대가
//   따라올 시간을 준다. 실제 최적해는 "네트 바로 뒤에 급강하로 꽂는 짧은 공"으로,
//   착지 226~236 · 비행 6프레임 · 여유 +40~+50 이다.
//   (근거: tools/harness/analyze2.js)
// ============================================================================

/** 상대가 f프레임 안에 커버할 수 있는 거리 */
function opponentReach(f) {
  return TUNE.OPP_DIVE_SPEED * Math.max(0, f - TUNE.OPP_REACTION_FRAMES) + PLAYER_HALF_LENGTH;
}

/**
 * 이 공을 (ix, iy)로 파워히트하면 어떻게 되는가.
 * ★ 엔진의 predictPowerHitLanding을 쓰지 않는다. 그 함수는 네트 기둥 높이를
 *   구분하지 않아 22% 확률로 실제와 어긋난다(원작의 버그). 진짜 물리로 굴린다.
 */
function shotOutcome(ball, ix, iy, attackerIsLeft) {
  var b = {
    x: ball.x,
    y: ball.y,
    // ★ 방향은 "때리는 사람이 어느 진영인가"가 아니라 "공이 네트의 어느 쪽에
    //   있는가"로 정해진다. 엔진(processCollisionBetweenBallAndPlayer)이 그렇다.
    //   플레이어는 x=184까지 갈 수 있고 히트박스가 ±32라 공이 네트 너머에 있는
    //   채로 맞는 경우가 실제로 생긴다. 이때 부호를 진영으로 판단하면 뒤집힌다.
    xVelocity:
      ball.x < GROUND_HALF_WIDTH
        ? (Math.abs(ix) + 1) * 10
        : -(Math.abs(ix) + 1) * 10,
    yVelocity: Math.abs(ball.yVelocity) * iy * 2,
  };
  var startLeft = b.x < GROUND_HALF_WIDTH;
  var crossed = false;
  for (var f = 1; f <= TUNE.SHOT_SIM_FRAMES; f++) {
    var grounded = stepBallWorld(b);
    if ((b.x < GROUND_HALF_WIDTH) !== startLeft) crossed = true;
    if (grounded) return { landing: b.x, frames: f, crossed: crossed };
  }
  return { landing: b.x, frames: TUNE.SHOT_SIM_FRAMES, crossed: crossed };
}

/**
 * 이 접촉 상태에서 낼 수 있는 최선의 공격.
 * @return {{ix, iy, margin, landing, frames}} 넘길 수 있는 조합이 없으면 margin은 매우 낮다
 */
function bestShot(ball, oppX, attackerIsLeft) {
  var best = null;
  for (var ix = 0; ix <= 1; ix++) {
    for (var iy = -1; iy <= 1; iy++) {
      var r = shotOutcome(ball, ix, iy, attackerIsLeft);
      var over = attackerIsLeft ? r.landing > GROUND_HALF_WIDTH : r.landing < GROUND_HALF_WIDTH;
      // 못 넘기는 조합은 자책이다. 아주 낮은 점수를 주되 후보에는 남긴다
      // (전부 못 넘기는 상황이면 그중 덜 나쁜 걸 골라야 하므로).
      var margin = !r.crossed || !over
        ? -1000 + (attackerIsLeft ? r.landing : GROUND_WIDTH - r.landing)
        : Math.abs(r.landing - oppX) - opponentReach(r.frames);
      if (best === null || margin > best.margin) {
        best = { ix: ix, iy: iy, margin: margin, landing: r.landing, frames: r.frames };
      }
    }
  }
  return best;
}


// ============================================================================
// [6] 전략 C — 공격·세트·수비를 모두 "여유"로 판단하는 하이브리드
// ----------------------------------------------------------------------------
//   공격: T+1~T+3 구간에 접촉이 예측되면, 9가지 조합을 굴려 여유 최대인 것을 친다
//   세트: 후속 공격의 여유를 최대화하는 리시브 위치에 선다
//   수비: 상대가 낼 수 있는 최선의 여유를 최소화하는 자리에 선다 (미니맥스)
// ============================================================================

function meOf(w, iAmLeft) { return iAmLeft ? w.p1 : w.p2; }
function oppOf(w, iAmLeft) { return iAmLeft ? w.p2 : w.p1; }

function advance(w, iAmLeft, mx, my, mh) {
  var og = guessOpponentInput(w, iAmLeft);
  if (iAmLeft) return stepFrame(w, mx, my, mh, og.x, og.y, og.hit);
  return stepFrame(w, og.x, og.y, og.hit, mx, my, mh);
}

/** 프레임 T는 직전 행동이 적용되는 프레임이라 이미 결정됐다. 그 다음부터가 내 영향권. */
function worldAtDecisionPoint(s, iAmLeft) {
  var w = cloneWorld(buildWorld(s, G.selfMirror, G.oppMirror));
  advance(w, iAmLeft, G.prevAction.x, G.prevAction.y, G.prevAction.hit);
  return w;
}

/**
 * 지금 hit을 내면 T+1~T+3 안에 접촉이 일어나는가. 일어난다면 최선의 각도는?
 * x는 이동 방향이자 속도 배율이고 y는 각도라 얽혀 있으므로 9가지를 전부 굴린다.
 */
function planPowerHit(base, iAmLeft, oppX) {
  var me = meOf(base, iAmLeft);
  if (me.state !== 1 && me.state !== 2) return null;
  var best = null;
  for (var mx = -1; mx <= 1; mx++) {
    for (var my = -1; my <= 1; my++) {
      var w = cloneWorld(base);
      var contacted = false;
      for (var f = 0; f < TUNE.HIT_WINDOW_FRAMES; f++) {
        var before = w.ball.isPowerHit;
        advance(w, iAmLeft, mx, my, 1);
        if (w.ball.isPowerHit && !before) { contacted = true; break; }
      }
      if (!contacted) continue;
      // 접촉 직후의 공으로 여유를 잰다. 이미 파워히트가 적용된 상태이므로
      // 여기서는 착지까지 그대로 굴리기만 하면 된다.
      var b = { x: w.ball.x, y: w.ball.y, xVelocity: w.ball.xVelocity, yVelocity: w.ball.yVelocity };
      var startLeft = b.x < GROUND_HALF_WIDTH;
      var crossed = false, landing = b.x, frames = TUNE.SHOT_SIM_FRAMES;
      for (var g = 1; g <= TUNE.SHOT_SIM_FRAMES; g++) {
        var grounded = stepBallWorld(b);
        if ((b.x < GROUND_HALF_WIDTH) !== startLeft) crossed = true;
        if (grounded) { landing = b.x; frames = g; break; }
      }
      var over = iAmLeft ? landing > GROUND_HALF_WIDTH : landing < GROUND_HALF_WIDTH;
      var margin = !crossed || !over
        ? -1000 + (iAmLeft ? landing : GROUND_WIDTH - landing)
        : Math.abs(landing - oppX) - opponentReach(frames);
      if (best === null || margin > best.margin) {
        best = { x: mx, y: my, margin: margin, landing: landing, frames: frames };
      }
    }
  }
  return best;
}

/**
 * 지금 점프하면 이번 비행 중에 여유 양수인 공격이 가능한가.
 * @return 최선의 여유. 점프할 가치가 없으면 매우 낮은 값.
 */
function jumpValue(base, iAmLeft) {
  var me = meOf(base, iAmLeft);
  if (me.state !== 0 || me.y !== PLAYER_TOUCHING_GROUND_Y_COORD) return -9999;
  var w = cloneWorld(base);
  var toNet = iAmLeft ? 1 : -1;
  var best = -9999;
  for (var f = 0; f < TUNE.JUMP_LOOKAHEAD_FRAMES; f++) {
    me = meOf(w, iAmLeft);
    var jy = f < 3 ? -1 : 0;                      // 점프 입력은 3프레임 유지된다
    var aim = w.ball.x - toNet * TUNE.AIR_CHASE_OFFSET;
    var d = aim - me.x;
    var jx = Math.abs(d) > 4 ? (d > 0 ? 1 : -1) : 0;
    advance(w, iAmLeft, jx, jy, 0);
    me = meOf(w, iAmLeft);
    if (f > 2 && me.state !== 1 && me.state !== 2) break;   // 착지했다
    if (me.state === 1 || me.state === 2) {
      var shot = planPowerHit(w, iAmLeft, oppOf(w, iAmLeft).x);
      if (shot !== null && shot.margin > best) best = shot.margin;
    }
  }
  return best;
}

/**
 * 리시브: 어디에 설 것인가.
 * @param wantSetUp true면 "후속 공격의 여유"를, false면 "지금 넘겨서 얻는 여유"를 최대화
 */
function bestReceive(s, iAmLeft, wantSetUp) {
  var court = ownCourt(iAmLeft);
  var minX = court[0] + PLAYER_HALF_LENGTH;
  var maxX = court[1] - PLAYER_HALF_LENGTH;
  var center = s.ball.expectedLandingPointX;
  var best = null;

  for (var d = -TUNE.RECEIVE_SEARCH; d <= TUNE.RECEIVE_SEARCH; d += TUNE.RECEIVE_STEP) {
    var standX = center + d;
    if (standX < minX || standX > maxX) continue;
    var r = simulateBodyHit(s.ball, standX, PLAYER_TOUCHING_GROUND_Y_COORD, TUNE.RECEIVE_LOOKAHEAD);
    if (!r.ok) continue;
    if (Math.abs(standX - s.self.x) > r.frames * 6) continue;  // 걸어서 못 간다
    if (r.uncertain) continue;                                  // 난수 구간은 피한다

    // 리시브 직후의 공 상태를 만든다
    var b = { x: s.ball.x, y: s.ball.y, xVelocity: s.ball.xVelocity, yVelocity: s.ball.yVelocity };
    for (var f = 0; f < r.frames; f++) stepBallWorld(b);
    var dd = b.x - standX;
    b.xVelocity = dd < 0 ? -((Math.abs(dd) / 3) | 0) : (dd > 0 ? (Math.abs(dd) / 3) | 0 : 0);
    b.yVelocity = -Math.max(15, Math.abs(b.yVelocity));

    var score;
    if (!wantSetUp) {
      // 그대로 상대 코트로 넘긴다. 몸으로 넘긴 공의 여유를 잰다.
      var t = { x: b.x, y: b.y, xVelocity: b.xVelocity, yVelocity: b.yVelocity };
      var startLeft = t.x < GROUND_HALF_WIDTH, crossed = false, land = t.x, fr = 999;
      for (var g = 1; g <= TUNE.SHOT_SIM_FRAMES; g++) {
        var gr = stepBallWorld(t);
        if ((t.x < GROUND_HALF_WIDTH) !== startLeft) crossed = true;
        if (gr) { land = t.x; fr = g; break; }
      }
      var over = iAmLeft ? land > GROUND_HALF_WIDTH : land < GROUND_HALF_WIDTH;
      if (!crossed || !over) continue;                          // 반드시 넘겨야 한다
      score = Math.abs(land - s.opp.x) - opponentReach(fr);
    } else {
      // 내 코트에 띄운다. 그 공이 내려올 때 때리면 얼마나 좋은 공격이 되는가.
      var over2 = iAmLeft ? b.x > GROUND_HALF_WIDTH : b.x < GROUND_HALF_WIDTH;
      score = -9999;
      var t2 = { x: b.x, y: b.y, xVelocity: b.xVelocity, yVelocity: b.yVelocity };
      for (var h = 1; h <= TUNE.SETUP_SCAN_FRAMES; h++) {
        if (stepBallWorld(t2)) break;
        var mine = iAmLeft ? t2.x < GROUND_HALF_WIDTH : t2.x > GROUND_HALF_WIDTH;
        if (!mine) { score = -9999; break; }                    // 넘어가 버렸다
        // 정점 구간에서 칠 수 있는 높이인가
        if (t2.yVelocity <= 0) continue;                        // 아직 올라가는 중
        if (t2.y < TUNE.ATTACK_BEST_Y_MIN || t2.y > TUNE.ATTACK_BEST_Y_MAX) continue;
        var sh = bestShot(t2, s.opp.x, iAmLeft);
        if (sh.margin > score) score = sh.margin;
      }
      if (score <= -9999) continue;
      score -= TUNE.SETUP_COST;    // 터치를 하나 더 쓰는 대가
    }
    // ★ 동점 처리는 진영 중립이어야 한다. 후보를 x 오름차순으로 훑으면서 단순히
    //   `>`로 비교하면 점수가 같을 때 항상 x가 작은 쪽이 뽑히는데, LEFT에게 작은
    //   x는 "코트 깊숙이", RIGHT에게는 "네트 앞"이라 같은 코드가 진영에 따라
    //   정반대로 움직인다. 현재 위치에 가까운 쪽으로 깨면 대칭이 유지된다.
    if (
      best === null ||
      score > best.score + 0.001 ||
      (Math.abs(score - best.score) <= 0.001 &&
        Math.abs(standX - s.self.x) < Math.abs(best.standX - s.self.x))
    ) {
      best = { standX: standX, score: score, frames: r.frames };
    }
  }
  return best;
}

/**
 * 수비 대기 위치: 상대가 낼 수 있는 "최선의 여유"를 최소화하는 자리 (미니맥스).
 * 상대가 지금 공을 친다고 가정하고, 그들의 9가지 조합 중 최악을 내가 어디 서면
 * 가장 줄일 수 있는지 본다.
 */
function bestDefensiveStand(s, iAmLeft) {
  var myX = s.self.x;
  var court = ownCourt(iAmLeft);
  var minX = court[0] + PLAYER_HALF_LENGTH;
  var maxX = court[1] - PLAYER_HALF_LENGTH;
  var best = null;

  // 상대가 "지금 당장" 친다고 보면 안 된다. 공은 대개 상대 코트를 날아가는
  // 중이고, 실제 타격은 몇 프레임 뒤 다른 위치·다른 속도에서 일어난다.
  // 현재 상태로 계산하면 어디에 서든 점수가 비슷해져(판단 지형이 평평해져)
  // 동점 처리가 실제 위치를 결정해 버린다.
  // 그래서 공을 굴려 상대와 만나는 시점을 찾고, 그 상태에서 위협을 잰다.
  var ball = { x: s.ball.x, y: s.ball.y, xVelocity: s.ball.xVelocity, yVelocity: s.ball.yVelocity };
  var oppX = s.opp.x;
  for (var f = 0; f < TUNE.DEFENSE_LOOKAHEAD; f++) {
    var od = s.ball.expectedLandingPointX - oppX;   // 상대는 낙하지점으로 걸어온다
    if (Math.abs(od) > 6) oppX += od > 0 ? 6 : -6;
    if (isCollision(ball, oppX, PLAYER_TOUCHING_GROUND_Y_COORD)) break;
    if (stepBallWorld(ball)) break;
  }
  for (var x = minX; x <= maxX; x += TUNE.DEFENSE_STEP) {
    var worst = -9999;
    for (var ix = 0; ix <= 1; ix++) {
      for (var iy = -1; iy <= 1; iy++) {
        var r = shotOutcome(ball, ix, iy, !iAmLeft);           // 상대가 친다
        var toMe = iAmLeft ? r.landing < GROUND_HALF_WIDTH : r.landing > GROUND_HALF_WIDTH;
        if (!r.crossed || !toMe) continue;                     // 그건 상대 자책이다
        var m = Math.abs(r.landing - x) - opponentReach(r.frames);
        if (m > worst) worst = m;
      }
    }
    // 동점은 현재 위치에 가까운 쪽으로. (진영 중립 -- 위 bestReceive의 주석 참고)
    if (
      best === null ||
      worst < best.worst - 0.001 ||
      (Math.abs(worst - best.worst) <= 0.001 && Math.abs(x - myX) < Math.abs(best.x - myX))
    ) {
      best = { x: x, worst: worst };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------

function strategyDecide(s) {
  var iAmLeft = s.side === 'LEFT';
  var toNet = iAmLeft ? 1 : -1;
  var court = ownCourt(iAmLeft);
  var me = s.self;
  var ball = s.ball;
  var base = worldAtDecisionPoint(s, iAmLeft);

  var landing = ball.expectedLandingPointX;
  if (s.meta.rallyFrameCount < TUNE.STALE_PREDICTION_FRAMES) landing = ball.x;
  var comingToUs = landing > court[0] && landing < court[1];

  // === 공중: 접촉 구간이면 여유 최대인 각도로 친다 ==========================
  if (me.state === 1 || me.state === 2) {
    var shot = planPowerHit(base, iAmLeft, s.opp.x);
    if (shot !== null) return { x: shot.x, y: shot.y, hit: 1 };
    var aimX = ball.x - toNet * TUNE.AIR_CHASE_OFFSET;   // 정중앙은 피한다(자책·난수)
    var adx = aimX - me.x;
    return { x: Math.abs(adx) > 4 ? (adx > 0 ? 1 : -1) : 0, y: 0, hit: 0 };
  }

  // === 공이 상대 쪽: 미니맥스 수비 위치로 ===================================
  if (!comingToUs) {
    var stand = bestDefensiveStand(s, iAmLeft);
    var homeX = stand !== null
      ? stand.x
      : (iAmLeft ? TUNE.HOME_X_LEFT : GROUND_WIDTH - TUNE.HOME_X_LEFT);
    var hdx = homeX - me.x;
    return { x: Math.abs(hdx) > TUNE.MOVE_DEADBAND ? (hdx > 0 ? 1 : -1) : 0, y: 0, hit: 0 };
  }

  // === 점프 공격: 여유가 문턱을 넘을 때만 뛴다 ==============================
  if (TUNE.ENABLE_JUMP_ATTACK === 1 && jumpValue(base, iAmLeft) > TUNE.JUMP_MARGIN_THRESHOLD) {
    return { x: 0, y: -1, hit: 0 };
  }

  // === 리시브: 세우기와 바로 넘기기 중 여유가 큰 쪽 =========================
  var over = bestReceive(s, iAmLeft, false);
  var setup = TUNE.ENABLE_SETUP === 1 && G.myTouches === 0
    ? bestReceive(s, iAmLeft, true)
    : null;
  var pick = over;
  if (setup !== null && (over === null || setup.score > over.score)) pick = setup;

  var targetX = pick !== null ? pick.standX : landing - toNet * TUNE.FALLBACK_OFFSET;
  if (targetX < court[0] + PLAYER_HALF_LENGTH) targetX = court[0] + PLAYER_HALF_LENGTH;
  if (targetX > court[1] - PLAYER_HALF_LENGTH) targetX = court[1] - PLAYER_HALF_LENGTH;
  var dx = targetX - me.x;

  // === 구조: 걸어서 못 닿으면 다이빙 =======================================
  if (
    TUNE.ENABLE_DIVE === 1 &&
    me.state === 0 &&
    Math.abs(dx) > TUNE.DIVE_DISTANCE &&
    ball.y > TUNE.DIVE_MIN_BALL_Y &&
    G.prevAction.hit === 0
  ) {
    return { x: dx > 0 ? 1 : -1, y: 0, hit: 1 };
  }

  return { x: Math.abs(dx) > TUNE.MOVE_DEADBAND ? (dx > 0 ? 1 : -1) : 0, y: 0, hit: 0 };
}


// ============================================================================
// [7] decide() — 엔진이 매 틱(3프레임=120ms) 부르는 진입점
// ----------------------------------------------------------------------------
// 어떤 예외가 나도 매치를 망치지 않도록 통째로 감싼다. 예외가 나면 그 틱만
// 무입력 처리되지만, 여기서 잡아 두면 최소한 직전 판단을 이어갈 수 있다.
// ============================================================================
function decide(s) {
  try {
    // 틱 크기는 하드코딩하지 않는다. 대회 준비 중 조정될 수 있다고 가이드에
    // 명시돼 있고, 이 값이 틀리면 "몇 프레임 앞을 보는가"가 전부 어긋난다.
    if (s.config && s.config.tickFrameGroupSize > 0) {
      TICK_FRAMES = s.config.tickFrameGroupSize;
    }
    syncMirrors(s);
    var action = strategyDecide(s);
    // hit은 한 틱만 세우고 바로 내린다. 지상에서 계속 들고 있으면 다이빙이
    // 반복 발동해 락에 걸린다(착지 5프레임 경직 -> 복귀 -> 즉시 재다이빙).
    if (action.hit === 1 && G.prevAction.hit === 1 && s.self.state !== 1) {
      action = { x: action.x, y: action.y, hit: 0 };
    }
    G.prevAction = action;
    return action;
  } catch (e) {
    G.prevAction = { x: 0, y: 0, hit: 0 };
    return { x: 0, y: 0, hit: 0 };
  }
}
