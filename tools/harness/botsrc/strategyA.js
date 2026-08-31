// ============================================================================
// [5][6] 전략 A — 계층형 상태기계 + 정밀 조준
// ----------------------------------------------------------------------------
// ★ 이 전략의 핵심 원칙: 모든 판단은 "지금"이 아니라 "프레임 T+1~T+3"에 대한 것이다.
//
//   내가 지금 낸 행동은 1프레임 뒤부터 3프레임 동안 적용된다. 공은 프레임당
//   최대 20px 움직이므로, "지금 공이 가깝다"로 파워히트를 결정하면 3프레임 늦어
//   이미 몸에 맞고 튄 뒤에 발동한다. 그래서 후보 행동마다 미러로 그 구간을
//   실제로 굴려보고 결과를 비교한다.
//
// 터치 규칙이 전략의 뼈대다. 한 진영 5회째 접촉이 실점이므로 4회까지 쓸 수 있다.
//   1회차: 상황이 좋으면 네트 앞에 띄워 공격을 준비, 아니면 바로 넘긴다
//   2회차 이상: 무조건 넘긴다
// ============================================================================

/** 내 캐릭터를 world에서 꺼낸다 */
function meOf(w, iAmLeft) { return iAmLeft ? w.p1 : w.p2; }
function oppOf(w, iAmLeft) { return iAmLeft ? w.p2 : w.p1; }

/** world를 한 프레임 굴린다. 내 입력만 지정하고 상대는 추정한다. */
function advance(w, iAmLeft, mx, my, mh) {
  var og = guessOpponentInput(w, iAmLeft);
  if (iAmLeft) return stepFrame(w, mx, my, mh, og.x, og.y, og.hit);
  return stepFrame(w, og.x, og.y, og.hit, mx, my, mh);
}

/**
 * 스냅샷 시점(프레임 T 직전)에서 프레임 T를 소화한 world를 만든다.
 * 프레임 T는 직전 틱에 낸 행동이 적용되는 프레임이므로 이미 결정되어 있다.
 * 이 다음 프레임부터가 지금 고르는 행동의 영향권이다.
 */
function worldAtDecisionPoint(s, iAmLeft) {
  var w = cloneWorld(buildWorld(s, G.selfMirror, G.oppMirror));
  advance(w, iAmLeft, G.prevAction.x, G.prevAction.y, G.prevAction.hit);
  return w;
}

/**
 * 지금 파워히트를 내면 어떻게 되는가. x는 이동 방향이자 속도 배율이고 y는 각도라
 * 둘이 얽혀 있으므로 9가지 조합을 전부 실제로 굴려서 비교한다.
 *
 * @return {{x, y, landing, over}|null} 이 구간에 접촉이 없으면 null
 */
function planPowerHit(base, iAmLeft, oppX) {
  var me = meOf(base, iAmLeft);
  if (me.state !== 1 && me.state !== 2) return null;

  var best = null;
  for (var mx = -1; mx <= 1; mx++) {
    for (var my = -1; my <= 1; my++) {
      var w = cloneWorld(base);
      var hit = false;
      for (var f = 0; f < TUNE.HIT_WINDOW_FRAMES; f++) {
        var before = w.ball.isPowerHit;
        advance(w, iAmLeft, mx, my, 1);
        if (w.ball.isPowerHit && !before) { hit = true; break; }
      }
      if (!hit) continue;
      var landing = w.ball.expectedLandingPointX;
      var over = landsOnOpponent(landing, iAmLeft);
      // 상대 코트에 꽂히는 조합이 최우선, 그중 상대에게서 먼 것.
      var score = over ? 1000 + Math.abs(landing - oppX) : (iAmLeft ? landing : -landing);
      if (best === null || score > best.score) {
        best = { x: mx, y: my, landing: landing, over: over, score: score };
      }
    }
  }
  return best;
}

/**
 * 지금 점프하면 이번 비행 중에 상대 코트로 꽂는 파워히트가 가능한가.
 * 점프 입력도 T+1부터 적용되므로 그 지연을 넣어 굴린다.
 * @return 가능하면 true
 */
function jumpWillPayOff(base, iAmLeft) {
  var me = meOf(base, iAmLeft);
  if (me.state !== 0 || me.y !== PLAYER_TOUCHING_GROUND_Y_COORD) return false;

  var w = cloneWorld(base);
  var toNet = iAmLeft ? 1 : -1;
  for (var f = 0; f < TUNE.JUMP_LOOKAHEAD_FRAMES; f++) {
    me = meOf(w, iAmLeft);
    // 첫 3프레임은 점프 입력이 유지된다. 이후는 공 밑으로 붙되 정중앙은 피한다.
    var jy = f < 3 ? -1 : 0;
    var aim = w.ball.x - toNet * TUNE.AIR_CHASE_OFFSET;
    var d = aim - me.x;
    var jx = Math.abs(d) > 4 ? (d > 0 ? 1 : -1) : 0;
    advance(w, iAmLeft, jx, jy, 0);
    me = meOf(w, iAmLeft);
    if (f > 2 && me.state !== 1 && me.state !== 2) return false; // 헛점프
    if (me.state === 1 || me.state === 2) {
      var shot = planPowerHit(w, iAmLeft, oppOf(w, iAmLeft).x);
      if (shot !== null && shot.over) return true;
    }
  }
  return false;
}

/**
 * 어디에 서서 몸으로 받을지 고른다. 후보 위치를 전부 시뮬레이션해 실제 결과를 본다.
 * @param wantOver true면 상대 코트로 넘기기, false면 내 코트 네트 앞에 띄우기
 */
function bestReceiveSpot(s, iAmLeft, wantOver) {
  var court = ownCourt(iAmLeft);
  var toNet = iAmLeft ? 1 : -1;
  var center = s.ball.expectedLandingPointX;
  var minX = court[0] + PLAYER_HALF_LENGTH;
  var maxX = court[1] - PLAYER_HALF_LENGTH;
  var setTarget = GROUND_HALF_WIDTH - toNet * TUNE.SET_TARGET_FROM_NET;

  var best = null;
  for (var d = -TUNE.RECEIVE_SEARCH; d <= TUNE.RECEIVE_SEARCH; d += 2) {
    var standX = center + d;
    if (standX < minX || standX > maxX) continue;
    var r = simulateBodyHit(s.ball, standX, PLAYER_TOUCHING_GROUND_Y_COORD, TUNE.RECEIVE_LOOKAHEAD);
    if (!r.ok) continue;
    if (Math.abs(standX - s.self.x) > r.frames * 6) continue; // 걸어서 못 간다
    if (r.uncertain) continue;                                 // 난수 구간은 피한다

    var score;
    if (wantOver) {
      if (!landsOnOpponent(r.landing, iAmLeft)) continue;
      score = Math.abs(r.landing - s.opp.x);
    } else {
      if (landsOnOpponent(r.landing, iAmLeft)) continue;
      score = -Math.abs(r.landing - setTarget);
    }
    if (best === null || score > best.score) {
      best = { standX: standX, landing: r.landing, score: score, frames: r.frames };
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
  var base = worldAtDecisionPoint(s, iAmLeft);   // ★ 여기부터가 내 행동의 영향권

  // 랠리 사이 30프레임은 expectedLandingPointX가 직전 랠리의 값(거짓)이다.
  var landing = ball.expectedLandingPointX;
  if (s.meta.rallyFrameCount < TUNE.STALE_PREDICTION_FRAMES) landing = ball.x;
  var comingToUs = landing > court[0] && landing < court[1];

  // === 공중에 있다 =========================================================
  if (me.state === 1 || me.state === 2) {
    var shot = planPowerHit(base, iAmLeft, s.opp.x);
    if (shot !== null) return { x: shot.x, y: shot.y, hit: 1 };
    // 아직 접촉 구간이 아니다. 공 밑으로 붙되 정중앙은 피한다 --
    // 파워히트가 불발돼 몸에 맞으면 공이 수직으로 튀어 자책이 된다.
    if (TUNE.ENABLE_AIR_CHASE !== 1) return { x: 0, y: 0, hit: 0 };
    var aimX = ball.x - toNet * TUNE.AIR_CHASE_OFFSET;
    var adx = aimX - me.x;
    return { x: Math.abs(adx) > 4 ? (adx > 0 ? 1 : -1) : 0, y: 0, hit: 0 };
  }

  // === 공이 상대 쪽이다: 홈으로 물러나 대기 ================================
  if (!comingToUs) {
    var homeX = iAmLeft ? TUNE.HOME_X_LEFT : GROUND_WIDTH - TUNE.HOME_X_LEFT;
    var hdx = homeX - me.x;
    return { x: Math.abs(hdx) > TUNE.MOVE_DEADBAND ? (hdx > 0 ? 1 : -1) : 0, y: 0, hit: 0 };
  }

  // === 점프 공격: 이번 비행 중 상대 코트로 꽂을 수 있을 때만 뛴다 ===========
  if (TUNE.ENABLE_JUMP_ATTACK === 1 && jumpWillPayOff(base, iAmLeft)) {
    return { x: 0, y: -1, hit: 0 };
  }

  // === 리시브 =============================================================
  var nearNet = Math.abs(landing - GROUND_HALF_WIDTH) < TUNE.ATTACK_ZONE_FROM_NET;
  var trySetUp =
    TUNE.ENABLE_SETUP === 1 &&
    G.myTouches === 0 &&
    !nearNet &&                          // 이미 네트 앞이면 바로 공격이 낫다
    ball.y < TUNE.SETUP_MAX_BALL_Y;
  var spot = trySetUp ? bestReceiveSpot(s, iAmLeft, false) : null;
  if (spot === null) spot = bestReceiveSpot(s, iAmLeft, true);

  var targetX = spot !== null ? spot.standX : landing - toNet * TUNE.FALLBACK_OFFSET;
  if (targetX < court[0] + PLAYER_HALF_LENGTH) targetX = court[0] + PLAYER_HALF_LENGTH;
  if (targetX > court[1] - PLAYER_HALF_LENGTH) targetX = court[1] - PLAYER_HALF_LENGTH;
  var dx = targetX - me.x;

  // === 구조: 걸어서 못 닿으면 다이빙 (착지 후 5프레임 경직을 각오하고) ======
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
