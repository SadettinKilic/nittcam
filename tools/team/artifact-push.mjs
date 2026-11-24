#!/usr/bin/env node
// Owner 2026-11-24: the pixel office dashboard is followed on claude.ai. This collects exactly what the local
// dashboard server serves (state.json, api/roadmap, api/prs, api/ci) into one JSON file; the PO writes it to the
// artifact db doc team/feed (ArtifactData set, file_path). Page: https://claude.ai/artifact/PrYQiU35hULwQCht2iwpib
//   node tools/team/artifact-push.mjs [out.json]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = 43000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [join(root, 'tools/team-dashboard/server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const get = async (p) => { for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/${p}`); return await r.text(); } catch { await new Promise((r) => setTimeout(r, 250)); } } return ''; };
try {
  const out = { pushed: new Date().toISOString() };
  out.state = await get('state.json');
  [out.roadmap, out.prs, out.ci] = await Promise.all([get('api/roadmap'), get('api/prs'), get('api/ci')]);
  const dest = process.argv[2] || join(root, '.team', 'artifact-feed.json');
  writeFileSync(dest, JSON.stringify(out));
  console.log(dest, Object.entries(out).map(([k, v]) => k + '=' + String(v).length).join(' '));
} finally { srv.kill(); }
