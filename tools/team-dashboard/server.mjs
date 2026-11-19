#!/usr/bin/env node
// Zero-dependency local server for the team dashboard: http://localhost:4321 (PORT env overrides)
//   GET  /state.json    team state (.team/state.json + .team/limits.json)
//   GET  /api/roadmap   milestones, batches and tasks parsed from docs/BACKLOG.md on origin/main (what has landed; cached per commit)
//                       BACKLOG_FILE=<path> reads a file instead (preview/testing); without git it falls back to the checkout's file
//   GET  /api/ci        latest GitHub Actions runs via `gh` (cached 60 s; {available:false} without gh)
//   GET  /api/prs       open PRs via `gh` (number, title, branch, labels; cached 60 s; {available:false} without gh)
//   POST /api/answer    {id, answer} -> `status.mjs answered <id> "<answer>"` (answer a question from the phone)
import { createServer } from 'node:http';
import { execSync, execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let root = join(here, '..', '..');
try { root = dirname(execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch {}
const stateFile = process.env.STATE_FILE || join(root, '.team', 'state.json'); // STATE_FILE: test with sample data
const backlogFile = process.env.BACKLOG_FILE || join(root, 'docs', 'BACKLOG.md');
const statusCli = join(here, '..', 'team', 'status.mjs');
const port = Number(process.env.PORT || 4321);

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { cwd: root, timeout: 15000, windowsHide: true, maxBuffer: 1 << 20, ...opts }, (err, out) => resolve(err ? null : String(out)));
});

// ---------- roadmap from docs/BACKLOG.md ----------
const TASK_RE = /^### (T\d+[a-z]?)\s+(.*?)\s+\[status:\s*([\w-]+)\]/;
const BATCH_RE = /^### Batch (B\d+[a-z]?)\s*:?\s*(.*)$/;
const MS_RE = /^## (M\d+(?:\.\d+)?(?: early)?)\s*:\s*(.*)$/;
export function parseBacklog(md) {
  const milestones = []; let ms = null, batch = null, later = false;
  const clean = (s) => s.replace(/`/g, '').trim();
  for (const line of md.split(/\r?\n/)) {
    let m;
    if (line.startsWith('## ')) {
      batch = null; ms = null;
      if (/^## After the field test/i.test(line)) { later = true; continue; }
      if ((m = line.match(MS_RE))) {
        const rest = m[2]; const ex = rest.match(/\(exit:\s*(.*)\)\s*$/);
        const name = clean(rest.replace(/\s*\(.*\)\s*$/, '').replace(/,\s*B\d+.*$/, ''));
        ms = { id: m[1].replace(' early', ' erken'), name, exit: ex ? clean(ex[1]) : '', batches: [], later: false };
        milestones.push(ms);
      } else if (/^## Field test/i.test(line)) {
        const st = (line.match(/\[status:\s*(\w+)\]/) || [])[1] || 'todo';
        milestones.push({ id: 'Saha 1', name: 'Sahada test (sahip)', exit: 'iki makinede hava kesimi + deneme kesimi', batches: [], later: false, gate: true, status: st });
      } else if (/^## Done: M0/i.test(line)) {
        milestones.push({ id: 'M0–M1', name: 'Temel ve ince dilim', exit: '', batches: [], later: false, doneAll: true });
      }
      continue;
    }
    if (later && (m = line.match(/^### (M\d+(?:–M\d+)?)\s*:\s*(.*)$/))) {
      milestones.push({ id: m[1], name: clean(m[2].replace(/\s*\(.*?\)/g, '').replace(/,\s*behind.*$/, '')), exit: '', batches: [], later: true });
      continue;
    }
    if (!ms) continue;
    if ((m = line.match(TASK_RE))) {
      if (!batch) { batch = { id: '', name: '', tasks: [] }; ms.batches.push(batch); }
      batch.tasks.push({ id: m[1], title: clean(m[2]), status: m[3].toLowerCase() });
    } else if ((m = line.match(BATCH_RE))) {
      const nm = (m[2].match(/\(([^)]*)\)/) || [])[1] || '';
      batch = { id: m[1], name: clean(nm.replace(/;.*$/, '')), tasks: [] }; ms.batches.push(batch);
    } else if ((m = line.match(/^### (.*?)\briders?\b/i))) {
      // "### CTO review #4 riders: T261–T263 (...)": riders ship with other batches; keep the review in the name
      const src = m[1].replace(/review/i, 'inceleme').replace(/[:\s]+$/, '').trim();
      batch = { id: 'Ek', name: (src ? src + ' ekleri' : 'ekler') + ', başka paketlerle gelir', tasks: [] }; ms.batches.push(batch);
    } else if (/^### /.test(line) && !/^### T\d/.test(line)) {
      batch = null; // any other sub-heading ends the batch (notes, deferred text)
    }
  }
  for (const x of milestones) {
    x.batches = x.batches.filter((b) => b.tasks.length);
    const all = x.batches.flatMap((b) => b.tasks);
    const counted = all.filter((t) => t.status !== 'deferred'); // deferred tasks moved elsewhere (e.g. T248 → mobile pass)
    x.total = counted.length; x.done = counted.filter((t) => t.status === 'done').length;
    x.active = all.some((t) => t.status === 'doing' || t.status === 'review');
  }
  return milestones;
}

const expandIds = (s) => {
  const ids = new Set();
  for (const m of s.matchAll(/T(\d{3})([a-z]?)(?:\s*[–-]\s*T(\d{3}))?/g)) {
    if (m[3] && !m[2]) for (let n = +m[1]; n <= +m[3] && n - +m[1] < 20; n++) ids.add('T' + n);
    else ids.add('T' + m[1] + m[2]);
  }
  return ids;
};

// BACKLOG as it is on origin/main (statuses are set to done in the integration PR, D-054), so a stale or
// switched local checkout never shows old statuses. Any agent's `git fetch` refreshes origin/main.
async function backlogSource() {
  if (!process.env.BACKLOG_FILE) {
    const rev = (await run('git', ['rev-parse', 'origin/main']))?.trim();
    if (rev) return { key: rev, ref: 'origin/main', read: () => run('git', ['show', 'origin/main:docs/BACKLOG.md'], { maxBuffer: 8 << 20 }) };
  }
  const st = await stat(backlogFile);
  return { key: 'file:' + st.mtimeMs, ref: process.env.BACKLOG_FILE ? 'dosya' : 'çalışma kopyası', read: () => readFile(backlogFile, 'utf8') };
}

let roadmapCache = { key: '', body: null, velAt: 0, vel: null };
async function roadmap() {
  const src = await backlogSource();
  const now = Date.now();
  if (now - roadmapCache.velAt > 5 * 60_000) {
    // velocity: task ids in commit subjects that reached main in the last 24 h
    const log = (await run('git', ['log', '--since=24 hours ago', '--format=%s', 'origin/main'])) ?? (await run('git', ['log', '--since=24 hours ago', '--format=%s', 'main'])) ?? '';
    roadmapCache.vel = expandIds(log).size; roadmapCache.velAt = now; roadmapCache.body = null;
  }
  if (roadmapCache.body && roadmapCache.key === src.key) return roadmapCache.body;
  const md = await src.read();
  if (!md) throw new Error('BACKLOG okunamadı (' + src.ref + ')');
  const milestones = parseBacklog(md);
  const pre = []; for (const m of milestones) { if (m.later) break; pre.push(m); }
  const total = pre.reduce((a, m) => a + m.total, 0), done = pre.reduce((a, m) => a + m.done, 0);
  roadmapCache = { ...roadmapCache, key: src.key, body: JSON.stringify({
    milestones, total, done, doneLast24h: roadmapCache.vel, source: src.ref, file: 'docs/BACKLOG.md', read: new Date().toISOString(),
  }) };
  return roadmapCache.body;
}

// ---------- CI via gh (optional) ----------
const ghCmd = process.platform === 'win32' ? ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe'] : ['gh'];
let ciCache = { at: 0, body: JSON.stringify({ available: false }) }, ciBusy = null;
async function ci() {
  if (Date.now() - ciCache.at < 60_000) return ciCache.body;
  if (!ciBusy) ciBusy = (async () => {
    let out = null;
    for (const g of ghCmd) { out = await run(g, ['run', 'list', '--limit', '8', '--json', 'status,conclusion,headBranch,workflowName,createdAt,updatedAt,displayTitle,event,url']); if (out) break; }
    let runs = null; try { runs = JSON.parse(out); } catch {}
    ciCache = { at: Date.now(), body: JSON.stringify(runs ? { available: true, runs, read: new Date().toISOString() } : { available: false }) };
    ciBusy = null;
  })();
  await ciBusy; return ciCache.body;
}

let prCache = { at: 0, body: JSON.stringify({ available: false }) }, prBusy = null;
async function prs() {
  if (Date.now() - prCache.at < 60_000) return prCache.body;
  if (!prBusy) prBusy = (async () => {
    let out = null;
    for (const g of ghCmd) { out = await run(g, ['pr', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,headRefName,labels,isDraft']); if (out) break; }
    let list = null; try { list = JSON.parse(out); } catch {}
    prCache = { at: Date.now(), body: JSON.stringify(list ? { available: true, prs: list.map((p) => ({ number: p.number, title: p.title, branch: p.headRefName, draft: !!p.isDraft, labels: (p.labels || []).map((l) => l.name) })) } : { available: false }) };
    prBusy = null;
  })();
  await prBusy; return prCache.body;
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };

createServer(async (req, res) => {
  try {
    const url = req.url || '/';
    if (url.startsWith('/state.json')) {
      let st = {}; try { st = JSON.parse(await readFile(stateFile, 'utf8')); } catch {}
      try { st.limits = JSON.parse(await readFile(join(dirname(stateFile), 'limits.json'), 'utf8')); } catch {}
      return send(res, 200, JSON.stringify(st));
    }
    if (url.startsWith('/api/roadmap')) {
      try { return send(res, 200, await roadmap()); } catch (e) { return send(res, 200, JSON.stringify({ milestones: [], error: String(e.message || e) })); }
    }
    if (url.startsWith('/api/ci')) return send(res, 200, await ci());
    if (url.startsWith('/api/prs')) return send(res, 200, await prs());
    if (url.startsWith('/api/answer') && req.method === 'POST') {
      let raw = ''; for await (const c of req) { raw += c; if (raw.length > 4000) break; }
      let b = {}; try { b = JSON.parse(raw); } catch {}
      const id = String(b.id || ''), answer = String(b.answer || '').trim().slice(0, 1000);
      if (!/^Q\d{3,}$/.test(id) || !answer) return send(res, 400, JSON.stringify({ ok: false }));
      const out = await run(process.execPath, [statusCli, 'answered', id, answer]);
      return send(res, out ? 200 : 500, JSON.stringify({ ok: !!out }));
    }
    const page = await readFile(join(here, 'index.html'), 'utf8');
    send(res, 200, '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + page + '</body></html>', 'text/html; charset=utf-8');
  } catch (e) {
    send(res, 500, String(e), 'text/plain');
  }
}).listen(port, () => console.log(`NittCam ofis paneli: http://localhost:${port}`));
