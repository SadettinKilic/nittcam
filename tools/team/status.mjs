#!/usr/bin/env node
// Team status CLI. Writes .team/state.json, which the dashboard (pnpm team) reads.
//   node tools/team/status.mjs <po|dev|dev2|tester|devops|fable> <state> "<task>" "<message>"
//   node tools/team/status.mjs mode <on|off>   (D-054 paralellik: on = PO, Dev 1, Dev 2, Tester, DevOps, CTO; off = PO, Dev 1, Tester)
//   node tools/team/status.mjs task <Txxx> <todo|doing|review|done|blocked> ["title"] [owner]
//   node tools/team/status.mjs milestone "<M0 — Temel>"
//   node tools/team/status.mjs limit on "<19:40>" | limit off
//   (the status line writes .team/limits.json; it is merged into state.json on every write)
//   node tools/team/status.mjs ask "<question>" ["option" ...]  |  answered <Qxxx> "<answer>"
//   node tools/team/status.mjs alert "<message>" | alert off   ("PC'ye bak" popup)
//   node tools/team/status.mjs call   (owner wrote to the PO: desk phone rings on the dashboard, hangs up 10 s after the last call; silent on any error)
//   (D-054 retired the flexible seats: `role` and `dev3` are accepted from old callers and ignored; every write drops them from state)
//   T315 guest seats (CNC operators who test the app as real users). Kept in state.ustas, not state.agents, so older copies of
//   this script in other worktrees never drop them:
//   node tools/team/status.mjs <usta1|usta2> <state> "<task>" "<message>"
//   node tools/team/status.mjs feedback <usta1|usta2> "<+|-|?>" "<short text>"   (+ advantage, - disadvantage, ? question/idea; "Usta yorumları" panel)
//   node tools/team/status.mjs seat <usta1|usta2|ustalar> <on|off>   (off hides the seat in the office when the test is over)
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
// D-054 fixed team: fable = CTO (reviews every 2 batches), devops = integration to main
const AGENTS = ['po', 'dev', 'dev2', 'tester', 'devops', 'fable'];
const USTAS = ['usta1', 'usta2']; // T315 guest seats
const KINDS = ['+', '-', '?'];
const RETIRED = ['dev3']; // D-052 flexible seat; old callers still send it
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
let [cmd, ...rest] = process.argv.slice(2);
const die = (m) => { console.error(m); process.exit(1); };
if (cmd === 'call') { // hook-safe: sets state.call.at, never fails loudly
  try {
    s.call = { at: now };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file + '.tmp', JSON.stringify(s, null, 2) + '\n');
    renameSync(file + '.tmp', file);
  } catch {}
  process.exit(0);
}

if (RETIRED.includes(cmd) || cmd === 'role') {
  console.log(`ignored: "${cmd}" was retired by D-054 (fixed team)`);
  cmd = 'prune';
}
if (cmd === 'prune') {
  // nothing else: the write below drops legacy keys
} else if (AGENTS.includes(cmd)) {
  const [state, task = '', message = ''] = rest;
  if (!STATES.includes(state)) die(`state must be one of: ${STATES.join(', ')}`);
  s.agents = s.agents || {};
  s.agents[cmd] = { state, task, message, updated: now };
  s.log.unshift({ t: now, who: cmd, state, task, msg: message });
  s.log = s.log.slice(0, 60);
} else if (USTAS.includes(cmd)) {
  const [state, task = '', message = ''] = rest;
  if (!STATES.includes(state)) die(`state must be one of: ${STATES.join(', ')}`);
  s.ustas = s.ustas || {};
  const prev = s.ustas[cmd] || {};
  s.ustas[cmd] = { state, task, message, updated: now, on: prev.on !== false };
  s.log.unshift({ t: now, who: cmd, state, task, msg: message });
  s.log = s.log.slice(0, 60);
} else if (cmd === 'feedback') {
  // feedback <usta1|usta2> "<+|-|?>" "<short text>"
  const [who, kindRaw = '', text = ''] = rest;
  const kind = kindRaw.trim().replace('−', '-');
  if (!USTAS.includes(who) || !KINDS.includes(kind) || !text.trim()) die('usage: feedback <usta1|usta2> "<+|-|?>" "<short text>"');
  s.feedback = s.feedback || [];
  s.feedback.unshift({ t: now, who, kind, text: text.trim().slice(0, 400) });
  s.feedback = s.feedback.slice(0, 200);
} else if (cmd === 'seat') {
  // seat <usta1|usta2|ustalar> <on|off>
  const [who = '', m] = rest;
  const keys = who === 'ustalar' ? USTAS : [who];
  if (!keys.every((k) => USTAS.includes(k)) || !['on', 'off'].includes(m)) die('usage: seat <usta1|usta2|ustalar> <on|off>');
  s.ustas = s.ustas || {};
  for (const k of keys) s.ustas[k] = { state: 'idle', task: '', message: '', updated: null, ...s.ustas[k], on: m === 'on' };
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
} else if (cmd === 'mode') {
  // mode <on|off>  -> paralellik (D-054); the dashboard shows the roster of this mode
  const [m] = rest;
  if (!['on', 'off'].includes(m)) die('usage: mode <on|off>');
  s.mode = m;
  s.log.unshift({ t: now, who: 'po', state: 'planning', task: '', msg: `Paralellik ${m === 'on' ? 'açık' : 'kapalı'}` });
  s.log = s.log.slice(0, 60);
} else if (cmd === 'milestone') {
  s.milestone = rest[0] || s.milestone;
} else if (cmd === 'print') {
  process.stdout.write(JSON.stringify(s, null, 2) + '\n'); process.exit(0);
} else {
  die('usage: status.mjs <po|dev|dev2|tester|devops|fable|usta1|usta2> <state> "<task>" "<message>" | feedback <usta1|usta2> "<+|-|?>" "<text>" | seat <usta1|usta2|ustalar> <on|off> | task <id> <status> ["title"] [owner] | mode <on|off> | prune | milestone "<name>" | call | print');
}

s.updated = now;
// D-054: drop legacy members and the flexible-seat map (older copies of this script may write them back; the dashboard ignores them)
delete s.seats;
for (const k of Object.keys(s.agents || {})) if (!AGENTS.includes(k)) delete s.agents[k];
// merge the latest usage-limit snapshot written by the Claude Code status line
try { s.limits = JSON.parse(readFileSync(join(root, '.team', 'limits.json'), 'utf8')); } catch {}
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file + '.tmp', JSON.stringify(s, null, 2) + '\n');
renameSync(file + '.tmp', file);
console.log(`ok ${cmd} ${rest.slice(0, 2).join(' ')}`);
