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
    var myMove = policyFor(w, iAmLeft);
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

  for (var a = 0; a < 3; a++) {
    var mx = ORDER[a];
    if (airborne) {
      // 공중: hit=1이면 y가 스매시 각도를 정한다. hit=0이면 y는 무의미.
      out.push({ x: mx, y: 0, hit: 0 });
      if (st === 1) {
        for (var b = 0; b < 3; b++) out.push({ x: mx, y: ORDER[b], hit: 1 });
      }
    } else if (grounded) {
      out.push({ x: mx, y: 0, hit: 0 });
      out.push({ x: mx, y: -1, hit: 0 });               // 점프
      if (mx !== 0) out.push({ x: mx, y: 0, hit: 1 });  // 다이빙 (x=0이면 무효)
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
var DIAG = { rollouts: 0, horizon: 0, resolved: 0, depthSum: 0, depthN: 0, maxDepth: 0 };

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
  // 시계는 자주 보면 그것대로 비싸므로 256노드마다만 확인한다.
  if (++SEARCH.nodes > SEARCH.budget) SEARCH.aborted = true;
  else if ((SEARCH.nodes & 255) === 0 && Date.now() > SEARCH.deadline) {
    SEARCH.aborted = true;
  }
  if (SEARCH.aborted) return { score: 0, action: null };
  if (depth === 0) return { score: rollout(w, iAmLeft, touches), action: null };

  var best = null;
  // 뿌리에서는 모든 후보의 점수를 남긴다 -- 근사 최선끼리 섞기 위해서.
  var pool = isRoot ? [] : null;
  var acts = candidateActions(w, iAmLeft);
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
function pickFromPool(best) {
  if (best === null || best.pool === undefined) return best !== null ? best.action : null;
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
    var r = search(base, iAmLeft, d, G.myTouches, colliding, true);
    if (SEARCH.aborted) break;      // 이 깊이는 미완성 -- 직전 결과를 쓴다
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
      ' (지평선 비율 ' + (DIAG.rollouts ? (100 * DIAG.horizon / DIAG.rollouts).toFixed(1) : '0') + '%)'
    );
  }
  var chosen = pickFromPool(best);
  return chosen !== null && chosen !== undefined ? chosen : { x: 0, y: 0, hit: 0 };
}
