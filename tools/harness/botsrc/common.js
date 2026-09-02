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
  errorReported: false,  // decide 예외를 한 번만 알리기 위한 플래그

  // --- 물리 발산 감시 ([4c]) ------------------------------------------------
  // 당일 스킬로 물리가 바뀌면 이 봇은 틀린 물리로 계획하게 된다. 매 틱 스스로를
  // 채점해서, 계속 어긋나면 탐색을 끄고 단순 모드로 내려간다.
  prediction: null,      // 직전 틱에 적어 둔 "다음 틱은 이럴 것이다"
  watch: {
    checked: 0, ok: 0, miss: 0,
    recent: 0,           // 최근 16틱의 적중 여부 비트맵 (1 = 틀림)
    degraded: false,     // true 면 단순 모드
    firstMiss: null,     // 첫 불일치의 내용 (당일 원인 파악용)
  },
  // --- 상대 스펙 관측 ([4b]) ------------------------------------------------
  // 상대 봇은 "쿠세"는 없어도 "능력치"는 못 숨긴다. 다이빙을 쓰는지, 점프 공격을
  // 하는지는 매 틱 관측된다. 이 값들이 여유(margin) 공식의 상수를 대체한다.
  oppSpec: {
    ticks: 0,        // 상대를 관측한 틱 수
    dives: 0,        // 다이빙(state 3)을 본 횟수
    smashes: 0,      // 파워히트(state 2)를 본 횟수
    jumps: 0,        // 점프(state 1)를 본 횟수
    maxStep: 0,      // 관측된 최대 이동 속도 (px/프레임)
    stress: 0,       // 상대가 실제로 쫓아가야 했던 상황의 수
  },

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

  observeOpponent(s);

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

/**
 * 시뮬레이션 안에서 한쪽 선수가 낼 법한 입력. 양쪽에 똑같이 쓴다.
 *
 * ★ 예전에는 "낙하지점으로 걷기"만 했다. 그러면 탐색이 절대 때리지 않는
 *   허수아비들끼리의 경기를 계산하게 된다. 결과는 두 가지로 나빴다:
 *     - 상대가 강타할 수 있는 자리에 공을 올려주고도 좋은 수로 착각한다
 *     - 탐색 지평선 너머의 우리 공격력이 평가에서 통째로 빠진다
 *   측정상 롤아웃의 95%가 지평선 전에 끝나므로, 이 정책이 곧 평가함수다.
 *
 *   그래서 양쪽 다 기회가 오면 점프해서 내리꽂는다고 본다. 각도는 y=1(급강하)로
 *   고정하는데, 분석상 그게 거의 항상 최선이기 때문이다(짧고 빠른 급강하 =
 *   비행 6프레임 = 못 받는 공). 매번 9가지를 계산하면 탐색이 몇 배 느려진다.
 *
 * @param playerIsLeft 입력을 구할 선수가 왼쪽인가
 * @param isSelf 이 선수가 "나"인가 (공격 시뮬레이션을 켜고 끄는 스위치가 다르다)
 */
function policyFor(w, playerIsLeft, isSelf) {
  var mayAttack = isSelf ? TUNE.SIM_ATTACK_SELF === 1 : TUNE.SIM_ATTACK_OPP === 1;
  var p = playerIsLeft ? w.p1 : w.p2;
  var ball = w.ball;
  var courtMin = playerIsLeft ? 0 : GROUND_HALF_WIDTH;
  var courtMax = playerIsLeft ? GROUND_HALF_WIDTH : GROUND_WIDTH;
  var ballOnMySide = ball.x > courtMin && ball.x < courtMax;

  // 공중에 떠 있고 공이 사거리 안이면 내리꽂는다.
  if (mayAttack && (p.state === 1 || p.state === 2) && ballOnMySide) {
    if (
      Math.abs(ball.x - p.x) < TUNE.OPP_HIT_REACH &&
      Math.abs(ball.y - p.y) < TUNE.OPP_HIT_REACH
    ) {
      var toBall = ball.x - p.x;
      // 스매시 각도를 고른다.
      //
      // ★ 거리 문턱으로 정하면 안 된다. y=1(급강하)이 넘어가는지는 네트까지의
      //   거리뿐 아니라 **접촉 높이와 공의 속도**에도 달려 있다. 거리만 보고
      //   정했더니 낮은 공(높이 150)에서 자기 코트에 꽂는 경우가 남았다
      //   (sanity.js 가 잡아냈다). 시뮬 속 선수가 자멸하면 봇은 "상대가 알아서
      //   자책골을 넣는다"고 계산해 받기 좋은 공을 상대에게 준다 -- 실전에서
      //   관찰된 실점 패턴이 이것이었다.
      //
      //   그래서 실제로 굴려서 **넘어가는 것 중 가장 가파른 각도**를 고른다.
      //   이 코드는 정책이 "때린다"고 판단한 프레임에서만 도는데, 롤아웃
      //   90프레임 중 몇 개뿐이라 비용이 감당된다.
      // ★ 파워히트의 방향은 선수의 진영이 아니라 **공이 네트의 어느 쪽에 있는가**
      //   로 정해진다(physics.js processCollisionBetweenBallAndPlayer). 선수의
      //   진영으로 판단하면 공이 네트를 살짝 넘은 순간 반대로 계산한다 --
      //   실제로 이 실수로 진영별 승률이 18% 대 100% 로 갈렸다.
      var smashX = Math.abs(toBall) > 4 ? (toBall > 0 ? 1 : -1) : 0;
      var pushRight = ball.x < GROUND_HALF_WIDTH;      // 엔진과 같은 규칙
      var speed = (Math.abs(smashX) + 1) * 10;          // 실제로 낼 x 와 같은 배율
      var smashY = -1;                       // 아치는 대개 넘어간다(최후 수단)
      for (var yi = 1; yi >= -1; yi--) {     // 급강하 -> 수평 -> 아치 순으로 시도
        var probe = {
          x: ball.x, y: ball.y,
          xVelocity: pushRight ? speed : -speed,
          yVelocity: Math.abs(ball.yVelocity) * yi * 2,
        };
        var over = false;
        for (var pf = 0; pf < TUNE.SMASH_PROBE_FRAMES; pf++) {
          if (stepBallWorld(probe)) break;
          // 상대 코트에 도달했는가 (내 코트 기준으로 판정)
          if (playerIsLeft ? probe.x > GROUND_HALF_WIDTH : probe.x < GROUND_HALF_WIDTH) {
            over = true;
            break;
          }
        }
        if (over) { smashY = yi; break; }
      }
      return { x: smashX, y: smashY, hit: 1 };
    }
  }

  // 낙하지점으로 걷되 정중앙은 피한다(몸 한가운데로 받으면 공이 수직으로 튄다).
  //
  // ★ 상대 모델은 원래 비켜서지 않고 낙하지점을 정확히 향했다(임계값 8).
  //   policyFor 로 합치면서 우리 쪽 방식이 상대에게도 적용됐는데, 그건 상대
  //   모델을 바꾼 것이다. SIM_WALK_LEGACY=1 이면 옛 상대 모델로 되돌린다.
  var toNet = playerIsLeft ? 1 : -1;
  var legacyOpponentWalk = TUNE.SIM_WALK_LEGACY === 1 && !isSelf;
  var target = legacyOpponentWalk
    ? ball.expectedLandingPointX
    : ball.expectedLandingPointX - toNet * TUNE.AIR_CHASE_OFFSET;
  var dx = target - p.x;
  var threshold = legacyOpponentWalk ? 8 : TUNE.MOVE_DEADBAND;
  var mx = Math.abs(dx) > threshold ? (dx > 0 ? 1 : -1) : 0;

  // 걸어서는 못 닿지만 다이빙이면 닿는 공에는 몸을 던진다.
  //
  // ★ 이게 없으면 시뮬레이션 속 선수들이 **다이빙을 전혀 안 한다.** 실제 봇에게
  //   다이빙은 핵심 수단인데(후보에서 빼면 승률 15% 로 붕괴) 롤아웃에서 빠져
  //   있으면 양쪽의 수비 범위를 과소평가하게 된다 -- 우리 공격은 실제보다
  //   위협적으로, 상대 공격은 실제보다 덜 위협적으로 보인다.
  if (
    TUNE.SIM_DIVE === 1 &&
    p.state === 0 &&
    p.y === PLAYER_TOUCHING_GROUND_Y_COORD &&
    ballOnMySide &&
    ball.y > TUNE.SIM_DIVE_BALL_Y &&
    Math.abs(target - p.x) > TUNE.SIM_DIVE_MIN_DX
  ) {
    return { x: target > p.x ? 1 : -1, y: 0, hit: 1 };
  }

  // 공이 내 코트로 높이 떨어지는 중이면 점프해서 맞이한다.
  if (
    mayAttack &&
    p.state === 0 &&
    p.y === PLAYER_TOUCHING_GROUND_Y_COORD &&
    ballOnMySide &&
    ball.yVelocity > 0 &&
    ball.y < TUNE.OPP_JUMP_BALL_Y &&
    Math.abs(ball.x - p.x) < TUNE.OPP_JUMP_ALIGN_X
  ) {
    return { x: mx, y: -1, hit: 0 };
  }

  return { x: mx, y: 0, hit: 0 };
}

/** 상대 쪽 입력 추정 (policyFor의 얇은 래퍼) */
function guessOpponentInput(w, iAmLeft) {
  return policyFor(w, !iAmLeft, false);
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
  return observedDiveSpeed() * Math.max(0, f - TUNE.OPP_REACTION_FRAMES) + PLAYER_HALF_LENGTH;
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
// [4b] 상대 스펙 관측 — 봇은 쿠세는 없어도 능력치는 못 숨긴다
// ----------------------------------------------------------------------------
// 여유 공식의 상수(상대가 얼마나 빨리 움직이는가)를 고정값으로 두면, 느린
// 상대에게는 지나치게 소극적이고 빠른 상대에게는 지나치게 낙관적이 된다.
// 매 틱 관측해서 실제 값으로 바꾼다.
//
// ★ 반드시 보수적으로 시작한다. 증거가 쌓이기 전에는 상대가 최고 성능이라고
//   가정한다. 그래야 초반에 과신해서 실점하지 않는다. 완화는 증거가 있을 때만.
// ============================================================================

/** 매 틱 호출. 상대의 상태를 누적 관측한다. */
function observeOpponent(s) {
  var spec = G.oppSpec;
  spec.ticks++;
  if (s.opp.state === 3) spec.dives++;
  if (s.opp.state === 2) spec.smashes++;
  if (s.opp.state === 1) spec.jumps++;
  if (G.prevSnapshot !== null) {
    // 한 틱 = 3프레임. 그 사이 이동량으로 실제 속도를 잰다.
    var step = Math.abs(s.opp.x - G.prevSnapshot.opp.x) / 3;
    if (step > spec.maxStep) spec.maxStep = step;
    // 공이 상대 쪽으로 떨어지는데 상대가 멀리 있으면 "쫓아가야 하는 상황"이다.
    // 이런 상황을 몇 번 겪고도 다이빙을 안 했다면 다이빙을 안 쓰는 봇이다.
    var oppSideBall = s.side === 'LEFT'
      ? s.ball.expectedLandingPointX > GROUND_HALF_WIDTH
      : s.ball.expectedLandingPointX < GROUND_HALF_WIDTH;
    if (oppSideBall && Math.abs(s.ball.expectedLandingPointX - s.opp.x) > 60) spec.stress++;
  }
}

/**
 * 관측에 근거한 상대의 실제 최대 이동 속도.
 * 다이빙을 쓰면 8, 안 쓰면 6이다. 2px/프레임 차이는 커 보이지 않지만,
 * 비행 20프레임이면 40px 차이라 우리가 노릴 수 있는 코스가 크게 넓어진다.
 */
function observedDiveSpeed() {
  if (TUNE.SPEC_ADAPT !== 1) return TUNE.OPP_DIVE_SPEED;
  var spec = G.oppSpec;
  var enoughEvidence =
    spec.ticks > TUNE.SPEC_MIN_TICKS && spec.stress > TUNE.SPEC_MIN_STRESS;
  if (enoughEvidence && spec.dives === 0) return TUNE.OPP_WALK_SPEED;
  return TUNE.OPP_DIVE_SPEED;
}

/**
 * 상대가 점프 파워히트를 하는 봇인가.
 * 안 하는 상대라면 우리가 두려워할 강타가 없다 -> 수비를 앞으로 당겨도 된다.
 */
function opponentSmashes() {
  if (TUNE.SPEC_ADAPT !== 1) return true;
  var spec = G.oppSpec;
  if (spec.ticks <= TUNE.SPEC_MIN_TICKS) return true; // 증거 없으면 있다고 본다
  return spec.smashes > 0;
}

/**
 * 수비 대기 위치 — 상대가 낼 수 있는 최선의 결과를 **최소화**하는 자리(미니맥스).
 *
 * ★ 왜 필요한가
 *   공이 상대 코트에 있으면 탐색 지평선(약 4~5틱) 안에서 우리가 뭘 하든 결과가
 *   같다. 그 뒤는 롤아웃 정책이 어차피 같은 자리로 걸어가니 차이가 사라진다.
 *   그래서 모든 후보가 동점이 되고 봇은 **91.2% 의 프레임을 가만히 서서** 보낸다
 *   (실측). 상대가 스매시를 준비하는 동안 아무 대비도 안 하는 것이다.
 *
 *   탐색이 구분하지 못하는 구간이므로 명시적으로 자리를 잡는다. 상대가 지금
 *   공을 잡아 6가지 각도로 때린다고 보고, 그중 **최악을 가장 잘 막는 x** 를 찾는다.
 *
 * @return {{x:number, worst:number}|null} 상대가 넘길 수 있는 수가 없으면 null
 */
function bestDefensiveStand(s, iAmLeft) {
  var court = ownCourt(iAmLeft);
  var minX = court[0] + PLAYER_HALF_LENGTH;
  var maxX = court[1] - PLAYER_HALF_LENGTH;

  // 상대가 실제로 공을 잡을 지점까지 굴린다. 지금 위치에서 때린다고 보면
  // 접촉 높이가 달라 위협을 잘못 잰다.
  var b = {
    x: s.ball.x, y: s.ball.y,
    xVelocity: s.ball.xVelocity, yVelocity: s.ball.yVelocity,
  };
  var oppX = s.opp.x;
  var found = false;
  for (var f = 1; f <= TUNE.THREAT_SCAN_FRAMES; f++) {
    if (stepBallWorld(b)) break;
    if (Math.abs(b.x - oppX) > TUNE.OPP_WALK_SPEED * f + PLAYER_HALF_LENGTH) continue;
    if (b.y < TUNE.SMASH_MIN_BALL_Y) continue;
    found = true;
    break;
  }
  if (!found) return null;

  // 그 지점에서 상대가 낼 수 있는 모든 결과를 미리 구해 둔다.
  var shots = [];
  for (var ix = 0; ix <= 1; ix++) {
    for (var iy = -1; iy <= 1; iy++) {
      var r = shotOutcome(b, ix, iy, !iAmLeft);
      var toMe = iAmLeft
        ? r.landing < GROUND_HALF_WIDTH
        : r.landing > GROUND_HALF_WIDTH;
      if (!r.crossed || !toMe) continue;        // 그건 상대의 자책이다
      shots.push(r);
    }
  }
  if (shots.length === 0) return null;

  var best = null;
  for (var x = minX; x <= maxX; x += TUNE.DEFENSE_STEP) {
    var worst = -9999;
    for (var i = 0; i < shots.length; i++) {
      // 내가 x 에 서 있을 때 그 공의 여유(상대에게 유리할수록 큼)
      var m = Math.abs(shots[i].landing - x) - opponentReach(shots[i].frames);
      if (m > worst) worst = m;
    }
    if (best === null || worst < best.worst) best = { x: x, worst: worst };
  }
  return best;
}

/**
 * 한쪽이 이 공으로 낼 수 있는 "최선의 위협".
 *
 * ★ 이 봇의 2수 평가의 핵심. 지금 공 위치에서 바로 때린다고 가정하면 안 된다 --
 *   실제 타격은 공이 날아간 뒤 다른 높이에서 일어나고, 접촉 높이가 위협을
 *   좌우한다(y≈100~120에서 잡으면 결정타, y>160이면 무해).
 *   그래서 공을 앞으로 굴려 "첫 접촉 가능 지점"을 찾고 거기서 평가한다.
 *
 * 공격측·수비측을 바꿔 부르면 양쪽에 똑같이 쓸 수 있다.
 *
 * @param ball 현재 공
 * @param attackerX 때릴 쪽의 x
 * @param attackerIsLeft 때릴 쪽이 왼쪽인가
 * @param defenderX 맞을 쪽의 x
 * @param attackerIsOpponent 때리는 쪽이 상대인가 (관측한 상대 스펙을 적용할지)
 * @return 여유(margin). 클수록 때리는 쪽에 유리.
 *         공이 때리는 쪽 코트에 그냥 떨어지면 매우 낮은 값(그쪽 실점).
 */
function threatOf(ball, attackerX, attackerIsLeft, defenderX, attackerIsOpponent) {
  var b = {
    x: ball.x, y: ball.y,
    xVelocity: ball.xVelocity, yVelocity: ball.yVelocity,
  };
  for (var f = 1; f <= TUNE.THREAT_SCAN_FRAMES; f++) {
    if (stepBallWorld(b)) {
      // 아무도 못 건드리고 떨어졌다. 때리는 쪽 코트면 그쪽 실점.
      var onAttacker = attackerIsLeft
        ? b.x < GROUND_HALF_WIDTH
        : b.x > GROUND_HALF_WIDTH;
      return onAttacker ? -1000 : 1000;
    }
    // 때리는 쪽이 f프레임 안에 이 x까지 갈 수 있나 (걷기 기준, 히트박스 포함)
    if (Math.abs(b.x - attackerX) > TUNE.OPP_WALK_SPEED * f + PLAYER_HALF_LENGTH) continue;
    // 점프해도 못 닿을 만큼 높으면 아직 기회가 아니다
    if (b.y < TUNE.SMASH_MIN_BALL_Y) continue;

    var shot = bestShot(b, defenderX, attackerIsLeft);
    // 낮게 잡은 공은 몸으로 퍼올리는 게 전부라 위협이 훨씬 작다.
    if (b.y > TUNE.SMASH_MAX_BALL_Y) return shot.margin * TUNE.BUMP_THREAT_SCALE;
    // 파워히트를 한 번도 안 쓴 상대라면 높은 공을 잡아도 강타가 오지 않는다.
    if (attackerIsOpponent && !opponentSmashes()) {
      return shot.margin * TUNE.BUMP_THREAT_SCALE;
    }
    return shot.margin;
  }
  return 0; // 지평선 안에 접촉이 없다 -- 판단 보류
}
