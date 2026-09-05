/**
 * 예산 대 비용/강함 — NODE_BUDGET 을 바꿔 가며 **decide() 실행 시간**과
 * 기준 봇 상대 승률을 함께 잰다.
 *
 *   node budget.js --bot Leonyi_v16.js --ref Leonyi_v14.js \
 *                  --values 600,1000,1500,3000 --matches 3
 *
 * ★ 왜 따로 필요한가
 *   run.js 의 --tune 은 **양쪽에** 적용돼서 한쪽만 바꾸는 스윕을 못 한다.
 *   그리고 ab.js 는 승률만 재고 시간을 안 잰다. 그런데 이 대회에는
 *   hard timeout 360ms 가 있어서, 강해도 느리면 그 강함이 무의미하다.
 *   SIM_LANDING_REFRESH=1 로 v16 의 max decide 가 36.6ms -> 80.1ms 로 뛰었다.
 *
 * ★ 시간 예산(TIME_BUDGET_MS)은 끄고 잰다. 켜 두면 봇이 스스로 45ms 에서
 *   탐색을 끊어 버려서 "이 예산이 실제로 얼마나 비싼가"를 못 본다.
 *   즉 여기서 나오는 max 는 **안전장치가 없을 때의 최악**이다.
 */
'use strict';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from './match.js';
import { compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const args = process.argv.slice(2).reduce((a, t, i, all) => {
  if (!t.startsWith('--')) return a;
  const n = all[i + 1];
  return { ...a, [t.slice(2)]: n && !n.startsWith('--') ? n : true };
}, {});

const botFile = args.bot || 'Leonyi_v16.js';
const refFile = args.ref || 'Leonyi_v14.js';
const values = String(args.values || '600,1000,1500,3000').split(',').map(Number);
const matches = Number(args.matches || 3);
const out = args.out || 'budget-results.txt';

const raw = (f) => readFileSync(resolve(REPO, 'src/code-here', f), 'utf8');
const say = (l) => { console.log(l); appendFileSync(out, l + '\n'); };
writeFileSync(out, '');

say(`\n  ${botFile} 의 NODE_BUDGET 대 비용/강함  (기준 ${refFile})`);
say(`  각 ${matches * 2} 세트 · 좌우 스왑 · 시간 예산 해제`);
say(`  시작 ${new Date().toLocaleTimeString()}\n`);
say('   예산   decide 평균   decide 최대    승률        경과');
say('  ' + '-'.repeat(60));

for (const v of values) {
  const t0 = Date.now();
  const botSrc = raw(botFile) + `\n;Object.assign(TUNE,{TIME_BUDGET_MS:100000,NODE_BUDGET:${v}});`;
  const refSrc = raw(refFile) + '\n;Object.assign(TUNE,{TIME_BUDGET_MS:100000});';
  let sum = 0, n = 0, max = 0, wins = 0, sets = 0;
  for (let m = 0; m < matches; m++) {
    for (const swap of [false, true]) {
      const timed = (inner) => (s) => {
        const a = Date.now();
        const r = inner(s);
        const dt = Date.now() - a;
        sum += dt; n++; if (dt > max) max = dt;
        return r;
      };
      const A = { kind: 'bot', decide: timed(compileBot(botSrc, 'a.js')) };
      const B = { kind: 'bot', decide: compileBot(refSrc, 'b.js') };
      const r = runMatch({
        left: swap ? B : A, right: swap ? A : B,
        seed: 9100 + m, touchLimit: true,
      });
      const me = swap ? 1 : 0;
      if (r.scores[me] > r.scores[1 - me]) wins++;
      sets++;
    }
  }
  say(`  ${String(v).padStart(5)}   ${(sum / n).toFixed(1).padStart(8)}ms  ${String(max).padStart(8)}ms   ` +
      `${((100 * wins) / sets).toFixed(1).padStart(5)}% (${wins}/${sets})  ${((Date.now() - t0) / 60000).toFixed(1)}분`);
}
say(`\n  결과 파일 ${out}\n`);
