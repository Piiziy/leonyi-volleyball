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
