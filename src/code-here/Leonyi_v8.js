'use strict';
// ============================================================================
//  리온이 배구 봇 — Leonyi_v8
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
//  ★ 봇이 갑자기 눈에 띄게 약해졌다     F12 콘솔을 볼 것. "물리 예측이 실제와
//    (공을 잘 받는데 공격을 안 한다)     어긋난다"가 찍혀 있으면 [4c] 안전장치가
//                                       발동해 탐색을 끄고 단순 모드로 내려간
//                                       것이다. 물리가 바뀌었다는 뜻이므로
//                                       [3] 물리 미러를 새 규칙에 맞게 고치면
//                                       자동으로 탐색 모드로 복귀한다.
//                                       콘솔에 무엇이 얼마나 어긋났는지(공의
//                                       위치·속도 차이) 함께 찍히니 그게 단서다.
//  봇이 아무것도 안 한다                 F12 콘솔에 "decide 예외"가 찍혔는지 확인.
//                                       예외는 한 번만 출력된다.
//
//  ----------------------------------------------------------------------------
//  파일 구조
//    [1] 튜닝 상수   숫자만 바꿔 성격을 조절 (제일 먼저 볼 곳)
//    [2] 게임 상수   룰 자체가 바뀌었을 때
//    [3] 물리 미러   엔진 복사본. 새 스킬은 여기
//    [4] 상태 추정   스냅샷에 없는 값(플레이어 y속도 등) 복원
//    [4b] 상대 관측  상대가 다이빙·파워히트를 쓰는지 매 틱 관측
//    [4c] 물리 감시  예측이 실제와 어긋나면 단순 모드로 (당일 스킬 대비)
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
  DEFENSIVE_POSITIONING: 1,  // 공이 상대 코트에 있는 동안 미니맥스 수비 위치로
                             // 이동한다. 0이면 탐색에 맡기는데, 그러면 동점이라
                             // 91.2% 의 프레임을 가만히 서 있는다(실측)
  DEFENSE_STEP: 8,           // 수비 위치 후보 간격
  DEFENSE_LOOKAHEAD: 90,     // 상대가 공을 칠 시점을 몇 프레임까지 찾을지

  // --- 전략 B(전탐색) 전용 ------------------------------------------------
  // 탐색은 고정 깊이가 아니라 예산으로 끊는다(반복 심화). 얕은 깊이부터 풀고
  // 예산이 남는 동안 계속 깊이 판다.
  NODE_BUDGET: 6000,        // ★ 주 제어. 한 번의 decide()가 펼칠 최대 탐색 노드 수.
                             // 기계 속도와 무관해서 결과가 항상 재현된다.
                             // 올리면 강해지고 느려진다. 개발 머신 기준 깊이 4 수준
  TIME_CHECK_MASK: 31,       // 이 값+1 노드마다 시계를 본다(31 = 32노드마다).
                             // 크게 잡으면 시계 비용은 줄지만 안전망이 뚫린다.
                             // 256마다 보던 시절 최대 362ms 가 나왔다(한도 360ms)
  TIME_BUDGET_MS: 45,        // 안전망. 대회 PC가 느려도 타임아웃하지 않게 한다.
                             // 목표 주기 120ms, 하드 타임아웃 360ms의 절반 이하
  WARMUP_TICKS: 6,           // 첫 이만큼의 틱은 예산을 줄인다(JIT 컴파일 스파이크 회피)
  WARMUP_NODE_BUDGET: 300,   // 그동안 쓸 작은 예산
  MAX_SEARCH_DEPTH: 8,       // 예산이 남아돌 때의 상한. 실제로는 대개 3~4에서 끊긴다
  // --- 가지치기 (분기를 줄여 한 깊이 더 본다) ------------------------------
  // 측정: 깊이별 비용 1:10 2:63 3:346 4:1755 5:2590 노드. 예산 6000 에서
  // 깊이 5 는 20% 만 도달하는데, 깊이 4 대 5 의 차이가 승률 16% 대 84% 였다.
  // 분기를 줄여 한 깊이 더 보는 것이 평가함수를 손보는 것보다 훨씬 크다.
  PRUNE_HIT: 1,              // 공이 사거리 밖이면 파워히트 후보를 안 만든다.
                             // 분기 5.1->4.2, 깊이5 도달률 30%->79%, 승률은 그대로.
                             // 같은 실력을 30% 적은 노드로 내므로 느린 PC 보험이다
  PRUNE_JUMP: 0,             // ★ 켜지 말 것. 100세트에서 37% (기준선 대비 확정 열세).
                             // 낡은 expectedLandingPointX 로 판단해 필요한 점프까지 지운다
  PRUNE_DIVE: 0,             // ★ 켜지 말 것. 100세트에서 15% -- 가장 해롭다.
                             // "걸어서 닿으면 다이빙은 손해"라는 직관이 틀렸다.
                             // 다이빙은 이 봇의 핵심 수단이다
  PRUNE_HIT_DX: 70,          // 공이 이보다 멀면 파워히트 후보를 안 만든다
  PRUNE_HIT_DY: 90,          // 같은 것의 세로 거리. 넉넉히 잡아야 놓치지 않는다
  PRUNE_JUMP_DX: 70,         // 낙하지점이 이보다 멀면 점프 후보를 안 만든다
  PRUNE_DIVE_DX: 30,         // 낙하지점이 이보다 가까우면 다이빙 후보를 안 만든다
                             // (걸어서 닿는데 다이빙하면 착지 후 경직만 손해)

  ROLLOUT_FRAMES: 90,        // 탐색이 끝난 뒤 랠리 결말을 볼 프레임 수
  UNRESOLVED_OPP_SIDE: 50,   // 지평선 안에 안 끝났을 때, 공이 상대 쪽이면 주는 점수
  // --- 2수 평가 (threatOf) -------------------------------------------------
  TWO_PLY: 1,                // 1이면 지평선에서 상대의 반격까지 계산한다.
                             // 0이면 옛 동작(우리 공격만 보고 상대 쪽이면 상수)
  THREAT_SCAN_FRAMES: 70,    // 공을 몇 프레임까지 굴려 첫 접촉 지점을 찾을지
  SMASH_MIN_BALL_Y: 70,      // 공이 이보다 높으면(y가 작으면) 점프해도 못 닿는다
  SMASH_MAX_BALL_Y: 150,     // 공이 이보다 낮게 잡히면 스매시가 아니라 몸으로 퍼올린다
  BUMP_THREAT_SCALE: 0.3,    // 퍼올린 공의 위협을 스매시 대비 몇 배로 볼지.
                             // 올리면 낮은 공도 무서워해 수비적이 된다
  OPP_WALK_SPEED: 6,         // 상대가 걸어서 이동하는 속도(다이빙은 8)
  // 시뮬레이션 속 선수들이 공격까지 하는가. 0이면 걷기만 한다(옛 동작).
  // 롤아웃의 95%가 지평선 전에 끝나므로, 이 정책이 사실상 평가함수다.
  SIM_WALK_LEGACY: 0,        // 1이면 시뮬 속 상대가 옛 방식으로 걷는다
                             // (낙하지점 정확히, 임계값 8 -- 비켜서지 않음)
  SIM_DIVE: 0,               // 미측정. 켜기 전에 반드시 재볼 것.
                             // 시뮬 속 선수가 걸어서 못 닿는 공에 다이빙하는가.
                             // 없으면 롤아웃이 양쪽 수비 범위를 과소평가한다
  SIM_DIVE_MIN_DX: 40,       // 낙하지점이 이보다 멀면 다이빙 (걷기로는 부족)
  SIM_DIVE_BALL_Y: 170,      // 공이 이보다 낮게 내려왔을 때만 다이빙
  SIM_LANDING_REFRESH: 0,    // 미측정. 켜기 전에 반드시 재볼 것.
                             // 탐색·롤아웃 안에서 공이 타격/반사로 방향이
                             // 바뀌면 낙하지점을 다시 계산한다. 0이면 시뮬 속
                             // 선수들이 낡은 지점을 향해 계속 뛴다
  SIM_ATTACK_OPP: 1,         // 시뮬 속 상대가 점프해서 스매시하는가
  SIM_ATTACK_SELF: 1,        // 시뮬 속 내가 점프해서 스매시하는가
  SIM_SMASH_BY_DISTANCE: 1,  // ★ 반드시 1. 0으로 두면 시뮬 속 선수가 네트에서
                             // 64px만 멀어도 자기 코트에 공을 꽂는다(측정). 상대
                             // 코트의 70%가 자멸 구간이 되어, 우리 봇이 "상대가
                             // 알아서 자책골을 넣겠지"라고 계산하고 받기 좋은
                             // 공을 상대에게 준다. 실전 관찰로 잡은 버그다.
                             // (자기 대전으로는 양쪽이 똑같이 착각해서 안 보인다)
  SMASH_NEAR_NET: 45,        // 네트에서 이 안이면 급강하(y=1)가 넘어간다.
                             // 측정: 거리 40 까지는 넘어가고 60 부터 자책골이다
  SMASH_MID_NET: 140,        // 여기까지는 수평(y=0), 그보다 멀면 아치(y=-1).
                             // 측정: y=0 은 거리 130 까지 넘어가고 160 부터 자책
  SMASH_PROBE_FRAMES: 40,    // 스매시 각도를 고를 때 공을 몇 프레임까지 굴려
                             // 네트를 넘는지 확인할지. 정책이 때리는 프레임에만
                             // 도므로 비용이 작다
  OPP_HIT_REACH: 40,         // 시뮬레이션 속 상대가 파워히트를 시도하는 거리
  OPP_JUMP_BALL_Y: 170,      // 상대가 이보다 높은 공에는 점프해서 맞이한다고 본다
  OPP_JUMP_ALIGN_X: 50,      // 상대가 점프할 만큼 공과 가로로 가까운 거리         // 상대가 걸어서 이동하는 속도(다이빙은 8)

  // --- 상대 스펙 관측 ([4b]) — 증거가 쌓이기 전엔 보수적으로 -------------
  SPEC_ADAPT: 1,             // 0이면 상대 스펙 관측을 무시하고 항상 최악을 가정
  SPEC_MIN_TICKS: 120,       // 이만큼 관측해야 상대 능력치 판단을 시작한다
                             // (틱=120ms이므로 약 14초, 랠리 2~3개)
  SPEC_MIN_STRESS: 8,        // 상대가 실제로 쫓아가야 했던 상황을 이만큼 본 뒤에만
                             // "이 상대는 다이빙을 안 한다"고 결론 내린다         // 상대가 걸어서 이동하는 속도(다이빙은 8)
  // --- 수 섞기 (상대의 예측표 무력화) --------------------------------------
  MIX_ENABLED: 0,            // ★ 켜지 말 것. 동점을 무작위로 깨면 승률이 50% -> 15% 로
                             // 무너진다(측정). candidateActions 는 중립(0)을 먼저
                             // 넣어 두는데, 평가가 구분 못 하는 상황에서 "가만히
                             // 있기"를 고르는 그 순서 자체가 정보다. 무작위로 깨면
                             // 봇이 결정을 못 하고 좌우로 떤다.
                             // 상대가 우리 패턴을 읽는 게 걱정된다면, 섞는 대신
                             // 평가함수를 더 정밀하게 만들어 동점 자체를 줄여야 한다
  MIX_EPSILON: 0,            // 최선 대비 이 점수 안이면 같은 수로 보고 무작위 선택.
                             // 0 = 완전 동점만 섞음 -> 우리 평가상 똑같은 수들이라
                             //     실력 손해가 0인데도 상대의 예측표는 무력화된다.
                             // 올리면 예측은 더 어려워지지만 그만큼 실력을 깎는다.
                             // ★ 상대가 우리를 분석하지 않는 대회라면 0이 정답이다
  DECISIVE_SCORE: 900,       // 이 점수 이상이면 확실한 결정타 -- 절대 섞지 않는다
  DIAG_ROOT: 0,              // N이면 첫 N틱의 루트 후보 점수를 전부 찍는다
  DIAG: 0,                   // 0이면 진단 끔(실전). N이면 N틱마다 탐색 통계를 찍는다.
                             // "예산이 어디 쓰이는가"를 추측 대신 재기 위한 스위치
  MARGIN_WEIGHT: 1.0,        // 결말이 안 났을 때 '여유'를 얼마나 반영할지.
                             // 0이면 순수 탐색, 올리면 공격 자세를 더 중시한다   // 지평선 안에 안 끝났을 때, 공이 상대 쪽이면 주는 점수

  // --- 물리 발산 감시 ([4c]) — 당일 스킬 대비 ------------------------------
  WATCH_CLEARANCE: 110,      // 예측 구간의 양 끝(관측값)에서 공이 두 플레이어
                             // 모두에게서 이보다 멀어야 채점한다. 접촉이 일어나면
                             // 예측이 어긋나는 게 정상이라 오탐이 되기 때문이다.
                             // 히트박스 32 + 공 3프레임 이동 60 + 상대 이동 24 = 116
                             // 근처가 안전선. 낮추면 오탐, 높이면 표본이 준다
  WATCH_MIN_RALLY_FRAME: 50, // 랠리 시작 후 이 프레임까지는 채점하지 않는다
                             // (전환 경계에서 물리가 2프레임만 도는 틱이 있다)
  WATCH_MIN_SAMPLES: 20,     // 이만큼 채점한 뒤부터 판단한다
  WATCH_MISS_THRESHOLD: 6,   // [급성] 최근 16틱 중 이만큼 틀리면 전환.
                             // 낮추면 예민해지고(오탐 위험) 올리면 늦게 반응한다
  WATCH_CHRONIC_SAMPLES: 60, // [만성] 이만큼 채점한 뒤부터 누적 비율을 본다
                             // (한 경기에 약 50회 채점된다)
  WATCH_CHRONIC_RATE: 0.10,  // [만성] 누적 불일치율이 이보다 높으면 전환.
                             // 정상 물리에서는 실측 0% 라 여유가 크다
  SAFE_RECEIVE_OFFSET: 12,   // 단순 모드에서 낙하지점에서 비켜설 거리
  SAFE_JUMP_BALL_Y: 150,     // 단순 모드에서 이보다 높은 공에만 점프한다

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
  if (!skipLandingPrediction || (TUNE.SIM_LANDING_REFRESH === 1 && velocityChanged)) {
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
function pickFromPool(best) {
  if (best === null || best.pool === undefined) return best !== null ? best.action : null;
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
        var ddx = stand.x - s.self.x;
        return {
          x: Math.abs(ddx) > TUNE.MOVE_DEADBAND ? (ddx > 0 ? 1 : -1) : 0,
          y: 0,
          hit: 0,
        };
      }
    }
  }

  var chosen = pickFromPool(best);
  return chosen !== null && chosen !== undefined ? chosen : { x: 0, y: 0, hit: 0 };
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
    // 직전 틱의 예측이 맞았는지 채점한다. 계속 틀리면 물리가 바뀐 것으로 보고
    // watch.degraded 가 켜지고, 물리 미러를 쓰지 않는 단순 모드로 내려간다([4c]).
    checkPrediction(s);
    var action = G.watch.degraded ? safeModeDecide(s) : strategyDecide(s);
    // hit은 한 틱만 세우고 바로 내린다. 지상에서 계속 들고 있으면 다이빙이
    // 반복 발동해 락에 걸린다(착지 5프레임 경직 -> 복귀 -> 즉시 재다이빙).
    if (action.hit === 1 && G.prevAction.hit === 1 && s.self.state !== 1) {
      action = { x: action.x, y: action.y, hit: 0 };
    }
    // 이번 행동으로 다음 틱이 어떻게 될지 적어 둔다(다음 틱에 채점된다).
    // 단순 모드에서도 계속 채점해야 물리 미러를 고쳤을 때 복귀할 수 있다.
    recordPrediction(s, s.side === 'LEFT', action);
    G.prevAction = action;
    return action;
  } catch (e) {
    // 예외는 삼키되 딱 한 번은 알린다. 안 그러면 봇이 "가만히 서 있는" 것과
    // "매 틱 터지는" 것이 구분이 안 된다 -- 개발자 도구 콘솔(F12)에서 확인.
    if (!G.errorReported) {
      G.errorReported = true;
      console.warn('[bot] decide 예외:', (e && e.stack) || e);
    }
    G.prevAction = { x: 0, y: 0, hit: 0 };
    return { x: 0, y: 0, hit: 0 };
  }
}
