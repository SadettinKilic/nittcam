#!/usr/bin/env node
// Team status CLI. Writes .team/state.json, which the dashboard (pnpm team) reads.
//   node tools/team/status.mjs <po|dev|tester> <state> "<task>" "<message>"
//   node tools/team/status.mjs task <Txxx> <todo|doing|review|done|blocked> ["title"] [owner]
//   node tools/team/status.mjs milestone "<M0 — Temel>"
//   node tools/team/status.mjs print
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = join(root, '.team', 'state.json');
const AGENTS = ['po', 'dev', 'tester'];
const STATES = ['idle', 'planning', 'coding', 'testing', 'reviewing', 'blocked', 'done'];
const TASK_STATES = ['todo', 'doing', 'review', 'done', 'blocked'];

const empty = () => ({
  project: 'NittCam', milestone: 'M0 — Temel', updated: null,
  agents: Object.fromEntries(AGENTS.map((a) => [a, { state: 'idle', task: '', message: '', updated: null }])),
  tasks: [], log: [],
});
let s;
try { s = JSON.parse(readFileSync(file, 'utf8')); } catch { s = empty(); }

const now = new Date().toISOString();
const [cmd, ...rest] = process.argv.slice(2);
const die = (m) => { console.error(m); process.exit(1); };

if (AGENTS.includes(cmd)) {
  const [state, task = '', message = ''] = rest;
  if (!STATES.includes(state)) die(`state must be one of: ${STATES.join(', ')}`);
  s.agents[cmd] = { state, task, message, updated: now };
  s.log.unshift({ t: now, who: cmd, state, task, msg: message });
  s.log = s.log.slice(0, 60);
} else if (cmd === 'task') {
  const [id, status, title, owner] = rest;
  if (!id || !TASK_STATES.includes(status)) die(`usage: task <Txxx> <${TASK_STATES.join('|')}> ["title"] [owner]`);
  let t = s.tasks.find((x) => x.id === id);
  if (!t) { t = { id, title: title || id, status, owner: owner || 'dev' }; s.tasks.push(t); }
  t.status = status; if (title) t.title = title; if (owner) t.owner = owner;
  s.tasks.sort((a, b) => a.id.localeCompare(b.id));
} else if (cmd === 'milestone') {
  s.milestone = rest[0] || s.milestone;
} else if (cmd === 'print') {
  process.stdout.write(JSON.stringify(s, null, 2) + '\n'); process.exit(0);
} else {
  die('usage: status.mjs <po|dev|tester> <state> "<task>" "<message>" | task <id> <status> ["title"] [owner] | milestone "<name>" | print');
}

s.updated = now;
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file + '.tmp', JSON.stringify(s, null, 2) + '\n');
renameSync(file + '.tmp', file);
console.log(`ok ${cmd} ${rest.slice(0, 2).join(' ')}`);
