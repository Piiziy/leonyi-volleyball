/**
 * 서브 정책 실험 — "서브를 한 방에 넘기는 것이 최선인가".
 *
 *   node serveTest.js [봇] [경기수]
 *
 * ★ 왜
 *   자기 대전에서 **서브한 쪽이 랠리를 거의 다 진다**(왼쪽 0.0%, 오른쪽 25.9%).
 *   추적해 보니 서브는 "높이 136에서 수평으로 날아가는 느린 공"이고, 받는 쪽은
 *   20프레임 동안 점프를 준비해 내려꽂는다. 랠리의 절반이 우리 서브로 시작하니
 *   여기가 가장 큰 지렛대다.
 *
 *   충돌 규칙을 보면 **파워히트가 아닌 접촉은 공을 반드시 위로 띄운다**
 *   (yVelocity = -최소15). 그리고 룰상 한 진영이 4번까지 만질 수 있다.
 *   즉 서브를 한 방에 넘길 이유가 없다 -- 띄워 올린 뒤 네트 앞으로 가서
 *   내려꽂을 수 있다. 그런데 탐색 지평선은 15프레임이고 세트-스파이크는
 *   40프레임이 걸려서 **탐색이 이 수를 볼 수가 없다.**
 *
 *   그래서 서브 구간만 손으로 강제해 보고 랠리 승률을 비교한다.
 *   봇은 건드리지 않는다 -- 좋다는 것이 확인되면 그때 넣는다.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from './match.js';
import { compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const NET = 216;

const args = process.argv.slice(2).reduce((a, t, i, all) => {
  if (!t.startsWith('--')) return a;
  const n = all[i + 1];
  return { ...a, [t.slice(2)]: n && !n.startsWith('--') ? n : true };
}, {});
const botFile = args.bot || 'Leonyi_v16.js';
const matches = Number(args.matches || 10);
// ★ 시간 예산은 항상 끈다(결정론). --tune 으로 NODE_BUDGET 을 낮추면 스크리닝이
//   빨라지는데, 서브 구간은 정책이 입력을 직접 내므로 탐색 깊이의 영향이 작다.
//   단 랠리 뒷부분은 탐색이 하므로 **큰 효과만 신뢰할 것.**
const extra = args.tune ? ',' + String(args.tune).replace(/^\{|\}$/g, '') : '';
const src = readFileSync(resolve(REPO, 'src/code-here', botFile), 'utf8') +
  '\n;Object.assign(TUNE,{TIME_BUDGET_MS:100000' + extra + '});';

/**
 * 서브 구간 동안만 정해진 입력을 내고, 첫 접촉 뒤에는 봇에게 돌려준다.
 * 서브 구간 판정: 공의 x속도가 0(수직 낙하)이고 아직 아무도 안 건드렸다.
 */
const wrap = (policy) => {
  const inner = compileBot(src, botFile);
  let touched = false;
  let prevServing = false;
  return (s) => {
    const serving = s.ball.xVelocity === 0 && s.ball.yVelocity >= 0;
    // ★ 새 서브 구간이 열리는 전이로 리셋한다.
    //   예전에는 `s.rallyFrameCount < 3` 이었는데 두 겹으로 틀렸다:
    //     (1) 그 필드는 s.meta.rallyFrameCount 다 -> s.rallyFrameCount 는
    //         undefined 이고 `undefined < 3` 은 false,
    //     (2) 경로를 고쳐도 안 된다 -- 서브 구간이 열리는 시점의 실측값이
    //         3, 12, 14, 14, ... 이라 `< 3` 이 한 번도 참이 되지 않는다.
    //   그래서 touched 가 매치 첫 접촉에서 true 가 된 뒤 영영 리셋되지 않았고,
    //   정책은 **매치당 첫 서브 하나에만** 걸렸다(실측: 서브 29개 중 2개).
    //   즉 다섯 정책의 "전부 구분 불가"는 같은 봇을 다섯 번 잰 결과였다.
    //   서브 공은 항상 화면 꼭대기에서 시작하므로 y 로 랠리 중 오탐을 막는다.
    if (serving && !prevServing && s.ball.y < 40) touched = false;
    prevServing = serving;
    if (!serving) touched = true;
    if (serving && !touched && policy !== null) {
      const iAmLeft = s.side === 'LEFT';
      const a = policy(s, iAmLeft);
      if (a !== null) return a;
    }
    return inner(s);
  };
};

/** 정책들 */
const POLICIES = {
  '기본(탐색이 결정)': null,

  '안 때리고 띄우기(네트 쪽으로 걸으며)': (s, iAmLeft) => ({
    x: iAmLeft ? 1 : -1, y: 0, hit: 0,
  }),

  '안 때리고 띄우기(제자리)': () => ({ x: 0, y: 0, hit: 0 }),

  '점프해서 위로 올려치기(y=-1)': (s, iAmLeft) => {
    // 공이 내려와 사거리에 들어오면 점프+파워히트, 그 전에는 자리 잡기
    const dx = s.ball.x - s.self.x;
    if (Math.abs(dx) > 6) return { x: dx > 0 ? 1 : -1, y: 0, hit: 0 };
    if (s.self.state === 0 && s.ball.y > 60) return { x: 0, y: -1, hit: 0 };
    if (s.self.state === 1 && Math.abs(s.ball.y - s.self.y) < 40) return { x: 1, y: -1, hit: 1 };
    return { x: 0, y: 0, hit: 0 };
  },

  '늦게 때리기(공이 낮아질 때까지)': (s, iAmLeft) => {
    const dx = s.ball.x - s.self.x;
    if (Math.abs(dx) > 6) return { x: dx > 0 ? 1 : -1, y: 0, hit: 0 };
    if (s.ball.y < 170) return { x: 0, y: 0, hit: 0 };     // 아직 높다 -- 기다린다
    if (s.self.state === 0) return { x: 0, y: -1, hit: 0 };
    return { x: 1, y: 0, hit: 1 };
  },
};

console.log(`\n  서브 정책 실험 — ${botFile} 자기 대전 ${matches} 세트 x 2(좌우)\n`);
console.log('  정책                                    서브측 랠리 승률   세트 승률');
console.log('  ' + '-'.repeat(70));

for (const name of Object.keys(POLICIES)) {
  const policy = POLICIES[name];
  let servedRallies = 0, servedWon = 0, setsWon = 0, setsTotal = 0;
  for (let m = 0; m < matches; m++) {
    for (const testLeft of [true, false]) {
      // 시험 대상만 서브 정책을 쓴다. 상대는 기본 봇.
      const A = { kind: 'bot', decide: wrap(policy) };
      const Bt = { kind: 'bot', decide: wrap(null) };
      let prevTotal = 0, server = null, wasRound = false;
      const r = runMatch({
        left: testLeft ? A : Bt, right: testLeft ? Bt : A,
        seed: 8000 + m, touchLimit: true,
        onFrame: (pv, meta) => {
          if (!meta.simulated) return;
          if (!meta.isRoundFrame) { wasRound = false; return; }
          if (!wasRound) { wasRound = true; server = pv.isPlayer2Serve ? 1 : 0; }
          const total = pv.scores[0] + pv.scores[1];
          if (total === prevTotal) return;
          prevTotal = total;
          const b = pv.physics.ball;
          const winner = b.punchEffectX < NET ? 1 : 0;
          const meIdx = testLeft ? 0 : 1;
          if (server === meIdx) { servedRallies++; if (winner === meIdx) servedWon++; }
        },
      });
      setsTotal++;
      const meIdx = testLeft ? 0 : 1;
      if (r.scores[meIdx] > r.scores[1 - meIdx]) setsWon++;
    }
  }
  const p = servedRallies ? servedWon / servedRallies : 0;
  const ci = servedRallies ? 100 * 1.96 * Math.sqrt((p * (1 - p)) / servedRallies) : 100;
  console.log(
    `  ${name.padEnd(38)} ${(100 * p).toFixed(1).padStart(6)}% ±${ci.toFixed(1).padStart(4)} (${servedRallies})` +
    `   ${((100 * setsWon) / setsTotal).toFixed(1).padStart(6)}%`
  );
}
console.log('');
