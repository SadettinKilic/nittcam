#!/usr/bin/env node
// Team status CLI. Writes .team/state.json, which the dashboard (pnpm team) reads.
//   node tools/team/status.mjs <po|dev|tester|fable> <state> "<task>" "<message>"
//   node tools/team/status.mjs task <Txxx> <todo|doing|review|done|blocked> ["title"] [owner]
//   node tools/team/status.mjs milestone "<M0 — Temel>"
//   node tools/team/status.mjs limit on "<19:40>" | limit off
//   (the status line writes .team/limits.json; it is merged into state.json on every write)
//   node tools/team/status.mjs ask "<question>" ["option" ...]  |  answered <Qxxx> "<answer>"
//   node tools/team/status.mjs alert "<message>" | alert off   ("PC'ye bak" popup)
//   node tools/team/status.mjs print
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execSync } from 'node:child_process';
const here = dirname(fileURLToPath(import.meta.url));
// .team lives in the main checkout so every git worktree shares one state
let root = join(here, '..', '..');
try { root = dirname(execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch {}
const file = join(root, '.team', 'state.json');
// fable = visiting design reviewer, shown in the office only while active
const AGENTS = ['po', 'dev', 'tester', 'fable'];
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
  s.agents = s.agents || {};
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
} else if (cmd === 'limit') {
  // limit on "<reset time, e.g. 19:40>" ["note"]  |  limit off
  const [mode, resetsAt = '', note = ''] = rest;
  if (mode === 'on') {
    s.quota = { blocked: true, resetsAt, note, since: now };
    s.log.unshift({ t: now, who: 'po', state: 'blocked', task: '', msg: `Model limiti doldu${resetsAt ? `, ${resetsAt}'de sıfırlanır` : ''}.` });
  } else if (mode === 'off') {
    s.quota = { blocked: false, resetsAt: '', note: '', since: now };
    s.log.unshift({ t: now, who: 'po', state: 'planning', task: '', msg: 'Limit sıfırlandı, ekip devam ediyor.' });
  } else die('usage: limit on "<HH:MM>" ["note"] | limit off');
  s.log = s.log.slice(0, 60);
} else if (cmd === 'ask') {
  // ask "<question>" ["option 1" "option 2" ...]  -> shown on the dashboard until answered
  const [text, ...options] = rest;
  if (!text) die('usage: ask "<question>" ["option" ...]');
  s.questions = s.questions || [];
  const id = 'Q' + String(s.questions.length + 1).padStart(3, '0');
  s.questions.push({ id, text, options, askedAt: now, status: 'open', answer: '' });
  s.log.unshift({ t: now, who: 'po', state: 'blocked', task: id, msg: 'Sana soru: ' + text.slice(0, 80) });
  s.log = s.log.slice(0, 60);
  console.log(id);
} else if (cmd === 'answered') {
  // answered <Qxxx> "<answer>"
  const [id, answer = ''] = rest;
  const q = (s.questions || []).find((x) => x.id === id);
  if (!q) die('unknown question ' + id);
  Object.assign(q, { status: 'answered', answer, answeredAt: now });
} else if (cmd === 'alert') {
  // alert "<message>" -> "PC'ye bak" popup on the dashboard  |  alert off
  const [msg = ''] = rest;
  if (!msg) die('usage: alert "<message>" | alert off');
  if (msg === 'off') { delete s.alert; }
  else {
    s.alert = { msg, since: now };
    s.log.unshift({ t: now, who: 'po', state: 'blocked', task: '', msg: "PC'ye bak: " + msg.slice(0, 80) });
    s.log = s.log.slice(0, 60);
  }
} else if (cmd === 'milestone') {
  s.milestone = rest[0] || s.milestone;
} else if (cmd === 'print') {
  process.stdout.write(JSON.stringify(s, null, 2) + '\n'); process.exit(0);
} else {
  die('usage: status.mjs <po|dev|tester|fable> <state> "<task>" "<message>" | task <id> <status> ["title"] [owner] | milestone "<name>" | print');
}

s.updated = now;
// merge the latest usage-limit snapshot written by the Claude Code status line
try { s.limits = JSON.parse(readFileSync(join(root, '.team', 'limits.json'), 'utf8')); } catch {}
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file + '.tmp', JSON.stringify(s, null, 2) + '\n');
renameSync(file + '.tmp', file);
console.log(`ok ${cmd} ${rest.slice(0, 2).join(' ')}`);
