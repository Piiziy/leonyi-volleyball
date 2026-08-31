/**
 * One-shot collector for the browser trace. The page POSTs its recorded array
 * here because the devtools bridge truncates long return values.
 * Exits as soon as one body has been written.
 */
'use strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const OUT = new URL('./browser-trace.json', import.meta.url).pathname;

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    writeFileSync(OUT, body);
    res.end('ok');
    console.log(`wrote ${body.length} bytes to ${OUT}`);
    server.close();
    process.exit(0);
  });
});
server.listen(8099, () => console.log('collector listening on 8099'));
setTimeout(() => { console.error('timed out waiting for POST'); process.exit(1); }, 120000);
