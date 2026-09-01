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

const out = { aWins: 0, bWins: 0, draws: 0, aPts: 0, bPts: 0, left: [0, 0], right: [0, 0] };
for (let m = job.from; m < job.to; m++) {
  for (const flipped of [false, true]) {
    const r = runMatch({
      left: flipped ? make(job.bFile, job.bTune) : make(job.aFile, job.aTune),
      right: flipped ? make(job.aFile, job.aTune) : make(job.bFile, job.bTune),
      seed: job.seedBase + m,
      touchLimit: true,
    });
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
