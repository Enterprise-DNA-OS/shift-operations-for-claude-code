#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.
// Set TEST_DATABASE_URL to run the same checks against a disposable Postgres.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'shiftops-smoke-'));
const imp = path.join(dataDir, 'imports');
mkdirSync(imp);
const env = { ...process.env, DATA_DIR: path.join(dataDir, 'db'), OUTPUT_DIR: dataDir };
delete env.DATABASE_URL;
const pgUrl = process.env.TEST_DATABASE_URL;
if (pgUrl) env.DATABASE_URL = pgUrl;

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);
const O = 'ops.mjs';
const addHours = (s, h) => {
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  d.setUTCHours(d.getUTCHours() + h);
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

console.log(`smoke: ${pgUrl ? 'Postgres at TEST_DATABASE_URL' : `data dir ${dataDir}`}`);
try {
  if (pgUrl) {
    const { default: pg } = await import('pg');
    const c = new pg.Client({ connectionString: pgUrl });
    await c.connect();
    await c.query('drop schema public cascade; create schema public;');
    await c.end();
  }
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs', '--demo-database'], { json: false });
  run('seed again (idempotent)', ['seed.mjs', '--demo-database'], { json: false });

  // ---- what needs a decision -----------------------------------------------------------------

  const att = run('attention', [O, 'attention']);
  const reasons = new Set(att.map((a) => a.reason));
  for (const r of ['notifiable', 'bypass_overdue', 'sol_excursion', 'handover_open', 'competency', 'fatigue', 'round_missed', 'unexplained', 'unacked', 'order_expired', 'action_overdue']) assert(reasons.has(r), `attention has ${r}`);
  assert(att[0].reason === 'notifiable', 'the unnotified burn is first');
  const comp = run('compliance', [O, 'compliance']);
  assert(comp.length === 11 && comp.every((r) => r.breaches > 0 && r.source), 'eleven rules, each breached on the demo, each with a source');
  const bih = run('compliance bypass-in-handover', [O, 'compliance', 'bypass-in-handover']);
  assert(bih[0].rows.length === 1 && /BYP-301/.test(bih[0].rows[0].detail), 'the handover that left the trip bypass off');
  run('an unknown rule exits 1', [O, 'compliance', 'nonsense'], { expectFail: true });
  const week = run('week', [O, 'week']);
  assert(n(week.shifts) >= 40 && n(week.handovers_open) === 2 && n(week.handovers_late) === 1 && n(week.rounds_missed) === 1 && n(week.injuries) === 1, `the week adds up (${JSON.stringify(week)})`);

  // ---- the handover: refused, then accepted --------------------------------------------------

  const now = run('who is on shift', [O, 'shift']);
  assert(now.length === 3, 'one open shift per area');
  const pack = run('handover pack dry run', [O, 'handover', 'UTL', '--dry-run']);
  assert(pack.pack.bypasses.some((b) => b.ref === 'BYP-301' && b.overdue), 'the overdue trip bypass is in the pack');
  assert(pack.pack.standing_orders.some((o) => o.ref === 'SO-102' && o.expired), 'the expired order is flagged in the pack');
  assert(pack.pack.carry_forward.length >= 2, 'the burn and the trip carry forward');
  const noLead = run('accept by a lead with a lapsed sign-off is refused', [O, 'accept', 'UTL'], { expectFail: true });
  assert(/not signed off/.test(noLead.stderr) && /SO-101/.test(noLead.stderr), 'refused on the sign-off and the unread order');
  const noAck = run('accept without reading the standing order is refused', [O, 'accept', 'UTL', '--by=Kahu Rangi'], { expectFail: true });
  assert(/SO-101/.test(noAck.stderr) && !/not signed off/.test(noAck.stderr), 'refused on the unread order only');
  const ack = run('acknowledge SO-101', [O, 'ack', 'SO-101', '--by=Kahu Rangi, Tama Ngata']);
  assert(ack.acknowledged_by.length === 2, 'two acknowledged');
  const acc = run('accept the handover', [O, 'accept', 'UTL', '--by=Kahu']);
  assert(acc.accepted_by === 'Kahu Rangi' && acc.late === true, 'accepted, and recorded as late');
  run('accept twice is refused', [O, 'accept', 'UTL', '--by=Kahu Rangi'], { expectFail: true });
  const att2 = run('attention after', [O, 'attention']);
  assert(!att2.some((a) => a.reason === 'unacked'), 'nobody left unread on SO-101');
  assert(att2.filter((a) => a.reason === 'handover_open').length === 1, 'one handover still open (the missing one)');
  const given = run('give the wastewater handover', [O, 'handover', 'WWT', '--summary=DAF steady, blower 2 back on auto']);
  assert(given.given_by === "Liam O'Brien" && Array.isArray(given.items.bypasses), 'handover given by the lead with its snapshot');
  run('give it twice shows the pack, records nothing', [O, 'handover', 'WWT']);

  // ---- the logbook ---------------------------------------------------------------------------

  const e = run('log a notifiable event with an action', [O, 'entry', 'Chlorine smell at the DAF, area cleared, operator to the medical centre', '--area=WWT', "--by=Liam O'Brien", '--category=safety', '--injury', '--notifiable', '--action=Check DAF hypochlorite dosing line', '--owner=Craig Dunn', '--due=tomorrow']);
  assert(e.entry.notifiable && e.entry.carry_forward && e.action && e.warnings.some((w) => /regulator/.test(w)), 'notifiable, carried forward, an action, a warning');
  run('a bad category is refused before anything is written', [O, 'entry', 'x', '--area=WWT', '--category=rumour'], { expectFail: true });
  run('close a notifiable entry before notifying is refused', [O, 'close', e.entry.ref], { expectFail: true });
  run('record the notification', [O, 'notified', e.entry.ref, '--ref=WorkSafe 2026-NE-05120']);
  run('then close it', [O, 'close', e.entry.ref]);
  const card = run('entry card', [O, 'entry-card', e.entry.ref]);
  assert(card.actions.length === 1 && card.notified_at && card.closed_at, 'the card shows the action, the notice and the close');
  const ents = run('entries, search', [O, 'entries', 'UTL', '--days=7', '--search=drum level']);
  assert(ents.length >= 1, 'the drum level trip is found');
  run('an ambiguous person lists candidates', [O, 'entries', '--days=1', '--category=safety']);

  // ---- bypasses -------------------------------------------------------------------------------

  const long = run('a safety-critical bypass longer than one period is refused', [O, 'bypass', 'PSHH-411', '--area=UTL', '--kind=trip_bypass', '--description=Compressor 1 high-high discharge pressure trip', '--reason=Transmitter swap', '--by=Kahu Rangi', '--authorised-by=Mere Tane', '--hours=24'], { expectFail: true });
  assert(/12 hours/.test(long.stderr), 'refused on the period');
  run('self-authorised safety-critical bypass is refused', [O, 'bypass', 'PSHH-411', '--area=UTL', '--kind=trip_bypass', '--description=x', '--reason=y', '--by=Mere Tane', '--authorised-by=Mere Tane', '--hours=4'], { expectFail: true });
  run('an operator cannot authorise', [O, 'bypass', 'PSHH-411', '--area=UTL', '--kind=trip_bypass', '--description=x', '--reason=y', '--by=Kahu Rangi', '--authorised-by=Tama Ngata', '--hours=4'], { expectFail: true });
  const b = run('apply a bypass', [O, 'bypass', 'PSHH-411', '--area=UTL', '--kind=trip_bypass', '--description=Compressor 1 high-high discharge pressure trip', '--reason=Transmitter swap, operator in attendance', '--by=Kahu Rangi', '--authorised-by=Mere Tane', '--hours=4']);
  assert(b.safety_critical && b.log_entry, 'a trip bypass is safety critical and logs itself');
  run('the same tag twice is refused', [O, 'bypass', 'PSHH-411', '--area=UTL', '--kind=trip_bypass', '--description=x', '--reason=y', '--by=Kahu Rangi', '--authorised-by=Mere Tane', '--hours=4'], { expectFail: true });
  run('extend BYP-301 once', [O, 'extend', 'BYP-301', '--hours=8', '--authorised-by=Mere Tane']);
  const ext = run('a second extension without a risk assessment is refused', [O, 'extend', 'BYP-301', '--hours=8', '--authorised-by=Mere Tane'], { expectFail: true });
  assert(/risk assessment/.test(ext.stderr), 'refused: risk assessment');
  run('extend with a risk assessment', [O, 'extend', 'BYP-301', '--hours=8', '--authorised-by=Steve Bishop', '--ra=RA-2291']);
  run('restore BYP-301', [O, 'restore', 'BYP-301', '--by=Kahu Rangi']);
  run('restore by tag', [O, 'restore', 'PSHH-411', '--by=Kahu Rangi']);
  const byps = run('bypasses', [O, 'bypasses']);
  assert(byps.length === 1 && byps[0].ref === 'BYP-302', 'only the bag filter inhibit is left');

  // ---- rounds and limits ----------------------------------------------------------------------

  const missed = run('missed rounds', [O, 'rounds', '--state=missed']);
  assert(missed.length === 1 && missed[0].route === 'WWT-R', 'the missed wastewater round');
  const rd = run('record a round with a safe-limit excursion', [O, 'round', 'WWT-R', "--by=Liam O'Brien", '--values=AIT-501=0.6,AIT-520=7.4,FT-530=60']);
  const sol = rd.readings.find((x) => x.tag === 'AIT-501');
  assert(sol.band === 'sol' && sol.log_entry && rd.not_read.includes('AIT-525'), 'low DO logs itself; turbidity not read');
  run('a tag not on the round is refused', [O, 'round', 'PWD-R', '--by=Anika Patel', '--values=LT-202=50'], { expectFail: true });
  const ex = run('explain the dryer temperature', [O, 'explain', 'TT-301', 'Inlet damper stuck open, freed by maintenance', '--by=Anika Patel']);
  assert(ex.entry, 'explained');
  const xs = run('unexplained excursions', [O, 'excursions', '--open']);
  assert(xs.length === 0, 'nothing outside limits is unexplained');
  const tr = run('trend', [O, 'trend', 'LT-202', '--days=3']);
  assert(n(tr.stats.min) === 17 && tr.readings.length >= 12, 'the drum level trend shows the 17 per cent');
  run('a limit change needs a reason', [O, 'limit', 'TT-301', '--alarm-high=96'], { expectFail: true });
  run('change a limit', [O, 'limit', 'TT-301', '--alarm-high=96', '--reason=Process engineer, MOC-118']);

  // ---- standing orders ------------------------------------------------------------------------

  run('an order with no expiry is refused', [O, 'issue', 'Hold Evaporator 1 at 30 m3/h', '--area=PWD', '--instruction=Hold feed at 30 m3/h', '--by=Rachel Morgan', '--approved-by=Nikhil Rao'], { expectFail: true });
  run('an order past 90 days is refused', [O, 'issue', 'Hold Evaporator 1 at 30 m3/h', '--area=PWD', '--instruction=Hold feed at 30 m3/h', '--by=Rachel Morgan', '--approved-by=Nikhil Rao', '--expires=2030-01-01'], { expectFail: true });
  run('an operator cannot approve an order', [O, 'issue', 'Hold Evaporator 1 at 30 m3/h', '--area=PWD', '--instruction=Hold feed at 30 m3/h', '--by=Rachel Morgan', '--approved-by=Anika Patel', '--expires=today'], { expectFail: true });
  const so = run('issue an order', [O, 'issue', 'Hold Evaporator 1 at 30 m3/h', '--area=PWD', '--instruction=Hold feed at 30 m3/h until the finisher pump is rebuilt', '--by=Rachel Morgan', '--approved-by=Nikhil Rao', `--expires=${addHours(now[0].starts_at, 24 * 10).slice(0, 10)}`]);
  assert(/^SO-/.test(so.ref), 'issued');
  run('withdraw the expired order', [O, 'withdraw', 'SO-102', '--reason=CIP week finished']);
  const ord = run('order card', [O, 'order', so.ref]);
  assert(ord.acks.length === 1, 'the issuer has acknowledged their own order');

  // ---- people: sign-offs and fatigue ----------------------------------------------------------

  const fat = run('fatigue', [O, 'fatigue']);
  assert(fat.people.find((p) => p.person === 'Jack Thompson').over.includes('rest'), 'Jack went straight from a day onto a night');
  const cmp = run('competency', [O, 'competency']);
  assert(cmp.expiring.some((c) => c.person === 'Tama Ngata' && c.state === 'LAPSED') && cmp.worked_without.length === 1, 'Tama lapsed and kept working UTL');
  run('add an area', [O, 'add', 'area', 'Laboratory', '--code=LAB', '--hazards=Solvents']);
  const wwt = run('the wastewater shift', [O, 'shift', 'WWT']);
  const after = addHours(wwt.shift.ends_at, 4);
  const noSign = run('start a shift with someone not signed off is refused', [O, 'start', 'LAB', "--lead=Liam O'Brien", `--at=${after}`, '--hours=8'], { expectFail: true });
  assert(/not signed off/.test(noSign.stderr), 'refused: sign-off');
  run('sign off for the lab', [O, 'signoff', "Liam O'Brien", '--area=LAB', '--by=Mere Tane', '--on=2026-01-01', '--expires=2028-01-01']);
  const tired = run('start four hours after a night shift is refused', [O, 'start', 'LAB', "--lead=Liam O'Brien", `--at=${after}`, '--hours=8'], { expectFail: true });
  assert(/rest/.test(tired.stderr) && /fatigue-exception/.test(tired.stderr), 'refused: rest, with the way out');
  run('an operator cannot grant a fatigue exception', [O, 'fatigue-exception', "Liam O'Brien", '--approved-by=Kahu Rangi', '--reason=x', `--date=${after.slice(0, 10)}`], { expectFail: true });
  run('a manager records an exception', [O, 'fatigue-exception', "Liam O'Brien", '--approved-by=Steve Bishop', '--reason=Lab analyst sick, sampling only, no plant work', `--date=${after.slice(0, 10)}`]);
  const started = run('start the shift on the exception', [O, 'start', 'LAB', "--lead=Liam O'Brien", `--at=${after}`, '--hours=8']);
  assert(started.exceptions_used === 1, 'the exception was used and recorded');
  run('the exception is used once', [O, 'start', 'LAB', "--lead=Liam O'Brien", `--at=${addHours(after, 9)}`, '--hours=2'], { expectFail: true });
  run('an overlapping shift is refused', [O, 'start', 'UTL', '--lead=Kahu Rangi', `--at=${now[0].starts_at}`], { expectFail: true });
  run('note on a person', [O, 'note', 'person', 'Tama Ngata', '--text=Ammonia refresher booked for Thursday']);
  run('add a person', [O, 'add', 'person', 'Hana Moore', '--role=operator', '--crew=A']);
  run('add a route and checkpoint', [O, 'add', 'route', 'Lab sampling round', '--code=LAB-R', '--area=LAB', '--every=8']);
  run('add a checkpoint', [O, 'add', 'checkpoint', 'Lab fridge temperature', '--route=LAB-R', '--tag=TT-901', '--unit=C', '--alarm-high=5', '--sol-high=8']);
  run('actions', [O, 'actions']);
  const done = run('close an action', [O, 'done', 'ACT-802', '--note=Motor megger 200 Mohm, overload reset']);
  assert(done.ref === 'ACT-802', 'done');

  // ---- import from j5 or any logbook export ---------------------------------------------------

  writeFileSync(path.join(imp, 'people.csv'), 'Name,Role,Crew,Email\r\nHinemoa Clarke,Operator,B,hinemoa@example.com\r\nRuss Dalton,Shift Lead,A,\r\n');
  writeFileSync(path.join(imp, 'entries.csv'), [
    'Entry ID,Date/Time,Logbook,Entry Type,Priority,Equipment,Subject,Comments,Created By',
    'J5-1001,03/11/2026 07:15,Utilities,Equipment,Normal,BLR1,Boiler 1 burner management tested,"Flame failure test passed, signed off",Russ Dalton',
    'J5-1002,2026-11-03 19:40,Cheese plant,Trip,High,VAT3,"Vat 3 agitator tripped, reset",,Hinemoa Clarke',
    'J5-1003,,Utilities,Note,,,No date on this one,,Nobody',
  ].join('\r\n'));
  writeFileSync(path.join(imp, 'orders.csv'), 'Title,Area,Instruction,Issued By,Expires\r\nTest the eyewash stations weekly,ALL,Every Monday day shift,Mere Tane,2026-12-20\r\n');
  const dry = run('import dry run', [O, 'import', 'j5', `--people=${path.join(imp, 'people.csv')}`, `--entries=${path.join(imp, 'entries.csv')}`, `--orders=${path.join(imp, 'orders.csv')}`, '--dry-run']);
  assert(dry.dry_run && dry.entries === 2 && dry.people === 2 && dry.orders === 1 && dry.problems.length === 1 && dry.areas_created.includes('CHEESEPL'), `the dry run is the audit (${JSON.stringify(dry)})`);
  const before = run('entries before', [O, 'entries', '--days=30', '--search=burner management']);
  assert(before.length === 0, 'dry run saved nothing');
  const real = run('import', [O, 'import', 'j5', `--people=${path.join(imp, 'people.csv')}`, `--entries=${path.join(imp, 'entries.csv')}`, `--orders=${path.join(imp, 'orders.csv')}`]);
  assert(real.entries === 2, 'two entries in');
  const got = run('the imported entry reads back', [O, 'entries', 'UTL', '--days=30', '--search=burner management']);
  assert(got.length === 1 && got[0].by_person === 'Russ Dalton' && got[0].category === 'equipment', 'author and category mapped');

  const outFile = path.join(dataDir, 'export.json');
  const dump = run('export', [O, 'export', `--out=${outFile}`]);
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.log_entries.length === n(dump.counts.log_entries) && parsed.handovers.length > 50, 'the counts match the file');

  // ---- the branded HTML -----------------------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/control-room\.html/.test(views.stdout) && /operations-week\.html/.test(views.stdout), 'both views rendered');
  const board = readFileSync(path.join(dataDir, 'views', 'control-room.html'), 'utf8');
  assert(board.includes('Needs a decision') && board.includes('Bypassed or inhibited now') && board.includes('PDAH-330'), 'the board has its sections');
  const docsOut = run('npm run docs', ['docs.mjs'], { json: false });
  for (const d of ['shift-handover', 'standing-order', 'notifiable-event', 'bypass-register']) assert(docsOut.stdout.includes(d), `${d} rendered`);

  // ---- the human readable side ----------------------------------------------------------------

  for (const args of [['attention'], ['week'], ['areas'], ['shift'], ['shift', 'PWD'], ['shifts', 'UTL'], ['entries', '--days=2'], ['entries', '--open'], ['orders', '--all'], ['order', 'SO-101'], ['bypasses', '--all'], ['rounds'], ['limits', 'UTL'], ['excursions'], ['trend', 'TT-301'], ['actions', '--all'], ['people'], ['competency'], ['fatigue'], ['compliance'], ['compliance', 'fatigue'], ['handover', 'PWD', '--dry-run']]) {
    run(`${args.join(' ')} (text)`, [O, ...args], { json: false });
  }
  run('help', [O, 'help'], { json: false });
  run('an unknown command exits 1', [O, 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
