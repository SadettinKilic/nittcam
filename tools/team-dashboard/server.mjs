#!/usr/bin/env node
// Zero-dependency local server for the team dashboard: http://localhost:4321
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stateFile = join(here, '..', '..', '.team', 'state.json');
const port = Number(process.env.PORT || 4321);

createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/state.json')) {
      const body = await readFile(stateFile, 'utf8').catch(() => '{}');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(body);
    }
    const page = await readFile(join(here, 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + page + '</body></html>');
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(port, () => console.log(`NittCam atölye paneli: http://localhost:${port}`));
