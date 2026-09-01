// ============================================================================
// [4c] 물리 발산 감지 — 당일 스킬 추가에 대비한 안전장치
// ----------------------------------------------------------------------------
// 이 봇은 물리 엔진 복사본([3])으로 미래를 계산해 수를 고른다. 그게 강점이지만,
// **대회 당일 새 스킬로 물리가 바뀌면 틀린 물리로 자신 있게 계획하게 된다.**
// 단순 휴리스틱 봇은 조금 나빠질 뿐이지만, 이 봇은 크게 헛짚을 수 있다.
//
// 그래서 매 틱 스스로를 채점한다:
//   1) 이번 틱에 "다음 틱의 공과 내 위치가 어떻게 될지" 예측해서 적어 둔다
//   2) 다음 틱에 실제로 온 스냅샷과 비교한다
//   3) 계속 어긋나면 탐색을 끄고 단순 모드로 내려간다
//
// 미러가 실제 엔진과 프레임 단위로 일치한다는 건 검증돼 있다(53만 프레임,
// 불일치 0). 그러니 어긋남이 관측되면 그건 진짜로 규칙이 바뀐 것이다.
//
// ★ 오탐을 막는 게 설계의 핵심이다. 상대가 공을 건드리면 예측이 어긋나는 게
//   당연하다. 그건 물리 변경이 아니다. 그래서 **예측 구간 내내 공이 양쪽
//   플레이어에게서 충분히 멀었을 때만** 채점한다. 그 구간의 공은 순수 자유낙하라
//   물리만으로 결정되기 때문이다.
// ============================================================================

/**
 * 이번 틱의 예측을 적어 둔다. decide() 가 행동을 정한 직후에 부른다.
 *
 * 전략 코드에 의존하지 않는다 -- 이 파일만 읽어도 무슨 일이 일어나는지 알 수
 * 있어야 당일에 손댈 수 있다.
 *
 * 타이밍: 스냅샷 T 와 스냅샷 T+3 사이에 프레임 T, T+1, T+2 가 실행된다.
 *   프레임 T   -> 직전 틱의 행동 (이미 확정)
 *   프레임 T+1, T+2 -> 이번 틱에 반환할 행동
 *
 * @param action 이번 틱에 반환할 행동
 */
/** 스냅샷에서 관측된, 공과 두 플레이어 사이의 최소 거리 */
function ballClearance(s) {
  var b = s.ball;
  var d1 = Math.max(Math.abs(b.x - s.self.x), Math.abs(b.y - s.self.y));
  var d2 = Math.max(Math.abs(b.x - s.opp.x), Math.abs(b.y - s.opp.y));
  return Math.min(d1, d2);
}

function recordPrediction(s, iAmLeft, action) {
  var w = cloneWorld(buildWorld(s, G.selfMirror, G.oppMirror));
  var steps = [G.prevAction, action, action];
  for (var f = 0; f < steps.length; f++) {
    var a = steps[f];
    var og = guessOpponentInput(w, iAmLeft);
    if (iAmLeft) stepFrame(w, a.x, a.y, a.hit, og.x, og.y, og.hit, true);
    else stepFrame(w, og.x, og.y, og.hit, a.x, a.y, a.hit, true);
  }
  var me = iAmLeft ? w.p1 : w.p2;
  G.prediction = {
    tick: G.ticks,
    ballX: w.ball.x, ballY: w.ball.y,
    ballVX: w.ball.xVelocity, ballVY: w.ball.yVelocity,
    selfX: me.x, selfY: me.y, selfState: me.state,
    // ★ 접촉 여부는 **관측된** 위치로 판정한다. 예측된 상대 위치를 쓰면
    //   상대 입력이 추정이라 빗나가고, 실제로는 상대가 공을 쳤는데 "접촉
    //   없었다"고 잘못 판정해 오탐이 난다(측정: 오탐률 20%).
    clearanceAtStart: ballClearance(s),
    // 채점 시점에 "그 사이 물리가 실제로 돌았는가"를 확인하기 위한 관측값.
    observedBallX: s.ball.x, observedBallY: s.ball.y,
    rallyFrame: s.meta.rallyFrameCount,
    scoreSum: s.meta.score.self + s.meta.score.opp,
    // 세로(y·state)는 지상에 있을 때만 채점한다. 공중에서는 y속도를 y좌표에서
    // 역산하는데(inferJumpYVelocity) 정점 근처에서 상승/하강 분기를 잘못
    // 고를 수 있어 그 자체가 오차원이다.
    //
    // 가로(x)는 공중에서도 채점한다. 수평 이동은 state<3 이면 공중이든
    // 지상이든 xDirection * 6 으로 같아서 예측이 정확하기 때문이다.
    // 이걸 빼면 "이동 속도가 바뀌는" 종류의 변경을 못 잡는다(실측: 감지 실패).
    selfGrounded: s.self.state === 0 && s.self.y === PLAYER_TOUCHING_GROUND_Y_COORD,
    selfWalkable: s.self.state < 3,
  };
}

/**
 * 직전 틱의 예측을 이번 스냅샷과 대조한다. 매 틱 처음에 부른다.
 *
 * 공(자유낙하 구간)과 내 캐릭터만 본다. 상대는 입력을 모르니 채점하지 않는다 --
 * 내 입력은 내가 알고 있으므로 내 위치는 정확히 예측돼야 한다.
 */
function checkPrediction(s) {
  var p = G.prediction;
  G.prediction = null;
  if (p === null || p.tick !== G.ticks - 1) return;

  // 예측 구간의 양 끝에서 공이 두 플레이어 모두에게서 충분히 멀었을 때만
  // 채점한다. 그 사이 공은 순수 자유낙하라 물리만으로 결정된다.
  // 공은 프레임당 최대 20px, 플레이어는 8px 움직이므로, 3프레임 동안 접촉이
  // 성립하려면 시작이나 끝 중 한쪽은 반드시 가까워야 한다.
  if (p.clearanceAtStart < TUNE.WATCH_CLEARANCE) return;
  if (ballClearance(s) < TUNE.WATCH_CLEARANCE) return;

  // ★ 랠리 사이에는 엔진이 물리를 돌리지 않는다. 득점 후 페이드와 "READY?"
  //   구간(약 35프레임) 동안에도 봇은 계속 호출되지만 공은 멈춰 있다. 그때
  //   3프레임 진행을 가정한 예측은 당연히 어긋나므로 채점하면 안 된다.
  //   공이 전혀 안 움직였으면 그 구간이다(자유낙하 중이면 반드시 움직인다).
  if (s.ball.x === p.observedBallX && s.ball.y === p.observedBallY) return;
  // 랠리가 바뀌었으면(득점) 그 사이 공이 리셋됐으므로 비교 대상이 아니다.
  if (s.meta.rallyFrameCount < p.rallyFrame) return;
  // 득점 직후에는 슬로모션이 돈다 -- gameLoop 다섯 번에 물리 한 번만 진행하므로
  // "3프레임 진행"을 가정한 예측이 어긋나는 게 정상이다.
  if (s.meta.score.self + s.meta.score.opp !== p.scoreSum) return;
  // 랠리 시작 경계에서는 한 틱(3프레임) 안에 물리가 2프레임만 도는 일이 있다
  // (페이드->라운드 전환이 틱 중간에 걸린다). 그 경우 예측이 정확히 "중력 한 번
  // 덜 먹은" 모양으로 어긋난다. 랠리가 충분히 진행된 뒤부터만 채점한다.
  if (s.meta.rallyFrameCount < TUNE.WATCH_MIN_RALLY_FRAME) return;

  var b = s.ball;
  var ballOk =
    b.x === p.ballX && b.y === p.ballY &&
    b.xVelocity === p.ballVX && b.yVelocity === p.ballVY;
  var groundedNow = s.self.state === 0 && s.self.y === PLAYER_TOUCHING_GROUND_Y_COORD;
  var walkableNow = s.self.state < 3;
  // 가로는 넓게, 세로는 지상일 때만 (위 주석 참고)
  var selfXOk = !(p.selfWalkable && walkableNow) || s.self.x === p.selfX;
  var selfYOk =
    !(p.selfGrounded && groundedNow) ||
    (s.self.y === p.selfY && s.self.state === p.selfState);
  var selfOk = selfXOk && selfYOk;

  G.watch.checked++;
  if (ballOk && selfOk) {
    G.watch.ok++;
    G.watch.recent = (G.watch.recent << 1) & 0xffff;          // 0 = 맞음
  } else {
    G.watch.miss++;
    G.watch.recent = ((G.watch.recent << 1) | 1) & 0xffff;    // 1 = 틀림
    if (G.watch.firstMiss === null) {
      G.watch.firstMiss = {
        tick: G.ticks,
        ball: [b.x - p.ballX, b.y - p.ballY, b.xVelocity - p.ballVX, b.yVelocity - p.ballVY],
        self: [s.self.x - p.selfX, s.self.y - p.selfY, s.self.state - p.selfState],
      };
    }
  }

  // 최근 16틱 중 몇 번 틀렸나 (비트 세기)
  var bits = G.watch.recent;
  var recentMiss = 0;
  while (bits) { recentMiss += bits & 1; bits >>= 1; }

  // 두 가지로 판단한다.
  //   급성: 최근 16틱 중 여러 번 틀림  -> 물리가 크게 바뀐 경우(예: 중력)
  //   만성: 누적 불일치율이 계속 높음  -> 조금씩 틀린 경우(예: 이동 속도)
  // 급성만 보면 만성을 놓치고(실측: 이동속도 변경 시 14% 불일치인데 문턱 미달),
  // 만성만 보면 반응이 느리다.
  var acute = recentMiss >= TUNE.WATCH_MISS_THRESHOLD;
  var chronic =
    G.watch.checked >= TUNE.WATCH_CHRONIC_SAMPLES &&
    G.watch.miss / G.watch.checked >= TUNE.WATCH_CHRONIC_RATE;
  if (!G.watch.degraded && G.watch.checked >= TUNE.WATCH_MIN_SAMPLES &&
      (acute || chronic)) {
    G.watch.degraded = true;
    // 당일 F12 콘솔에서 바로 보이도록 한 번만 알린다.
    console.warn(
      '[bot] 물리 예측이 실제와 어긋난다 -- 규칙이 바뀐 것으로 보고 단순 모드로 전환한다.\n' +
      '      최근 16틱 중 ' + recentMiss + '회 불일치, 누적 ' + G.watch.miss + '/' +
      G.watch.checked + '. 첫 불일치: ' +
      JSON.stringify(G.watch.firstMiss) + '\n' +
      '      ★ 물리 미러([3] 섹션)를 새 규칙에 맞게 고치면 탐색 모드로 돌아온다.'
    );
  }
  // 다시 맞기 시작하면 복귀한다(미러를 고쳤거나 오탐이었던 경우).
  if (G.watch.degraded && recentMiss === 0 && !chronic &&
      G.watch.checked > TUNE.WATCH_MIN_SAMPLES) {
    G.watch.degraded = false;
    console.warn('[bot] 물리 예측이 다시 맞는다 -- 탐색 모드로 복귀한다.');
  }
}

/**
 * 단순 모드 — 물리 미러를 전혀 쓰지 않는다.
 *
 * 엔진이 주는 expectedLandingPointX 만 믿고 몸으로 받아 넘긴다. 규칙이 어떻게
 * 바뀌어도 "낙하지점으로 가서 몸으로 받는다"는 유효하다. 가이드의 Positioning
 * 예제와 같은 수준인데, 그것만으로도 내장 AI 를 71% 이긴다.
 */
function safeModeDecide(s) {
  var iAmLeft = s.side === 'LEFT';
  var toNet = iAmLeft ? 1 : -1;
  var court = ownCourt(iAmLeft);
  var me = s.self;
  var ball = s.ball;

  var landing = ball.expectedLandingPointX;
  // 랠리 사이 30프레임은 이 값이 직전 랠리의 것이다(엔진이 리셋하지 않는다).
  if (s.meta.rallyFrameCount < TUNE.STALE_PREDICTION_FRAMES) landing = ball.x;
  var comingToUs = landing > court[0] && landing < court[1];

  var targetX = comingToUs
    ? landing - toNet * TUNE.SAFE_RECEIVE_OFFSET   // 몸의 네트쪽 면으로 받는다
    : (iAmLeft ? TUNE.HOME_X_LEFT : GROUND_WIDTH - TUNE.HOME_X_LEFT);
  if (targetX < court[0] + PLAYER_HALF_LENGTH) targetX = court[0] + PLAYER_HALF_LENGTH;
  if (targetX > court[1] - PLAYER_HALF_LENGTH) targetX = court[1] - PLAYER_HALF_LENGTH;

  var dx = targetX - me.x;
  var x = Math.abs(dx) > TUNE.MOVE_DEADBAND ? (dx > 0 ? 1 : -1) : 0;

  // 점프는 엄격하게. 어설픈 점프는 착지 전에 공이 지나가 버린다.
  var y = 0;
  if (
    me.state === 0 &&
    Math.abs(ball.x - me.x) < PLAYER_HALF_LENGTH &&
    Math.abs(ball.xVelocity) < 5 &&
    ball.y < TUNE.SAFE_JUMP_BALL_Y &&
    ball.yVelocity > 0
  ) {
    y = -1;
  }
  // 단순 모드에서는 다이빙을 쓰지 않는다. 실패하면 경직 5프레임이 그대로 손해고,
  // 물리가 바뀐 상황에서 다이빙 궤적이 어떻게 되는지 알 수 없다.
  return { x: x, y: y, hit: 0 };
}
