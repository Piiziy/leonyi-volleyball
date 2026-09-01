/**
 * 봇 소스 조각들을 붙여서 제출 가능한 파일 하나로 만든다.
 *
 *   node build.js A          -> src/code-here/LabA_v1.js
 *   node build.js A B C
 *
 * 대회에는 파일 하나만 낼 수 있고 import도 못 쓴다. 개발 중에는 물리 미러를
 * 세 전략이 공유해야 공정한 비교가 되므로, 조각으로 관리하고 여기서 합친다.
 * 합쳐진 결과물은 평범한 JS 한 파일이라 당일 그대로 손으로 고칠 수 있다.
 */
'use strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SRC = resolve(HERE, 'botsrc');

const HEADER = (name) => `'use strict';
// ============================================================================
//  리온이 배구 봇${name ? ' — ' + name : ''}
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
`;

const FOOTER = `
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
`;

const args = process.argv.slice(2);
// node build.js A B C            -> src/code-here/LabA_v1.js ...
// node build.js B --as Team_v1   -> src/code-here/Team_v1.js  (제출용 이름)
const asIndex = args.indexOf('--as');
const outName = asIndex >= 0 ? args[asIndex + 1] : null;
const names = asIndex >= 0 ? args.slice(0, asIndex) : args;
if (names.length === 0) {
  console.error('usage: node build.js A [B C ...] [--as <TeamName>_v<n>]');
  process.exit(1);
}
if (outName !== null && names.length !== 1) {
  console.error('--as 는 전략 하나에만 쓸 수 있습니다');
  process.exit(1);
}

names.forEach((name) => {
  const parts = [
    HEADER(outName !== null ? outName : `Lab${name}`),
    readFileSync(resolve(SRC, 'tune.js'), 'utf8'),
    readFileSync(resolve(SRC, 'core.js'), 'utf8'),
    readFileSync(resolve(SRC, 'common.js'), 'utf8'),
    readFileSync(resolve(SRC, 'safety.js'), 'utf8'),
    readFileSync(resolve(SRC, `strategy${name}.js`), 'utf8'),
    FOOTER,
  ];
  const out = resolve(REPO, 'src/code-here', outName !== null ? `${outName}.js` : `Lab${name}_v1.js`);
  writeFileSync(out, parts.join('\n'));
  console.log(`built ${out.replace(REPO + '/', '')}  (${parts.join('\n').split('\n').length} lines)`);
});
