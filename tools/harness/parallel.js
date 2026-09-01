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
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

/**
 * @param {Object} spec {aFile,bFile,aTune,bTune,matches,seedBase}
 * @param {number} [workers] 기본값: 코어 수 - 1 (한 코어는 남겨 둔다)
 */
/**
 * TUNE 오버라이드가 실제로 봇 파일 안에 존재하는 키인지 확인한다.
 *
 * ★ 소스만 고치고 빌드를 안 하면, 없는 키를 덮어써도 아무 일이 일어나지 않고
 *   측정은 "차이 없음"으로 조용히 끝난다. 실제로 그렇게 30분을 날렸다.
 *   Object.assign 은 없는 키도 만들어 버리므로 런타임 오류도 안 난다.
 */
const assertTuneKeysExist = (file, tune) => {
  if (file === 'ai' || !tune) return;
  const src = readFileSync(resolve(REPO, 'src/code-here', file), 'utf8');
  const missing = Object.keys(tune).filter((k) => !new RegExp('\\b' + k + '\\s*:').test(src));
  if (missing.length > 0) {
    throw new Error(
      `${file} 에 없는 TUNE 키를 덮어쓰려 합니다: ${missing.join(', ')}\n` +
      `  소스를 고친 뒤 빌드하지 않았을 가능성이 큽니다. ` +
      `\`node build.js B --as ${file.replace(/\.js$/, '')}\` 를 먼저 실행하세요.`
    );
  }
};

export const runParallel = (spec, workers) => {
  assertTuneKeysExist(spec.aFile, spec.aTune);
  assertTuneKeysExist(spec.bFile, spec.bTune);
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
