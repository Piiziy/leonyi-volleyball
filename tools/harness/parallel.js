/**
 * 여러 코어에 매치를 나눠 돌린다.
 *
 * ★ 왜 필요한가: 표본이 부족하면 노이즈를 개선으로 읽는다. 30세트의 95%
 *   신뢰구간은 ±18%p 라 웬만한 비교가 전부 "결론 불가"로 끝난다. 이 세션에서
 *   그 실수를 세 번 반복했다. 코어 수만큼 빨라지면 200세트가 감당 가능해지고,
 *   그러면 ±7%p 로 실제 판단이 가능하다.
 */
'use strict';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @param {Object} spec {aFile,bFile,aTune,bTune,matches,seedBase}
 * @param {number} [workers] 기본값: 코어 수 - 1 (한 코어는 남겨 둔다)
 */
export const runParallel = (spec, workers) => {
  const n = workers || Math.max(1, cpus().length - 1);
  const chunk = Math.ceil(spec.matches / n);
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const from = i * chunk;
    const to = Math.min(spec.matches, from + chunk);
    if (from >= to) break;
    jobs.push({ ...spec, from, to });
  }
  return Promise.all(
    jobs.map(
      (job) =>
        new Promise((res, rej) => {
          const p = spawn(process.execPath, ['--max-old-space-size=1024', resolve(HERE, 'worker.js'), JSON.stringify(job)], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let out = '';
          let err = '';
          p.stdout.on('data', (d) => (out += d));
          p.stderr.on('data', (d) => (err += d));
          p.on('close', (code) =>
            code === 0 ? res(JSON.parse(out)) : rej(new Error('worker 실패(' + code + '): ' + err.slice(0, 400)))
          );
        })
    )
  ).then((parts) =>
    parts.reduce(
      (acc, p) => ({
        aWins: acc.aWins + p.aWins, bWins: acc.bWins + p.bWins, draws: acc.draws + p.draws,
        aPts: acc.aPts + p.aPts, bPts: acc.bPts + p.bPts,
        left: [acc.left[0] + p.left[0], acc.left[1] + p.left[1]],
        right: [acc.right[0] + p.right[0], acc.right[1] + p.right[1]],
      }),
      { aWins: 0, bWins: 0, draws: 0, aPts: 0, bPts: 0, left: [0, 0], right: [0, 0] }
    )
  );
};
