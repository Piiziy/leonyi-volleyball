// ============================================================================
// [6] 전략 — 짧은 지평선 전탐색
// ----------------------------------------------------------------------------
// 규칙을 사람이 쓰지 않는다. 앞으로 몇 틱치 행동 조합을 전부 [3]의 물리 미러로
// 굴려보고, 랠리가 어떻게 끝나는지로 점수를 매겨 최선을 고른다.
//
// 왜 이 방식인가: 사람이 쓴 규칙(상태기계)과 붙여 봤을 때 압도적으로 강했다.
// 규칙 기반이 놓치는 수 -- 일부러 공을 흘려보내거나, 몸으로 받아 각을 만드는 --
// 을 탐색은 그냥 찾아낸다.
//
// ★ 당일 봇의 성격을 바꾸려면 두 곳만 보면 된다:
//     rollout() 의 점수    — 랠리가 어떻게 끝나야 좋은가
//     [1] MARGIN_WEIGHT   — 결말이 안 났을 때 공격 자세를 얼마나 중시하는가
// ============================================================================

function meOf(w, iAmLeft) { return iAmLeft ? w.p1 : w.p2; }

/**
 * 탐색용 한 프레임. 착지 예측 계산을 끄고 굴린다(skipLandingPrediction).
 * 물리는 그대로 정확하고, expectedLandingPointX만 낡은 값으로 남는다.
 * 이 값은 상대의 걷는 방향을 추정하는 데만 쓰이므로 근사로 충분하다 --
 * 탐색은 이 계산을 수만 번 반복하기 때문에 켜두면 30배 느려진다.
 */
function advance(w, iAmLeft, mx, my, mh) {
  var og = guessOpponentInput(w, iAmLeft);
  if (iAmLeft) return stepFrame(w, mx, my, mh, og.x, og.y, og.hit, true);
  return stepFrame(w, og.x, og.y, og.hit, mx, my, mh, true);
}

function worldAtDecisionPoint(s, iAmLeft) {
  var w = cloneWorld(buildWorld(s, G.selfMirror, G.oppMirror));
  var og = guessOpponentInput(w, iAmLeft);
  // 여기 한 프레임은 정확하게 (착지 예측 포함) 굴린다. 탐색의 출발점이므로.
  if (iAmLeft) stepFrame(w, G.prevAction.x, G.prevAction.y, G.prevAction.hit, og.x, og.y, og.hit);
  else stepFrame(w, og.x, og.y, og.hit, G.prevAction.x, G.prevAction.y, G.prevAction.hit);
  return w;
}

/**
 * 탐색 지평선이 끝난 뒤, 고정 정책으로 랠리가 끝날 때까지 굴려 결과를 본다.
 * @return 점수 (클수록 좋다)
 */
var ROLLOUT_SCRATCH = null;
function rollout(src, iAmLeft, touches) {
  // 롤아웃도 원본을 건드리면 안 되므로 전용 버퍼에 복사해서 쓴다.
  if (ROLLOUT_SCRATCH === null) ROLLOUT_SCRATCH = cloneWorld(src);
  if (TUNE.DIAG) DIAG.rollouts++;
  var w = copyWorldInto(ROLLOUT_SCRATCH, src);
  var myTouches = touches;
  var wasColliding = false;
  for (var f = 0; f < TUNE.ROLLOUT_FRAMES; f++) {
    // ★ 우리도 상대와 똑같은 정책으로 계속 플레이한다고 본다.
    //   예전에는 여기서 "걷기만" 했다 -- 즉 탐색 지평선 너머의 우리 공격력이
    //   평가에서 통째로 빠져 있었다. 롤아웃의 95%가 지평선 전에 끝나므로
    //   이 정책이 사실상 평가함수 그 자체다.
    var myMove = policyFor(w, iAmLeft, true);
    var r = advance(w, iAmLeft, myMove.x, myMove.y, myMove.hit);

    var me = meOf(w, iAmLeft);
    var colliding = isCollision(w.ball, me.x, me.y);
    if (colliding && !wasColliding) {
      myTouches++;
      if (myTouches >= MAX_TOUCHES) return -1000 + f;   // 터치리밋 자멸
    }
    wasColliding = colliding;

    if (r.ground) {
      if (TUNE.DIAG) DIAG.resolved++;
      var landedOnMySide = iAmLeft
        ? r.landedX < GROUND_HALF_WIDTH
        : r.landedX > GROUND_HALF_WIDTH;
      // 빨리 끝날수록 좋다(이길 때) / 나쁘다(질 때) -- 같은 결과면 확실한 쪽을 택하게.
      return landedOnMySide ? -1000 + f : 1000 - f;
    }
  }
  // 지평선 안에 결말이 안 났다. 이때가 평가함수가 실력을 결정하는 지점이다.
  //
  // ★ 2수로 본다. 한 수만 보면 "상대가 이 공에 닿는가"까지밖에 못 보고,
  //   "닿긴 하는데 아주 편하게 받아서 곧바로 강타로 되돌려주는 공"을 좋은 수로
  //   착각한다. 그래서 공이 어느 쪽에 있느냐에 따라 부호를 뒤집어 평가한다:
  //     공이 우리 쪽  ->  + 우리가 낼 수 있는 최선의 위협
  //     공이 상대 쪽  ->  − 상대가 낼 수 있는 최선의 위협
  //   같은 함수(threatOf)를 공수만 바꿔 부른다.
  if (TUNE.DIAG) DIAG.horizon++;
  var oppSide = iAmLeft ? w.ball.x > GROUND_HALF_WIDTH : w.ball.x < GROUND_HALF_WIDTH;
  var base = oppSide ? TUNE.UNRESOLVED_OPP_SIDE : -TUNE.UNRESOLVED_OPP_SIDE;
  var meP = iAmLeft ? w.p1 : w.p2;
  var oppP = iAmLeft ? w.p2 : w.p1;
  var clamp = function (v) { return Math.max(-100, Math.min(100, v)); };
  if (TUNE.TWO_PLY !== 1) {
    // 옛 동작: 공이 상대 쪽이면 상수만 주고, 우리 쪽이면 지금 공 상태에서의
    // 최선 공격만 본다. 상대의 반격은 계산하지 않는다.
    if (oppSide) return base;
    var oldShot = bestShot(w.ball, oppP.x, iAmLeft);
    return base + TUNE.MARGIN_WEIGHT * clamp(oldShot.margin);
  }
  if (oppSide) {
    var threat = threatOf(w.ball, oppP.x, !iAmLeft, meP.x, true);
    return base - TUNE.MARGIN_WEIGHT * clamp(threat);
  }
  var mine = threatOf(w.ball, meP.x, iAmLeft, oppP.x, false);
  return base + TUNE.MARGIN_WEIGHT * clamp(mine);
}

/**
 * 이 상태에서 "실제로 결과가 달라지는" 행동만 추린다.
 * 18가지를 전부 보면 깊이 2가 한계지만, 대부분은 결과가 같은 중복이다.
 *   - hit은 점프 중(state 1)이거나 지상에서 이동 중(다이빙)일 때만 의미가 있다
 *   - y는 점프(지상 state<3)나 스매시 각도(hit=1)일 때만 의미가 있다
 * 중립(0)을 먼저 넣어 동점이 중립으로 깨지게 한다.
 */
function candidateActions(w, iAmLeft) {
  var me = meOf(w, iAmLeft);
  var st = me.state;
  var grounded = me.y === PLAYER_TOUCHING_GROUND_Y_COORD && st === 0;
  var airborne = st === 1 || st === 2;
  var out = [];
  var ORDER = [0, -1, 1];

  // 조작이 아예 안 먹는 상태 -- 한 가지만 보면 된다
  if (st === 3 || st === 4) return [{ x: 0, y: 0, hit: 0 }];

  // ★ 가지치기 -- 이 봇에서 가장 값싼 개선이다.
  //
  //   측정: 깊이별 비용이 1:10  2:63  3:346  4:1755  5:2590 노드이고, 예산
  //   6000 에서 깊이 5는 20% 만 도달한다. 그런데 깊이 4 대 5 의 차이가
  //   승률 16% 대 84% 였다. 즉 **분기를 줄여 한 깊이를 더 보는 것이 평가함수를
  //   손보는 것보다 훨씬 크다.**
  //
  //   버려도 손해가 없는 수만 버린다:
  //     - 공이 사거리 밖인데 파워히트를 시도하는 수 (아무 일도 안 일어난다)
  //     - 공이 내 쪽으로 오지도 않는데 점프하는 수
  //     - 공이 걸어서 닿는 거리인데 다이빙하는 수 (다이빙은 착지 후 5프레임 경직)
  //   판정은 싸야 한다. 매 노드에서 도는 코드다.
  var b = w.ball;
  var dx = Math.abs(b.x - me.x);
  var dy = Math.abs(b.y - me.y);
  // 규칙마다 따로 켠다 -- 어느 것이 손해인지 따로 재기 위해서.
  // 지금 낸 hit 은 T+1~T+3 에 적용된다. 그 창에 공이 사거리에 들어올 수 있는가.
  var hitPossible =
    TUNE.PRUNE_HIT !== 1 || (dx < TUNE.PRUNE_HIT_DX && dy < TUNE.PRUNE_HIT_DY);
  var myCourtMin = iAmLeft ? 0 : GROUND_HALF_WIDTH;
  var myCourtMax = iAmLeft ? GROUND_HALF_WIDTH : GROUND_WIDTH;
  var landing = b.expectedLandingPointX;
  var ballComing = landing > myCourtMin && landing < myCourtMax;
  var jumpWorth =
    TUNE.PRUNE_JUMP !== 1 || (ballComing && Math.abs(landing - me.x) < TUNE.PRUNE_JUMP_DX);
  var diveWorth =
    TUNE.PRUNE_DIVE !== 1 || (ballComing && Math.abs(landing - me.x) > TUNE.PRUNE_DIVE_DX);

  for (var a = 0; a < 3; a++) {
    var mx = ORDER[a];
    if (airborne) {
      // 공중: hit=1이면 y가 스매시 각도를 정한다. hit=0이면 y는 무의미.
      out.push({ x: mx, y: 0, hit: 0 });
      if (st === 1 && hitPossible) {
        for (var c = 0; c < 3; c++) out.push({ x: mx, y: ORDER[c], hit: 1 });
      }
    } else if (grounded) {
      out.push({ x: mx, y: 0, hit: 0 });
      if (jumpWorth) out.push({ x: mx, y: -1, hit: 0 });          // 점프
      if (mx !== 0 && diveWorth) out.push({ x: mx, y: 0, hit: 1 }); // 다이빙
    } else {
      out.push({ x: mx, y: 0, hit: 0 });
    }
  }
  return out;
}

// 탐색 예산 감시. 예산을 넘긴 깊이는 결과가 반쪽이라 통째로 버린다.
var SEARCH = { deadline: 0, nodes: 0, budget: 0, aborted: false };

// 진단 계수기. TUNE.DIAG 가 0이면 아무 일도 하지 않는다(실전 기본값).
// "예산이 어디에 쓰이는가"를 추측하지 않고 재기 위한 것.
var DIAG = {
  rollouts: 0, horizon: 0, resolved: 0, depthSum: 0, depthN: 0, maxDepth: 0,
  // 탐색이 무엇 때문에 끊겼는가. 노드 한도면 기계 속도와 무관하지만,
  // 시간 한도면 "평가가 비싼 쪽이 더 얕게 본다"는 뜻이라 공정하지 않다.
  abortByNodes: 0, abortByTime: 0, nodeSum: 0, nodeN: 0, nodeMax: 0,
  // 깊이별 비용과 분기 계수. 가지치기가 얼마나 이득인지는 이걸 봐야 안다.
  depthCost: [0, 0, 0, 0, 0, 0, 0, 0, 0],   // 각 깊이를 완성하는 데 쓴 노드 합
  depthDone: [0, 0, 0, 0, 0, 0, 0, 0, 0],   // 그 깊이를 완성한 횟수
  candSum: 0, candN: 0, candMax: 0,          // 후보 수(분기 계수)
};

// 깊이마다 재사용할 작업용 world. 탐색 중에는 할당을 전혀 하지 않는다.
var SCRATCH = [];
function scratchAt(depth, w) {
  if (SCRATCH[depth] === undefined) SCRATCH[depth] = cloneWorld(w);
  return copyWorldInto(SCRATCH[depth], w);
}

/**
 * 깊이 우선 탐색. 한 틱 = 3프레임이고, 이 틱의 행동은 그 3프레임 내내 유지된다.
 */
function search(w, iAmLeft, depth, touches, wasColliding, isRoot) {
  // 예산은 두 가지로 잰다.
  //   노드 수  : 주 제어. 기계 속도와 무관해서 같은 입력이면 항상 같은 답이 나온다
  //   경과 시간: 안전망. 대회 PC가 개발 머신보다 느려도 타임아웃하지 않게 한다
  //
  // ★ 시계를 너무 드물게 보면 안전망이 뚫린다. 256노드마다 보던 것을 실측에서
  //   최대 362ms(하드 타임아웃 360ms 초과)까지 넘겼다 -- 노드 하나가 비싸지면
  //   256개 사이에 250ms가 지나가 버린다. 브라우저였다면 그 응답은 폐기되고
  //   그 틱은 무입력이 되어 그대로 실점이다. TIME_CHECK_MASK 로 간격을 줄인다.
  if (++SEARCH.nodes > SEARCH.budget) {
    if (TUNE.DIAG && !SEARCH.aborted) DIAG.abortByNodes++;
    SEARCH.aborted = true;
  } else if ((SEARCH.nodes & TUNE.TIME_CHECK_MASK) === 0 && Date.now() > SEARCH.deadline) {
    if (TUNE.DIAG && !SEARCH.aborted) DIAG.abortByTime++;
    SEARCH.aborted = true;
  }
  if (SEARCH.aborted) return { score: 0, action: null };
  if (depth === 0) return { score: rollout(w, iAmLeft, touches), action: null };

  var best = null;
  // 뿌리에서는 모든 후보의 점수를 남긴다 -- 근사 최선끼리 섞기 위해서.
  var pool = isRoot ? [] : null;
  var acts = candidateActions(w, iAmLeft);
  if (TUNE.DIAG) {
    DIAG.candSum += acts.length; DIAG.candN++;
    if (acts.length > DIAG.candMax) DIAG.candMax = acts.length;
  }
  for (var i = 0; i < acts.length; i++) {
    var act = acts[i];
    var nw = scratchAt(depth, w);
    var t = touches;
    var wc = wasColliding;
    var ended = null;
    for (var f = 0; f < TICK_FRAMES; f++) {
      var r = advance(nw, iAmLeft, act.x, act.y, act.hit);
      var me = meOf(nw, iAmLeft);
      var col = isCollision(nw.ball, me.x, me.y);
      if (col && !wc) {
        t++;
        if (t >= MAX_TOUCHES) { ended = -1000; break; }
      }
      wc = col;
      if (r.ground) {
        var mine = iAmLeft ? r.landedX < GROUND_HALF_WIDTH : r.landedX > GROUND_HALF_WIDTH;
        ended = mine ? -1000 : 1000;
        break;
      }
    }
    var score = ended !== null ? ended : search(nw, iAmLeft, depth - 1, t, wc).score;
    if (pool !== null) pool.push({ score: score, action: act });
    // 엄격한 > 이므로 먼저 온 후보(= 더 중립적인 행동)가 동점에서 이긴다
    if (best === null || score > best.score) {
      best = { score: score, action: act };
    }
  }
  if (best !== null && pool !== null) best.pool = pool;
  return best;
}

/**
 * 근사 최선 집합에서 하나를 고른다.
 *
 * ★ 왜 섞는가: 상대 봇도 우리를 관측해 "이 상황이면 이 봇은 이렇게 친다"는 표를
 *   만들 수 있다(실측 예측 정확도 77%). 항상 같은 수를 두면 그 표에 그대로
 *   잡힌다. 점수가 거의 같은 수들 사이에서 무작위로 고르면, 실력 손실은
 *   EPSILON 이하로 묶이면서 상대의 예측표는 무력화된다.
 *
 * ★ 단, 확실한 결정타는 절대 섞지 않는다. 못 받는 공은 읽혀도 못 받는다.
 */
function pickFromPool(best, s, iAmLeft) {
  if (best === null || best.pool === undefined) return best !== null ? best.action : null;

  // ★ 동점을 "제자리로 가는 쪽"으로 깬다.
  //
  //   탐색은 "어차피 롤아웃이 나를 그 자리로 데려간다"고 보고 대부분의 상황에서
  //   모든 후보를 동점으로 평가한다. 그러면 동점이 첫 후보 {0,0,0}(가만히)으로
  //   깨지고, 봇은 공이 오는데도 38% 의 프레임을 서서 보낸다(실측). 남은
  //   점프·다이빙도 롤아웃이 우연히 미세한 우위를 준 헛동작이었다.
  //
  //   그래서 점수가 같으면 **3프레임 뒤 낙하지점에 더 가까워지는 수**를 고른다.
  //   평가가 구분하지 못하는 수들 사이의 선택이므로 실력 손해가 없고,
  //   "제자리에 서 있으라"는 정보를 공짜로 넣는 셈이다.
  if (TUNE.TIEBREAK_TOWARD_LANDING === 1 && s !== undefined) {
    var target = s.ball.expectedLandingPointX;
    var court = ownCourt(iAmLeft);
    // 낙하지점이 상대 코트면 수비 대기 위치를 목표로 삼는다
    if (target < court[0] || target > court[1]) {
      var stand = bestDefensiveStand(s, iAmLeft);
      target = standTarget(stand !== null ? stand.x : (court[0] + court[1]) / 2, iAmLeft);
    }
    // ★ 동점 처리의 후보는 **평범한 이동 수만** 본다(hit=0, 점프 아님).
    //   페널티로 억제하려 했더니 실패했다 -- 다이빙은 8px/프레임이라 3프레임에
    //   24px 를 가고, 걷기(18px)보다 6px 이득이라 웬만한 페널티를 이긴다.
    //   그래서 다이빙이 72.7% -> 85.7% 로 늘었다. 탐색이 구분하지 못하는
    //   상황이라면 특수 동작(다이빙·점프)을 쓸 이유 자체가 없다. 그건 탐색이
    //   확실한 이유를 찾았을 때만 나와야 한다.
    var pool = best.pool;
    var pick = null;
    var pickGap = Infinity;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].score < best.score - TUNE.MIX_EPSILON) continue;
      var act = pool[i].action;
      if (act.hit !== 0 || act.y === -1) continue;   // 평범한 이동만
      var future = s.self.x + act.x * 6 * TICK_FRAMES;
      var gap = Math.abs(target - future);
      if (gap < pickGap) { pickGap = gap; pick = act; }
    }
    // 동점 집합에 평범한 이동이 하나도 없으면(예: 공중) 원래 최선을 쓴다
    if (pick !== null) return pick;
  }

  // ★ 섞기를 끄면 candidateActions 가 넣어 둔 순서대로 동점이 깨진다. 그 순서는
  //   "중립(0) 먼저"라 의미가 있다 -- 평가가 구분 못 하는 상황에서는 가만히
  //   있는 쪽이 안전하다. 무작위로 깨면 봇이 좌우로 떨게 된다.
  if (TUNE.MIX_ENABLED !== 1) return best.action;
  if (best.score >= TUNE.DECISIVE_SCORE) return best.action;  // 이긴 수는 그냥 둔다
  var pool = best.pool;
  var tied = [];
  for (var i = 0; i < pool.length; i++) {
    if (pool[i].score >= best.score - TUNE.MIX_EPSILON) tied.push(pool[i].action);
  }
  if (tied.length <= 1) return best.action;
  return tied[Math.floor(Math.random() * tied.length)];
}

/**
 * 반복 심화 — 얕은 깊이부터 시작해 시간 예산이 남는 한 계속 깊이 판다.
 *
 * ★ 고정 깊이를 쓰지 않는 이유: 이 코드가 도는 PC가 얼마나 빠른지 알 수 없다.
 *   깊이 5는 이 개발 머신에서도 예산(120ms)을 넘겨 응답이 폐기됐다. 대회 PC가
 *   더 느리면 깊이 4도 위험하다. 시간으로 끊으면 어떤 기계에서도 안전하고,
 *   빠른 기계에서는 저절로 더 깊이 본다.
 *
 *   예산을 넘긴 깊이는 결과가 반쪽이라 통째로 버리고 직전 깊이의 답을 쓴다.
 */
function strategyDecide(s) {
  var iAmLeft = s.side === 'LEFT';
  var base = worldAtDecisionPoint(s, iAmLeft);
  var me = iAmLeft ? base.p1 : base.p2;
  var colliding = isCollision(base.ball, me.x, me.y);

  // 첫 몇 틱은 예산을 크게 줄인다. 자바스크립트 엔진이 이 코드를 처음 실행할 때
  // JIT 컴파일 비용이 한 번에 몰려, 측정상 첫 호출만 150ms 가까이 튄다.
  // 서브 직후라 얕게 봐도 손해가 없고, 대신 그 스파이크가 사라진다.
  var budget = G.ticks < TUNE.WARMUP_TICKS ? TUNE.WARMUP_NODE_BUDGET : TUNE.NODE_BUDGET;
  SEARCH.budget = budget;
  SEARCH.deadline = Date.now() + TUNE.TIME_BUDGET_MS;
  SEARCH.nodes = 0;
  SEARCH.aborted = false;

  var best = null;
  for (var d = 1; d <= TUNE.MAX_SEARCH_DEPTH; d++) {
    var nodesBefore = SEARCH.nodes;
    var r = search(base, iAmLeft, d, G.myTouches, colliding, true);
    if (SEARCH.aborted) break;      // 이 깊이는 미완성 -- 직전 결과를 쓴다
    if (TUNE.DIAG && d < 9) { DIAG.depthCost[d] += SEARCH.nodes - nodesBefore; DIAG.depthDone[d]++; }
    best = r;
    if (TUNE.DIAG) {
      DIAG.depthSum += d; DIAG.depthN++;
      if (d > DIAG.maxDepth) DIAG.maxDepth = d;
    }
  }
  if (TUNE.DIAG && G.ticks % TUNE.DIAG === 0) {
    console.log(
      '[diag] ticks=' + G.ticks +
      ' 평균깊이=' + (DIAG.depthN ? (DIAG.depthSum / DIAG.depthN).toFixed(2) : '-') +
      ' 최대깊이=' + DIAG.maxDepth +
      ' 롤아웃=' + DIAG.rollouts +
      ' 결말도달=' + DIAG.resolved +
      ' 지평선도달=' + DIAG.horizon +
      ' 중단(노드/시간)=' + DIAG.abortByNodes + '/' + DIAG.abortByTime +
      ' 실제노드(평균/최대)=' + (DIAG.nodeN ? (DIAG.nodeSum / DIAG.nodeN).toFixed(0) : '-') +
      '/' + DIAG.nodeMax +
      ' 분기(평균/최대)=' + (DIAG.candN ? (DIAG.candSum / DIAG.candN).toFixed(1) : '-') + '/' + DIAG.candMax +
      ' 깊이별비용=' + [1,2,3,4,5].map(function (d) {
        return d + ':' + (DIAG.depthDone[d] ? (DIAG.depthCost[d] / DIAG.depthDone[d]).toFixed(0) : '-') +
          '(x' + DIAG.depthDone[d] + ')';
      }).join(' ') +
      ' (지평선 비율 ' + (DIAG.rollouts ? (100 * DIAG.horizon / DIAG.rollouts).toFixed(1) : '0') + '%)'
    );
  }
  // 진단: 탐색이 각 후보를 어떻게 평가했는지 그대로 찍는다. 왜 이상한 수를
  // 골랐는지는 결과만 봐서는 알 수 없고, 후보별 점수를 봐야 안다.
  if (TUNE.DIAG_ROOT && G.ticks <= TUNE.DIAG_ROOT && best !== null && best.pool) {
    var line = '[root] tick=' + G.ticks + ' side=' + s.side +
      ' ball(' + s.ball.x + ',' + s.ball.y + ') v(' + s.ball.xVelocity + ',' + s.ball.yVelocity + ')' +
      ' elp=' + s.ball.expectedLandingPointX + ' me(' + s.self.x + ',' + s.self.y + ') st=' + s.self.state + '  ';
    var sorted = best.pool.slice().sort(function (u, v) { return v.score - u.score; });
    for (var q = 0; q < sorted.length; q++) {
      line += '(' + sorted[q].action.x + ',' + sorted[q].action.y + ',' + sorted[q].action.hit + ')=' +
        sorted[q].score.toFixed(0) + ' ';
    }
    console.log(line);
  }

  if (TUNE.DIAG) {
    DIAG.nodeSum += SEARCH.nodes; DIAG.nodeN++;
    if (SEARCH.nodes > DIAG.nodeMax) DIAG.nodeMax = SEARCH.nodes;
  }

  // ★ 공이 상대 코트에 있고 우리에게 오지 않는 동안에는 탐색이 어떤 수를 둬도
  //   결과가 같다고 본다(지평선 안에서 결과가 안 갈리고, 그 뒤는 롤아웃 정책이
  //   어차피 같은 자리로 걸어간다). 그래서 모든 후보가 동점이 되고 봇은
  //   **91.2% 의 프레임을 가만히 서서** 보냈다. 상대가 스매시를 준비하는 동안
  //   아무 대비도 안 한 것이고, 남은 다이빙의 3분의 2도 이 구간의 헛다이빙이었다.
  //
  //   탐색이 구분하지 못하는 구간이므로 명시적으로 수비 자리를 잡는다.
  if (TUNE.DEFENSIVE_POSITIONING === 1) {
    var oppSide = iAmLeft
      ? s.ball.x > GROUND_HALF_WIDTH
      : s.ball.x < GROUND_HALF_WIDTH;
    var landingOnThem = iAmLeft
      ? s.ball.expectedLandingPointX > GROUND_HALF_WIDTH
      : s.ball.expectedLandingPointX < GROUND_HALF_WIDTH;
    if (oppSide && landingOnThem && s.self.state === 0) {
      var stand = bestDefensiveStand(s, iAmLeft);
      if (stand !== null) {
        var ddx = standTarget(stand.x, iAmLeft) - s.self.x;
        return {
          x: Math.abs(ddx) > TUNE.MOVE_DEADBAND ? (ddx > 0 ? 1 : -1) : 0,
          y: 0,
          hit: 0,
        };
      }
    }
  }

  var chosen = pickFromPool(best, s, iAmLeft);
  return chosen !== null && chosen !== undefined ? chosen : { x: 0, y: 0, hit: 0 };
}
