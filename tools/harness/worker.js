/**
 * 병렬 평가의 일꾼. 시드 구간 하나를 맡아 돌리고 결과를 JSON 한 줄로 뱉는다.
 * 부모(parallel.js)가 CPU 코어 수만큼 띄운다.
 *
 * 이 파일을 직접 부를 일은 없다.
 */
'use strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatch } from './match.js';
import { compileBot } from './botInput.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const job = JSON.parse(process.argv[2]);

const make = (file, tune) => {
  if (file === 'ai') return { kind: 'ai' };
  const src =
    readFileSync(resolve(REPO, 'src/code-here', file), 'utf8') +
    (tune ? '\n;Object.assign(TUNE, ' + JSON.stringify(tune) + ');' : '');
  return { kind: 'bot', decide: compileBot(src, file) };
};

// ★ 봇이 던진 예외는 반드시 위로 올려야 한다. decide() 가 예외를 던지면
//   그 틱은 무입력이 되는데, 승률로는 그냥 "약한 봇"으로 보인다. 이 값을
//   전달하지 않던 동안 handicap/hsweep/panel 로 돌린 모든 측정이 그 구분을
//   못 했다. 조용한 실패는 이 하네스에서 반복해서 사람을 속여 왔다.
const out = { aWins: 0, bWins: 0, draws: 0, aPts: 0, bPts: 0, left: [0, 0], right: [0, 0],
  aBad: { exc: 0, invalid: 0, hard: 0, err: null }, bBad: { exc: 0, invalid: 0, hard: 0, err: null } };
const collect = (bad, st) => {
  if (!st) return;                      // 내장 AI 쪽은 stats 가 없다
  bad.exc += st.exceptions;
  bad.invalid += st.invalidActions;
  bad.hard += st.overHardTimeout;
  if (bad.err === null && st.firstError) bad.err = st.firstError;
};
for (let m = job.from; m < job.to; m++) {
  for (const flipped of [false, true]) {
    const r = runMatch({
      left: flipped ? make(job.bFile, job.bTune) : make(job.aFile, job.aTune),
      right: flipped ? make(job.aFile, job.aTune) : make(job.bFile, job.bTune),
      seed: job.seedBase + m,
      touchLimit: true,
    });
    collect(out.aBad, flipped ? r.botStats[1] : r.botStats[0]);
    collect(out.bBad, flipped ? r.botStats[0] : r.botStats[1]);
    const a = flipped ? r.scores[1] : r.scores[0];
    const b = flipped ? r.scores[0] : r.scores[1];
    out.aPts += a; out.bPts += b;
    if (a === b) { out.draws++; continue; }
    const bucket = flipped ? out.right : out.left;
    bucket[1]++;
    if (a > b) { out.aWins++; bucket[0]++; } else out.bWins++;
  }
}
process.stdout.write(JSON.stringify(out));
