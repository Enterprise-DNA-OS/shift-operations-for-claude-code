#!/usr/bin/env node
// shift-operations-for-claude-code: the one CLI. Claude Code slash commands
// call this; so can you.
//
//   node scripts/ops.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is a process plant's operations record: the operating areas, the
// people and their sign-offs, the shifts, the logbook, the handover at every
// shift change, the standing orders and who has read them, the safety
// functions bypassed or inhibited right now, the operator rounds and their
// readings against limits, and the actions that come out of them.
//
// The sharp edges are deliberate. A shift cannot start with someone who is not
// signed off for the area, or who is past the fatigue limits without a
// manager's recorded exception. A handover cannot be accepted by someone who
// has not acknowledged the standing orders in force on that area. A
// safety-critical bypass cannot be applied without a second person's
// authority, for longer than one authority period, or extended a second time
// without a risk assessment. A standing order cannot be issued without an
// expiry. There is no force flag. Nothing here connects to a control system,
// a historian or a regulator, and nothing sends.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick, yesNo } from './lib/csv.mjs';
import { table, short, heading, truncate } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Arguments

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'carry', 'injury', 'notifiable', 'safety-critical', 'open', 'not-face-to-face']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name, value;
      if (eq > -1) { name = a.slice(2, eq); value = a.slice(eq + 1); }
      else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else args.push(a);
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));
const ts = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');
const day = (v) => (v ? String(v).slice(0, 10) : '');

function need(flags, name, what) {
  const v = str(flags[name]);
  if (!v) throw new CliError(`Missing --${name}${what ? ` (${what})` : ''}.`);
  return v;
}

// "2026-11-15 14:30", "14:30" (today at the plant), "now", or a date.
async function at(db, v) {
  const s = str(v).trim();
  const [{ now }] = await db.query('select plant_now()::text as now');
  if (!s || s.toLowerCase() === 'now') return now.slice(0, 16);
  const rel = { today: 0, tomorrow: 1, yesterday: -1 }[s.toLowerCase()];
  if (rel !== undefined) { const [{ d }] = await db.query("select to_char(plant_now()::date + $1::int, 'YYYY-MM-DD') as d", [rel]); return d; }
  if (/^\d{1,2}:\d{2}$/.test(s)) return `${now.slice(0, 10)} ${s.padStart(5, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2})?$/.test(s)) return s.replace('T', ' ');
  throw new CliError(`"${s}" is not a time. Use "YYYY-MM-DD HH:MM", "HH:MM" or "now".`);
}

async function plantNow(db) {
  const [{ now }] = await db.query('select plant_now()::text as now');
  return now.slice(0, 16);
}

async function setting(db, key, dflt) {
  const [r] = await db.query('select value from settings where key = $1', [key]);
  return r ? r.value : dflt;
}

// ---------------------------------------------------------------------------
// Lookups: id prefix, exact ref or name, then every word contained. One hit
// wins; several list the candidates and exit 1.

const RESOLVERS = {
  area: {
    from: 'areas a', cols: 'a.*',
    exact: 'lower(a.code) = lower($1) or lower(a.name) = lower($1)',
    haystack: "a.code || ' ' || a.name || ' ' || coalesce(a.description, '')",
    label: (r) => `${r.code} ${r.name}`, order: 'a.code', listing: 'areas',
  },
  person: {
    from: 'people p', cols: 'p.*',
    exact: 'lower(p.name) = lower($1) or lower(coalesce(p.external_ref, \'\')) = lower($1)',
    haystack: "p.name || ' ' || p.role || ' ' || coalesce(p.crew, '')",
    label: (r) => `${r.name} (${r.role}${r.crew ? `, crew ${r.crew}` : ''})`, order: 'p.name', listing: 'people',
  },
  shift: {
    from: 'shifts s join areas a on a.id = s.area_id join people l on l.id = s.lead_id', cols: 's.*, a.code as area, l.name as lead',
    exact: "lower(s.ref) = lower($1) or lower(s.ref) = lower('SH-' || $1)",
    haystack: "s.ref || ' ' || a.code || ' ' || l.name",
    label: (r) => `${r.ref} ${r.area} ${r.kind} ${ts(r.starts_at)} (${r.lead})`, order: 's.starts_at desc', listing: 'shifts',
  },
  entry: {
    from: 'log_entries e join areas a on a.id = e.area_id', cols: 'e.*, a.code as area',
    exact: "lower(e.ref) = lower($1) or lower(e.ref) = lower('LOG-' || $1)",
    haystack: "e.ref || ' ' || e.title || ' ' || coalesce(e.equipment_tag, '')",
    label: (r) => `${r.ref} ${ts(r.logged_at)} ${truncate(r.title, 50)}`, order: 'e.logged_at desc', listing: 'entries',
  },
  order: {
    from: 'standing_orders so left join areas a on a.id = so.area_id', cols: "so.*, coalesce(a.code, 'ALL') as area",
    exact: "lower(so.ref) = lower($1) or lower(so.ref) = lower('SO-' || $1)",
    haystack: "so.ref || ' ' || so.title",
    label: (r) => `${r.ref} ${r.area} ${truncate(r.title, 50)} (${r.status})`, order: 'so.effective_from desc', listing: 'orders --all',
  },
  bypass: {
    from: 'bypasses b join areas a on a.id = b.area_id', cols: 'b.*, a.code as area',
    exact: "lower(b.ref) = lower($1) or lower(b.ref) = lower('BYP-' || $1) or (lower(b.tag) = lower($1) and b.removed_at is null)",
    haystack: "b.ref || ' ' || b.tag || ' ' || b.description",
    label: (r) => `${r.ref} ${r.tag} ${truncate(r.description, 40)} (${r.removed_at ? 'removed' : 'active'})`, order: 'b.applied_at desc', listing: 'bypasses --all',
  },
  round: {
    from: 'rounds r join round_routes rr on rr.id = r.route_id', cols: 'r.*, rr.code as route, rr.area_id',
    exact: "lower(r.ref) = lower($1) or lower(r.ref) = lower('RND-' || $1)",
    haystack: "r.ref || ' ' || rr.code",
    label: (r) => `${r.ref} ${r.route} due ${ts(r.due_at)}`, order: 'r.due_at desc', listing: 'rounds',
  },
  route: {
    from: 'round_routes rr join areas a on a.id = rr.area_id', cols: 'rr.*, a.code as area',
    exact: 'lower(rr.code) = lower($1) or lower(rr.name) = lower($1)',
    haystack: "rr.code || ' ' || rr.name",
    label: (r) => `${r.code} ${r.name}`, order: 'rr.code', listing: 'rounds',
  },
  checkpoint: {
    from: 'checkpoints c', cols: 'c.*',
    exact: 'lower(c.tag) = lower($1)',
    haystack: "c.tag || ' ' || c.description",
    label: (r) => `${r.tag} ${r.description}`, order: 'c.tag', listing: 'limits',
  },
  action: {
    from: 'actions ac', cols: 'ac.*',
    exact: "lower(ac.ref) = lower($1) or lower(ac.ref) = lower('ACT-' || $1)",
    haystack: "ac.ref || ' ' || ac.title",
    label: (r) => `${r.ref} ${truncate(r.title, 50)} (${r.status})`, order: 'ac.due_on', listing: 'actions --all',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, reference or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  const alias = spec.from.split(' ')[1];
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where ${alias}.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    const words = q.split(/[\s/]+/).filter(Boolean);
    const where = words.map((_, i) => `(${spec.haystack}) ilike $${i + 1}`).join(' and ');
    rows = await db.query(`${select} where ${where} order by ${spec.order}`, words.map((w) => `%${w}%`));
  }
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(`"${q}" matches ${rows.length} ${kind} records. Use a reference, an id, or more words:\n` +
    rows.slice(0, 15).map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'));
}

async function nextRef(db, prefix, tableName, start) {
  const [r] = await db.query(
    `select coalesce(max(substring(ref from ${prefix.length + 2})::int), ${start}) + 1 as n from ${tableName} where ref ~ '^${prefix}-[0-9]+$'`);
  return `${prefix}-${r.n}`;
}

async function note(db, kind, id, label, body) {
  await db.query('insert into notes (target_kind, target_id, target_label, body) values ($1, $2, $3, $4)', [kind, id, label, body]);
}

async function syncShifts(db) {
  await db.query(`update shifts set status = case when ends_at <= plant_now() then 'closed' when starts_at <= plant_now() then 'open' else 'planned' end
    where status <> case when ends_at <= plant_now() then 'closed' when starts_at <= plant_now() then 'open' else 'planned' end`);
}

const SUPERVISORY = ['shift_lead', 'supervisor', 'manager', 'engineer'];
const AUTHORISERS = ['supervisor', 'manager', 'engineer'];

// ---------------------------------------------------------------------------
// Reads

const ATTN_LABEL = {
  notifiable: 'Notifiable event, regulator not told', bypass_overdue: 'Bypass past its authority', sol_excursion: 'Outside safe operating limit',
  handover_open: 'Handover open', competency: 'Worked without a sign-off', fatigue: 'Fatigue limit passed', round_missed: 'Round missed',
  unexplained: 'Alarm excursion not logged', unacked: 'Standing order not acknowledged', order_expired: 'Standing order expired', action_overdue: 'Action overdue',
};

async function cmdAttention(db) {
  const rows = await db.query('select * from v_attention order by rank, since');
  const json = rows.map((r) => ({ ...r, what: ATTN_LABEL[r.reason] || r.reason }));
  const text = heading(`Needs a decision (${rows.length})`) + '\n' + (rows.length
    ? table(json, [{ key: 'rank', label: '#', align: 'right' }, { key: 'what', label: 'what' }, { key: 'area', label: 'area' }, { key: 'label', label: 'record' }, { key: 'detail', label: 'detail', width: 110 }])
    : '  Nothing. The plant record is clean.');
  return { json, text };
}

async function cmdAreas(db) {
  const rows = await db.query(`select a.code, a.name, a.hazard_notes,
      (select s.ref || ' ' || l.name from shifts s join people l on l.id = s.lead_id where s.area_id = a.id and s.status = 'open' limit 1) as on_shift,
      (select count(*) from bypasses b where b.area_id = a.id and b.removed_at is null) as bypasses,
      (select count(*) from standing_orders so where (so.area_id = a.id or so.area_id is null) and so.status = 'active') as orders
    from areas a where a.status <> 'archived' order by a.code`);
  return { json: rows, text: heading('Areas') + '\n' + table(rows, [{ key: 'code', label: 'area' }, { key: 'name', label: 'name' }, { key: 'on_shift', label: 'on shift now' }, { key: 'bypasses', label: 'bypasses', align: 'right' }, { key: 'orders', label: 'orders', align: 'right' }, { key: 'hazard_notes', label: 'hazards', width: 50 }]) };
}

async function shiftCard(db, s) {
  const crew = await db.query(`select p.name, coalesce(sp.position, 'lead') as position from shift_people sp join people p on p.id = sp.person_id where sp.shift_id = $1 and sp.person_id <> $2
    union select p.name, 'lead' from people p where p.id = $2 order by 2, 1`, [s.id, s.lead_id]);
  const entries = await db.query(`select ref, logged_at, category, priority, equipment_tag, title, by_person, carry_forward, closed_at from v_entries where shift = $1 order by logged_at`, [s.ref]);
  const [h] = await db.query('select * from v_shifts where id = $1', [s.id]);
  const rounds = await db.query(`select ref, route, due_at, state, readings, checkpoints from v_rounds where area_id = $1 and due_at >= $2 and due_at < $3 order by due_at`, [s.area_id, s.starts_at, s.ends_at]);
  return { shift: { ref: s.ref, area: s.area, kind: s.kind, crew: s.crew, starts_at: s.starts_at, ends_at: s.ends_at, lead: s.lead, status: s.status, handover: h.handover, given_by: h.given_by, accepted_by: h.accepted_by, accepted_at: h.accepted_at }, people: crew, entries, rounds };
}

async function cmdShift(db, args) {
  let s;
  const q = args.join(' ');
  const area = q ? await resolve(db, 'area', q, { optional: true }) : null;
  if (area) {
    [s] = await db.query(`select s.*, a.code as area, l.name as lead from shifts s join areas a on a.id = s.area_id join people l on l.id = s.lead_id
      where s.area_id = $1 and s.starts_at <= plant_now() order by s.starts_at desc limit 1`, [area.id]);
    if (!s) throw new CliError(`No shift has started on ${area.code}.`);
  } else if (q) s = await resolve(db, 'shift', q);
  else {
    const open = await db.query(`select s.ref, a.code as area, s.kind, s.crew, l.name as lead, s.starts_at, s.ends_at from shifts s join areas a on a.id = s.area_id join people l on l.id = s.lead_id where s.status = 'open' order by a.code`);
    return { json: open, text: heading('On shift now') + '\n' + table(open, [{ key: 'area', label: 'area' }, { key: 'ref', label: 'shift' }, { key: 'kind', label: 'kind' }, { key: 'crew', label: 'crew' }, { key: 'lead', label: 'lead' }, { key: 'starts_at', label: 'from', format: ts }, { key: 'ends_at', label: 'to', format: ts }]) };
  }
  const card = await shiftCard(db, s);
  const sh = card.shift;
  const text = [
    heading(`${sh.ref}  ${sh.area} ${sh.kind} shift, crew ${sh.crew || '-'}`),
    `  ${ts(sh.starts_at)} to ${ts(sh.ends_at)}   lead ${sh.lead}   ${sh.status}   handover: ${sh.handover}${sh.accepted_by ? ` (accepted by ${sh.accepted_by} ${ts(sh.accepted_at)})` : ''}`,
    `  On shift: ${card.people.map((p) => `${p.name} (${p.position})`).join(', ')}`,
    heading('Logbook'), table(card.entries, [{ key: 'ref', label: 'entry' }, { key: 'logged_at', label: 'time', format: (v) => ts(v).slice(11) }, { key: 'category', label: 'category' }, { key: 'priority', label: 'pri' }, { key: 'equipment_tag', label: 'tag' }, { key: 'title', label: 'entry', width: 80 }, { key: 'by_person', label: 'by' }]),
    heading('Rounds'), table(card.rounds, [{ key: 'ref', label: 'round' }, { key: 'route', label: 'route' }, { key: 'due_at', label: 'due', format: (v) => ts(v).slice(11) }, { key: 'state', label: 'state' }, { key: 'readings', label: 'readings', align: 'right', format: (v, r) => `${v}/${r.checkpoints}` }]),
  ].join('\n');
  return { json: card, text };
}

async function cmdShifts(db, args, flags) {
  const days = num(flags.days || 3);
  const params = [days];
  let where = "ends_at > plant_now() - make_interval(days => $1::int) and starts_at <= plant_now() + interval '12 hours'";
  if (args.length) { const a = await resolve(db, 'area', args.join(' ')); params.push(a.id); where += ` and area_id = $${params.length}`; }
  const rows = await db.query(`select ref, area, kind, crew, lead, starts_at, ends_at, status, handover, given_by, accepted_by, entries from v_shifts where ${where} order by starts_at desc, area`, params);
  return { json: rows, text: heading(`Shifts, last ${days} days`) + '\n' + table(rows, [{ key: 'ref', label: 'shift' }, { key: 'area', label: 'area' }, { key: 'kind', label: 'kind' }, { key: 'crew', label: 'crew' }, { key: 'lead', label: 'lead' }, { key: 'starts_at', label: 'from', format: ts }, { key: 'status', label: 'status' }, { key: 'handover', label: 'handover' }, { key: 'accepted_by', label: 'accepted by' }, { key: 'entries', label: 'entries', align: 'right' }]) };
}

const ENTRY_COLS = [
  { key: 'ref', label: 'entry' }, { key: 'logged_at', label: 'time', format: ts }, { key: 'area', label: 'area' }, { key: 'category', label: 'category' },
  { key: 'priority', label: 'pri' }, { key: 'equipment_tag', label: 'tag' }, { key: 'title', label: 'entry', width: 90 }, { key: 'by_person', label: 'by' },
  { key: 'open_carry', label: 'carry', format: (v) => (v ? 'OPEN' : '') },
];

async function cmdEntries(db, args, flags) {
  const params = [];
  const where = [];
  if (flags.open) where.push('open_carry');
  else { params.push(num(flags.days || 1)); where.push(`logged_at > plant_now() - make_interval(days => $${params.length}::int)`); }
  if (args.length) { const a = await resolve(db, 'area', args.join(' ')); params.push(a.id); where.push(`area_id = $${params.length}`); }
  if (flags.category) { params.push(str(flags.category)); where.push(`category = $${params.length}`); }
  if (flags.tag) { params.push(`%${str(flags.tag)}%`); where.push(`equipment_tag ilike $${params.length}`); }
  if (flags.search) { params.push(`%${str(flags.search)}%`); where.push(`(title || ' ' || coalesce(body, '')) ilike $${params.length}`); }
  const rows = await db.query(`select * from v_entries where ${where.join(' and ')} order by logged_at desc limit ${num(flags.limit || 200)}`, params);
  return { json: rows, text: heading(`Logbook (${rows.length})`) + '\n' + table(rows, ENTRY_COLS) };
}

async function cmdEntryCard(db, args) {
  const e = await resolve(db, 'entry', args.join(' '));
  const [row] = await db.query('select * from v_entries where id = $1', [e.id]);
  const acts = await db.query('select ref, title, owner, due_on, status from v_actions where from_entry = $1', [e.ref]);
  const reads = await db.query('select tag, value, unit, band, recorded_at from v_readings where log_entry_id = $1', [e.id]);
  const notes = await db.query("select created_at, body from notes where target_kind = 'entry' and target_id = $1 order by created_at", [e.id]);
  const text = [heading(`${row.ref}  ${row.area}  ${ts(row.logged_at)}  ${row.category}/${row.priority}`), `  ${row.title}`, row.body ? `  ${row.body}` : '',
    `  by ${row.by_person || '-'} on ${row.shift || '-'}${row.carry_forward ? `   carry forward: ${row.closed_at ? `closed ${ts(row.closed_at)}` : 'OPEN'}` : ''}`,
    row.notifiable ? `  NOTIFIABLE: ${row.notified_at ? `notified ${ts(row.notified_at)} (${row.regulator_ref || 'no reference'})` : 'regulator not yet told'}` : '',
    acts.length ? heading('Actions') + '\n' + table(acts, [{ key: 'ref', label: 'action' }, { key: 'title', label: 'title' }, { key: 'owner', label: 'owner' }, { key: 'due_on', label: 'due', format: day }, { key: 'status', label: 'status' }]) : '',
    reads.length ? heading('Readings it explains') + '\n' + table(reads, [{ key: 'tag', label: 'tag' }, { key: 'value', label: 'value' }, { key: 'unit', label: 'unit' }, { key: 'band', label: 'band' }, { key: 'recorded_at', label: 'at', format: ts }]) : '',
    notes.length ? heading('Notes') + '\n' + notes.map((n) => `  ${String(n.created_at).slice(0, 16)}  ${n.body}`).join('\n') : '',
  ].filter(Boolean).join('\n');
  return { json: { ...row, actions: acts, readings: reads, notes }, text };
}

// ---------------------------------------------------------------------------
// Logbook writes

async function currentShift(db, areaId, when) {
  const [s] = await db.query('select * from shifts where area_id = $1 and starts_at <= $2 and ends_at > $2 order by starts_at desc limit 1', [areaId, when]);
  return s || null;
}

async function cmdEntry(db, args, flags) {
  const title = args.join(' ').trim();
  if (!title) throw new CliError('Give the entry text: entry "Boiler 2 relit on pump A" --area=UTL --by="Kahu Rangi"');
  const area = await resolve(db, 'area', need(flags, 'area', 'which area this is about'));
  const when = await at(db, flags.at);
  const shift = await currentShift(db, area.id, when);
  const person = flags.by ? await resolve(db, 'person', flags.by) : null;
  const category = str(flags.category) || 'note';
  const CATS = ['event', 'alarm', 'trip', 'equipment', 'process', 'safety', 'environmental', 'quality', 'instruction', 'note'];
  if (!CATS.includes(category)) throw new CliError(`--category is one of ${CATS.join(', ')}.`);
  if (flags.priority && !['low', 'normal', 'high'].includes(str(flags.priority))) throw new CliError('--priority is low, normal or high.');
  const priority = str(flags.priority) || (flags.injury || flags.notifiable ? 'high' : 'normal');
  const owner = flags.action && flags.owner ? await resolve(db, 'person', flags.owner) : null;
  const due = flags.action && flags.due ? day(await at(db, flags.due)) : null;
  const ref = await nextRef(db, 'LOG', 'log_entries', 20000);
  const [row] = await db.query(`insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title, body, carry_forward, injury, notifiable)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
  [ref, area.id, shift?.id || null, person?.id || null, when, category, priority, str(flags.tag) || null, title, str(flags.body) || null,
    !!flags.carry || !!flags.notifiable, !!flags.injury, !!flags.notifiable]);
  let action = null;
  if (flags.action) {
    const aref = await nextRef(db, 'ACT', 'actions', 800);
    [action] = await db.query('insert into actions (ref, log_entry_id, area_id, title, owner_id, due_on) values ($1,$2,$3,$4,$5,$6) returning ref, title, due_on',
      [aref, row.id, area.id, str(flags.action), owner?.id || null, due]);
  }
  const warn = [];
  if (!shift) warn.push(`No shift is recorded on ${area.code} at ${when}; the entry is not tied to a shift.`);
  if (flags.notifiable) warn.push('Marked notifiable: tell the regulator as soon as possible and record it with `notified ' + ref + ' --ref=`. Preserve the site until the regulator says otherwise. Draft the notification with /draft-regulator-notice.');
  return { json: { entry: row, action, warnings: warn }, text: `  ${ref} logged on ${area.code}${shift ? ` (${shift.ref})` : ''} at ${when}${action ? `, action ${action.ref}` : ''}.${warn.length ? '\n  ' + warn.join('\n  ') : ''}` };
}

async function cmdClose(db, args, flags) {
  const e = await resolve(db, 'entry', args.join(' '));
  if (e.closed_at) throw new CliError(`${e.ref} was closed ${ts(e.closed_at)}.`);
  if (e.notifiable && !e.notified_at) throw new CliError(`${e.ref} is a notifiable event and the regulator has not been recorded as told. Record it first: notified ${e.ref} --ref=`);
  const when = await at(db, flags.at);
  await db.query('update log_entries set closed_at = $2 where id = $1', [e.id, when]);
  if (flags.note) await note(db, 'entry', e.id, e.ref, `Closed: ${str(flags.note)}`);
  return { json: { ref: e.ref, closed_at: when }, text: `  ${e.ref} closed at ${when}. It drops off the next handover.` };
}

async function cmdNotified(db, args, flags) {
  const e = await resolve(db, 'entry', args.join(' '));
  if (!e.notifiable) throw new CliError(`${e.ref} is not marked notifiable. Mark it with --notifiable when logging, or ask before changing the record.`);
  const ref = need(flags, 'ref', "the regulator's reference or the name of the person you spoke to");
  const when = await at(db, flags.at);
  await db.query('update log_entries set notified_at = $2, regulator_ref = $3, site_preserved_until = $4 where id = $1', [e.id, when, ref, flags['preserve-until'] ? await at(db, flags['preserve-until']) : null]);
  return { json: { ref: e.ref, notified_at: when, regulator_ref: ref }, text: `  ${e.ref}: regulator told at ${when} (${ref}).` };
}

async function cmdActions(db, args, flags) {
  const rows = await db.query(`select * from v_actions where ${flags.all ? 'true' : "status = 'open'"} order by overdue desc, due_on nulls last`);
  return { json: rows, text: heading('Actions') + '\n' + table(rows, [{ key: 'ref', label: 'action' }, { key: 'area', label: 'area' }, { key: 'title', label: 'title', width: 70 }, { key: 'owner', label: 'owner' }, { key: 'due_on', label: 'due', format: day }, { key: 'status', label: 'status', format: (v, r) => (r.overdue ? 'OVERDUE' : v) }, { key: 'from_entry', label: 'from' }]) };
}

async function cmdDone(db, args, flags) {
  const a = await resolve(db, 'action', args.join(' '));
  if (a.status !== 'open') throw new CliError(`${a.ref} is ${a.status}.`);
  const when = await at(db, flags.at);
  await db.query("update actions set status = 'done', done_at = $2, done_note = $3 where id = $1", [a.id, when, str(flags.note) || null]);
  return { json: { ref: a.ref, done_at: when }, text: `  ${a.ref} done.` };
}

// ---------------------------------------------------------------------------
// Handover

async function handoverPack(db, s) {
  const carry = await db.query('select ref, logged_at, category, priority, equipment_tag, title from v_entries where area_id = $1 and open_carry and logged_at <= $2 order by logged_at', [s.area_id, s.ends_at]);
  const high = await db.query("select ref, logged_at, category, equipment_tag, title from v_entries where shift = $1 and (priority = 'high' or category in ('trip', 'safety', 'environmental')) and not open_carry order by logged_at", [s.ref]);
  const bypasses = await db.query('select ref, tag, kind, safety_critical, description, authorised_until, overdue from v_bypasses where area_id = $1 and active order by applied_at', [s.area_id]);
  const orders = await db.query('select ref, area, title, expires_on, expired from v_standing_orders where status = $2 and (area_id = $1 or area_id is null) order by ref', [s.area_id, 'active']);
  const rounds = await db.query("select ref, route, due_at, state from v_rounds where area_id = $1 and due_at >= $2 and due_at < $3 and state in ('missed', 'late', 'due') order by due_at", [s.area_id, s.starts_at, s.ends_at]);
  const excursions = await db.query('select tag, value, unit, band, recorded_at, explained_by from v_excursions where area_id = $1 and recorded_at >= $2 and recorded_at < $3 order by recorded_at', [s.area_id, s.starts_at, s.ends_at]);
  const actions = await db.query("select ref, title, owner, due_on, overdue from v_actions where area = $1 and status = 'open' and (overdue or due_on <= plant_now()::date + 2) order by due_on", [s.area]);
  return { carry_forward: carry, this_shift: high, bypasses, standing_orders: orders, rounds, excursions, actions };
}

function packText(pack) {
  const sec = (t, rows, cols) => heading(`${t} (${rows.length})`) + '\n' + table(rows, cols);
  return [
    sec('Carried forward', pack.carry_forward, [{ key: 'ref', label: 'entry' }, { key: 'logged_at', label: 'logged', format: ts }, { key: 'equipment_tag', label: 'tag' }, { key: 'title', label: 'entry', width: 90 }]),
    sec('This shift: trips, safety, high priority', pack.this_shift, [{ key: 'ref', label: 'entry' }, { key: 'logged_at', label: 'time', format: (v) => ts(v).slice(11) }, { key: 'category', label: 'category' }, { key: 'title', label: 'entry', width: 90 }]),
    sec('Bypassed or inhibited now', pack.bypasses, [{ key: 'ref', label: 'bypass' }, { key: 'tag', label: 'tag' }, { key: 'kind', label: 'kind' }, { key: 'safety_critical', label: 'SC', format: (v) => (v ? 'yes' : '') }, { key: 'description', label: 'what', width: 50 }, { key: 'authorised_until', label: 'until', format: (v, r) => `${ts(v)}${r.overdue ? ' OVERDUE' : ''}` }]),
    sec('Standing orders in force', pack.standing_orders, [{ key: 'ref', label: 'order' }, { key: 'area', label: 'area' }, { key: 'title', label: 'title', width: 80 }, { key: 'expires_on', label: 'expires', format: (v, r) => `${day(v)}${r.expired ? ' EXPIRED' : ''}` }]),
    sec('Rounds not done on time', pack.rounds, [{ key: 'ref', label: 'round' }, { key: 'route', label: 'route' }, { key: 'due_at', label: 'due', format: ts }, { key: 'state', label: 'state' }]),
    sec('Readings outside limits', pack.excursions, [{ key: 'tag', label: 'tag' }, { key: 'value', label: 'value' }, { key: 'unit', label: 'unit' }, { key: 'band', label: 'band', format: (v) => (v === 'sol' ? 'SAFE LIMIT' : 'alarm') }, { key: 'recorded_at', label: 'at', format: ts }, { key: 'explained_by', label: 'logged', format: (v) => v || 'NOT LOGGED' }]),
    sec('Actions due', pack.actions, [{ key: 'ref', label: 'action' }, { key: 'title', label: 'title', width: 70 }, { key: 'owner', label: 'owner' }, { key: 'due_on', label: 'due', format: (v, r) => `${day(v)}${r.overdue ? ' OVERDUE' : ''}` }]),
  ].join('\n');
}

async function handoverShift(db, q) {
  const area = await resolve(db, 'area', q, { optional: true });
  if (!area) return resolve(db, 'shift', q);
  // The open shift, or the latest ended shift with no handover yet.
  const [s] = await db.query(`select s.*, a.code as area, l.name as lead from shifts s join areas a on a.id = s.area_id join people l on l.id = s.lead_id
    left join handovers h on h.shift_id = s.id
    where s.area_id = $1 and s.starts_at <= plant_now() and (h.id is null) order by s.starts_at desc limit 1`, [area.id]);
  if (!s) throw new CliError(`Every started shift on ${area.code} has a handover. Accept the last one with \`accept ${area.code} --by=\`.`);
  return s;
}

async function cmdHandover(db, args, flags) {
  const s = await handoverShift(db, args.join(' '));
  const [existing] = await db.query('select * from handovers where shift_id = $1', [s.id]);
  const pack = await handoverPack(db, s);
  const counts = Object.fromEntries(Object.entries(pack).map(([k, v]) => [k, v.length]));
  const head = heading(`Handover ${s.ref}  ${s.area} ${s.kind} shift ending ${ts(s.ends_at)}, lead ${s.lead}`);
  if (flags['dry-run'] || existing) {
    const msg = existing ? `\n  Already given by the lead at ${ts(existing.given_at)}${existing.accepted_at ? `, accepted ${ts(existing.accepted_at)}` : ', NOT accepted yet'}. This is the pack as it stands now.` : '\n  Dry run: nothing recorded.';
    return { json: { shift: s.ref, area: s.area, dry_run: true, already_given: !!existing, pack, counts }, text: head + msg + '\n' + packText(pack) };
  }
  const by = flags.by ? await resolve(db, 'person', flags.by) : { id: s.lead_id, name: s.lead };
  const when = await at(db, flags.at);
  const items = {
    carry_forward: pack.carry_forward.map((r) => r.ref), bypasses: pack.bypasses.map((r) => r.ref), standing_orders: pack.standing_orders.map((r) => r.ref),
    rounds: pack.rounds.map((r) => r.ref), excursions: pack.excursions.map((r) => `${r.tag}=${r.value}`), actions: pack.actions.map((r) => r.ref), this_shift: pack.this_shift.map((r) => r.ref),
  };
  const [next] = await db.query('select id from shifts where area_id = $1 and starts_at = $2 limit 1', [s.area_id, s.ends_at]);
  await db.query('insert into handovers (shift_id, given_by, given_at, summary, items, incoming_shift_id, face_to_face) values ($1,$2,$3,$4,$5,$6,$7)',
    [s.id, by.id, when, str(flags.summary) || null, JSON.stringify(items), next?.id || null, !flags['not-face-to-face']]);
  return { json: { shift: s.ref, area: s.area, given_by: by.name, given_at: when, items, counts }, text: head + `\n  Given by ${by.name} at ${when}. The incoming lead accepts with \`accept ${s.area} --by=<name>\`.\n` + packText(pack) };
}

async function cmdAccept(db, args, flags) {
  const q = args.join(' ');
  const area = await resolve(db, 'area', q, { optional: true });
  let h;
  if (area) [h] = await db.query('select h.*, s.ref, s.area_id, s.ends_at from handovers h join shifts s on s.id = h.shift_id where s.area_id = $1 and h.accepted_at is null order by s.ends_at desc limit 1', [area.id]);
  else { const s = await resolve(db, 'shift', q); [h] = await db.query('select h.*, s.ref, s.area_id, s.ends_at from handovers h join shifts s on s.id = h.shift_id where s.id = $1', [s.id]); }
  if (!h) throw new CliError('No handover is waiting to be accepted there. Give it first with `handover <area>`.');
  if (h.accepted_at) throw new CliError(`${h.ref} was accepted at ${ts(h.accepted_at)}.`);
  const [incoming] = await db.query('select s.*, l.name as lead from shifts s join people l on l.id = s.lead_id where s.area_id = $1 and s.starts_at = $2 limit 1', [h.area_id, h.ends_at]);
  const by = flags.by ? await resolve(db, 'person', flags.by) : incoming ? { id: incoming.lead_id, name: incoming.lead } : null;
  if (!by) throw new CliError('Say who is accepting: --by=<incoming lead>.');
  const when = await at(db, flags.at);
  const problems = [];
  const [comp] = await db.query('select * from competencies where person_id = $1 and area_id = $2', [by.id, h.area_id]);
  if (!comp || comp.signed_off_on > when.slice(0, 10) || (comp.expires_on && day(comp.expires_on) < when.slice(0, 10))) problems.push(`${by.name} is not signed off for this area${comp?.expires_on ? ` (lapsed ${day(comp.expires_on)})` : ''}. Renew with \`signoff\`, or have a signed-off lead accept.`);
  const unacked = await db.query(`select so.ref, so.title from standing_orders so where so.status = 'active' and (so.area_id = $1 or so.area_id is null) and so.effective_from <= $3
    and not exists (select 1 from order_acks k where k.standing_order_id = so.id and k.person_id = $2) order by so.ref`, [h.area_id, by.id, when]);
  if (unacked.length) problems.push(`${by.name} has not acknowledged ${unacked.map((u) => `${u.ref} "${u.title}"`).join('; ')}. Read it, then \`ack ${unacked[0].ref} --by="${by.name}"\`.`);
  if (problems.length) throw new CliError(`Handover ${h.ref} not accepted:\n  ${problems.join('\n  ')}`);
  await db.query('update handovers set accepted_by = $2, accepted_at = $3, incoming_shift_id = coalesce(incoming_shift_id, $4) where id = $1', [h.id, by.id, when, incoming?.id || null]);
  const grace = num(await setting(db, 'handover_grace_minutes', 30));
  const late = (new Date(when.replace(' ', 'T')) - new Date(String(h.ends_at).replace(' ', 'T'))) / 60000 > grace;
  return { json: { shift: h.ref, accepted_by: by.name, accepted_at: when, late }, text: `  Handover ${h.ref} accepted by ${by.name} at ${when}${late ? ` (more than ${grace} minutes after shift end: recorded as late)` : ''}.` };
}

// ---------------------------------------------------------------------------
// Standing orders

async function cmdOrders(db, args, flags) {
  const params = [];
  let where = flags.all ? 'true' : "status = 'active'";
  if (args.length) { const a = await resolve(db, 'area', args.join(' ')); params.push(a.id); where += ` and (area_id = $1 or area_id is null)`; }
  const rows = await db.query(`select o.*, (select count(*) from v_unacked u where u.order_id = o.id) as not_acked from v_standing_orders o where ${where} order by ref`, params);
  return { json: rows, text: heading('Standing orders') + '\n' + table(rows, [{ key: 'ref', label: 'order' }, { key: 'area', label: 'area' }, { key: 'title', label: 'title', width: 80 }, { key: 'issued_by', label: 'issued by' }, { key: 'expires_on', label: 'expires', format: (v, r) => `${day(v)}${r.expired ? ' EXPIRED' : ''}` }, { key: 'acks', label: 'read', align: 'right' }, { key: 'not_acked', label: 'not read', align: 'right' }, { key: 'status', label: 'status' }]) };
}

async function cmdOrderCard(db, args) {
  const o = await resolve(db, 'order', args.join(' '));
  const [row] = await db.query('select * from v_standing_orders where id = $1', [o.id]);
  const acks = await db.query('select p.name, k.acked_at from order_acks k join people p on p.id = k.person_id where k.standing_order_id = $1 order by k.acked_at', [o.id]);
  const missing = await db.query('select person, shifts_since, first_shift_since from v_unacked where order_id = $1 order by person', [o.id]);
  const text = [heading(`${row.ref}  ${row.area}  ${row.title}`), `  ${row.instruction}`, `  Issued by ${row.issued_by}${row.approved_by ? `, approved by ${row.approved_by}` : ''}. In force from ${ts(row.effective_from)} to ${day(row.expires_on)}${row.expired ? ' (EXPIRED, still active)' : ''}. ${row.status}.`,
    heading(`Worked the area without reading it (${missing.length})`), table(missing, [{ key: 'person', label: 'person' }, { key: 'shifts_since', label: 'shifts', align: 'right' }, { key: 'first_shift_since', label: 'first shift since', format: ts }]),
    heading(`Acknowledged (${acks.length})`), table(acks, [{ key: 'name', label: 'person' }, { key: 'acked_at', label: 'at', format: ts }])].join('\n');
  return { json: { ...row, acks, not_acked: missing }, text };
}

async function cmdIssue(db, args, flags) {
  const title = args.join(' ').trim();
  if (!title) throw new CliError('Give the order a title: issue "Pump B in hand" --area=UTL --instruction="..." --by= --approved-by= --expires=');
  const instruction = need(flags, 'instruction', 'what the operators must do');
  const area = str(flags.area).toUpperCase() === 'ALL' ? null : await resolve(db, 'area', need(flags, 'area', 'an area code or ALL'));
  const by = await resolve(db, 'person', need(flags, 'by', 'who issues it'));
  const approver = await resolve(db, 'person', need(flags, 'approved-by', 'a supervisor, manager or engineer'));
  if (!SUPERVISORY.includes(by.role)) throw new CliError(`${by.name} is ${by.role}; a standing order is issued by a shift lead, supervisor, manager or engineer.`);
  if (!AUTHORISERS.includes(approver.role)) throw new CliError(`${approver.name} is ${approver.role}; a standing order is approved by a supervisor, manager or engineer.`);
  if (approver.id === by.id) throw new CliError('The person approving a standing order is not the person issuing it.');
  const from = await at(db, flags.from);
  const expires = day(await at(db, need(flags, 'expires', 'every order expires; give a date')));
  const maxDays = num(await setting(db, 'order_max_days', 90));
  const span = (new Date(expires) - new Date(from.slice(0, 10))) / 86400000;
  if (span <= 0) throw new CliError('The expiry is before the order takes effect.');
  if (span > maxDays) throw new CliError(`Standing orders expire within ${maxDays} days (house rule, setting order_max_days). Reissue it when it runs out, or put it in the operating procedure.`);
  const ref = await nextRef(db, 'SO', 'standing_orders', 100);
  await db.query('insert into standing_orders (ref, area_id, title, instruction, issued_by, approved_by, effective_from, expires_on) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [ref, area?.id || null, title, instruction, by.id, approver.id, from, expires]);
  await db.query('insert into order_acks (standing_order_id, person_id, acked_at) select id, $2, $3 from standing_orders where ref = $1 on conflict do nothing', [ref, by.id, from]);
  return { json: { ref, area: area?.code || 'ALL', expires_on: expires }, text: `  ${ref} issued for ${area?.code || 'every area'}, in force to ${expires}. Everyone who works the area must acknowledge it before they accept a handover.` };
}

async function cmdAck(db, args, flags) {
  const o = await resolve(db, 'order', args.join(' '));
  if (o.status !== 'active') throw new CliError(`${o.ref} is ${o.status}.`);
  const names = need(flags, 'by', 'who has read it; several separated by commas').split(',').map((s) => s.trim()).filter(Boolean);
  const when = await at(db, flags.at);
  const done = [];
  for (const n of names) {
    const p = await resolve(db, 'person', n);
    await db.query('insert into order_acks (standing_order_id, person_id, acked_at) values ($1,$2,$3) on conflict do nothing', [o.id, p.id, when]);
    done.push(p.name);
  }
  return { json: { ref: o.ref, acknowledged_by: done, at: when }, text: `  ${o.ref} acknowledged by ${done.join(', ')} at ${when}.` };
}

async function cmdWithdraw(db, args, flags) {
  const o = await resolve(db, 'order', args.join(' '));
  if (o.status !== 'active') throw new CliError(`${o.ref} is already ${o.status}.`);
  const reason = need(flags, 'reason', 'why it no longer applies');
  const when = await at(db, flags.at);
  await db.query("update standing_orders set status = 'withdrawn', withdrawn_at = $2, withdrawn_reason = $3 where id = $1", [o.id, when, reason]);
  return { json: { ref: o.ref, withdrawn_at: when }, text: `  ${o.ref} withdrawn: ${reason}.` };
}

// ---------------------------------------------------------------------------
// Bypasses

const BYPASS_COLS = [
  { key: 'ref', label: 'bypass' }, { key: 'area', label: 'area' }, { key: 'tag', label: 'tag' }, { key: 'kind', label: 'kind' },
  { key: 'safety_critical', label: 'SC', format: (v) => (v ? 'yes' : '') }, { key: 'description', label: 'what', width: 55 },
  { key: 'authorised_by', label: 'authorised' }, { key: 'hours_on', label: 'hours on', align: 'right' },
  { key: 'authorised_until', label: 'until', format: (v, r) => (r.removed_at ? `removed ${ts(r.removed_at)}` : `${ts(v)}${r.overdue ? ' OVERDUE' : ''}`) },
];

async function cmdBypasses(db, args, flags) {
  const rows = await db.query(`select * from v_bypasses where ${flags.all ? `applied_at > plant_now() - make_interval(days => ${num(flags.days || 30)})` : 'active'} order by overdue desc, safety_critical desc, applied_at`);
  return { json: rows, text: heading(flags.all ? 'Bypasses and inhibits' : `Bypassed or inhibited now (${rows.length})`) + '\n' + table(rows, BYPASS_COLS) };
}

async function cmdBypass(db, args, flags) {
  const tag = args.join(' ').trim();
  if (!tag) throw new CliError('Give the tag: bypass PSHH-412 --area=UTL --kind=trip_bypass --description= --reason= --by= --authorised-by= --hours=');
  const area = await resolve(db, 'area', need(flags, 'area'));
  const kind = need(flags, 'kind', 'alarm_inhibit, trip_bypass, interlock_override or forced_signal');
  if (!['alarm_inhibit', 'trip_bypass', 'interlock_override', 'forced_signal'].includes(kind)) throw new CliError('--kind is alarm_inhibit, trip_bypass, interlock_override or forced_signal.');
  const description = need(flags, 'description', 'what the safety function is');
  const reason = need(flags, 'reason', 'why it is being bypassed and what covers the risk meanwhile');
  const by = await resolve(db, 'person', need(flags, 'by', 'who applies it'));
  const auth = await resolve(db, 'person', need(flags, 'authorised-by', 'a supervisor, manager or engineer'));
  const hours = num(need(flags, 'hours', 'how long it is authorised for'));
  const sc = !!flags['safety-critical'] || kind === 'trip_bypass';
  const maxH = num(await setting(db, 'bypass_max_hours', 12));
  if (!(hours > 0)) throw new CliError('--hours must be above zero.');
  if (!AUTHORISERS.includes(auth.role)) throw new CliError(`${auth.name} is ${auth.role}; a bypass is authorised by a supervisor, manager or engineer.`);
  if (sc && auth.id === by.id) throw new CliError('A safety-critical bypass is authorised by someone other than the person applying it.');
  if (sc && hours > maxH) throw new CliError(`A safety-critical bypass is authorised for ${maxH} hours at most (house rule, setting bypass_max_hours). Extend it at the end of each period with \`extend\`.`);
  const [dup] = await db.query('select ref from bypasses where lower(tag) = lower($1) and removed_at is null', [tag]);
  if (dup) throw new CliError(`${tag} is already bypassed under ${dup.ref}.`);
  const when = await at(db, flags.at);
  const ref = await nextRef(db, 'BYP', 'bypasses', 300);
  await db.query(`insert into bypasses (ref, area_id, tag, description, kind, safety_critical, reason, applied_by, authorised_by, applied_at, authorised_until, risk_assessment_ref)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,($10::timestamp + make_interval(mins => $11::int)),$12)`,
  [ref, area.id, tag, description, kind, sc, reason, by.id, auth.id, when, Math.round(hours * 60), str(flags.ra) || null]);
  const shift = await currentShift(db, area.id, when);
  const lref = await nextRef(db, 'LOG', 'log_entries', 20000);
  await db.query(`insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title, carry_forward) values ($1,$2,$3,$4,$5,'equipment',$6,$7,$8,false)`,
    [lref, area.id, shift?.id || null, by.id, when, sc ? 'high' : 'normal', tag, `${ref}: ${tag} ${kind.replace(/_/g, ' ')} applied (${description}), authorised by ${auth.name} for ${hours} h. ${reason}`]);
  return { json: { ref, tag, safety_critical: sc, authorised_for_hours: hours, log_entry: lref }, text: `  ${ref}: ${tag} ${kind.replace(/_/g, ' ')} applied at ${when}, authorised by ${auth.name} for ${hours} h${sc ? ', safety critical' : ''}. Logged as ${lref}; it is on every handover until restored.` };
}

async function cmdExtend(db, args, flags) {
  const b = await resolve(db, 'bypass', args.join(' '));
  if (b.removed_at) throw new CliError(`${b.ref} was removed at ${ts(b.removed_at)}.`);
  const auth = await resolve(db, 'person', need(flags, 'authorised-by'));
  const hours = num(need(flags, 'hours'));
  if (!AUTHORISERS.includes(auth.role)) throw new CliError(`${auth.name} is ${auth.role}; a bypass is authorised by a supervisor, manager or engineer.`);
  const maxH = num(await setting(db, 'bypass_max_hours', 12));
  const freeExt = num(await setting(db, 'bypass_extensions_without_ra', 1));
  const ra = str(flags.ra) || b.risk_assessment_ref;
  if (b.safety_critical && hours > maxH) throw new CliError(`A safety-critical bypass is extended ${maxH} hours at a time at most.`);
  if (b.safety_critical && b.extended_count >= freeExt && !ra) throw new CliError(`${b.ref} has been extended ${b.extended_count} time(s). A further extension needs a risk assessment reference: --ra=<ref>.`);
  const when = await at(db, flags.at);
  const [row] = await db.query(`update bypasses set authorised_until = greatest(authorised_until, $2::timestamp) + make_interval(mins => $3::int), extended_count = extended_count + 1, risk_assessment_ref = $4, authorised_by = $5 where id = $1 returning authorised_until, extended_count`,
    [b.id, when, Math.round(hours * 60), ra || null, auth.id]);
  await note(db, 'bypass', b.id, b.ref, `Extended ${hours} h by ${auth.name} at ${when}${ra ? ` (risk assessment ${ra})` : ''}${b.authorised_until < when ? `; it had been past its authority since ${ts(b.authorised_until)}` : ''}.`);
  return { json: { ref: b.ref, authorised_until: row.authorised_until, extended_count: row.extended_count }, text: `  ${b.ref} authorised until ${ts(row.authorised_until)} (extension ${row.extended_count}).` };
}

async function cmdRestore(db, args, flags) {
  const b = await resolve(db, 'bypass', args.join(' '));
  if (b.removed_at) throw new CliError(`${b.ref} was removed at ${ts(b.removed_at)}.`);
  const by = await resolve(db, 'person', need(flags, 'by', 'who restored the function'));
  const when = await at(db, flags.at);
  await db.query('update bypasses set removed_at = $2, removed_by = $3 where id = $1', [b.id, when, by.id]);
  const shift = await currentShift(db, b.area_id, when);
  const lref = await nextRef(db, 'LOG', 'log_entries', 20000);
  await db.query(`insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title) values ($1,$2,$3,$4,$5,'equipment','normal',$6,$7)`,
    [lref, b.area_id, shift?.id || null, by.id, when, b.tag, `${b.ref}: ${b.tag} restored to service${flags.note ? `. ${str(flags.note)}` : ''}`]);
  return { json: { ref: b.ref, removed_at: when, log_entry: lref }, text: `  ${b.ref}: ${b.tag} restored at ${when} by ${by.name}. Logged as ${lref}.` };
}

// ---------------------------------------------------------------------------
// Rounds and readings

async function cmdRounds(db, args, flags) {
  const params = [num(flags.hours || 24)];
  let where = "due_at > plant_now() - make_interval(hours => $1::int) and due_at <= plant_now() + interval '4 hours'";
  if (flags.state) { params.push(str(flags.state)); where += ` and state = $${params.length}`; }
  if (args.length) { const a = await resolve(db, 'area', args.join(' ')); params.push(a.id); where += ` and area_id = $${params.length}`; }
  const rows = await db.query(`select * from v_rounds where ${where} order by due_at desc, route`, params);
  return { json: rows, text: heading('Rounds') + '\n' + table(rows, [{ key: 'ref', label: 'round' }, { key: 'route', label: 'route' }, { key: 'area', label: 'area' }, { key: 'due_at', label: 'due', format: ts }, { key: 'state', label: 'state', format: (v) => (v === 'missed' ? 'MISSED' : v) }, { key: 'done_at', label: 'done', format: ts }, { key: 'done_by', label: 'by' }, { key: 'readings', label: 'readings', align: 'right', format: (v, r) => `${v}/${r.checkpoints}` }]) };
}

async function cmdLimits(db, args) {
  const params = [];
  let where = 'true';
  if (args.length) { const r = await resolve(db, 'route', args.join(' '), { optional: true }); if (r) { params.push(r.id); where = 'c.route_id = $1'; } else { const a = await resolve(db, 'area', args.join(' ')); params.push(a.id); where = 'rr.area_id = $1'; } }
  const rows = await db.query(`select rr.code as route, c.tag, c.description, c.unit, c.alarm_low, c.alarm_high, c.sol_low, c.sol_high,
      (select value from readings x where x.checkpoint_id = c.id order by recorded_at desc limit 1) as last_value
    from checkpoints c join round_routes rr on rr.id = c.route_id where ${where} order by rr.code, c.seq`, params);
  const lim = (lo, hi) => `${lo ?? ''}..${hi ?? ''}`;
  return { json: rows, text: heading('Checkpoints and limits') + '\n' + table(rows, [{ key: 'route', label: 'route' }, { key: 'tag', label: 'tag' }, { key: 'description', label: 'what', width: 50 }, { key: 'unit', label: 'unit' }, { key: 'alarm_low', label: 'alarm band', format: (v, r) => lim(v, r.alarm_high) }, { key: 'sol_low', label: 'safe limit', format: (v, r) => lim(v, r.sol_high) }, { key: 'last_value', label: 'last', align: 'right' }]) };
}

async function cmdRound(db, args, flags) {
  const q = args.join(' ');
  const routeHit = /^RND-/i.test(q) ? null : await resolve(db, 'route', q, { optional: true });
  let round = routeHit ? null : await resolve(db, 'round', q);
  if (!round) {
    const route = routeHit;
    [round] = await db.query(`select r.*, rr.code as route, rr.area_id from rounds r join round_routes rr on rr.id = r.route_id where r.route_id = $1 and r.done_at is null and r.due_at <= plant_now() + interval '1 hour' order by r.due_at desc limit 1`, [route.id]);
    if (!round) {
      const when = await plantNow(db);
      const ref = await nextRef(db, 'RND', 'rounds', 70000);
      [round] = await db.query('insert into rounds (ref, route_id, due_at) values ($1,$2,$3) returning *', [ref, route.id, when]);
      round.route = route.code; round.area_id = route.area_id;
    }
  }
  if (round.done_at) throw new CliError(`${round.ref} was done at ${ts(round.done_at)}.`);
  const by = await resolve(db, 'person', need(flags, 'by', 'who did the round'));
  const values = need(flags, 'values', 'TAG=value pairs, e.g. --values="TT-301=88,PDT-330=1.2"');
  const when = await at(db, flags.at);
  const shift = await currentShift(db, round.area_id, when);
  const cps = await db.query('select * from checkpoints where route_id = $1 order by seq', [round.route_id]);
  const results = [];
  for (const pair of values.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = pair.match(/^([^=]+)=\s*(-?[\d.]+)$/);
    if (!m) throw new CliError(`"${pair}" is not TAG=value.`);
    const cp = cps.find((c) => c.tag.toLowerCase() === m[1].trim().toLowerCase());
    if (!cp) throw new CliError(`${m[1]} is not a checkpoint on ${round.route}. On this round: ${cps.map((c) => c.tag).join(', ')}.`);
    results.push({ cp, value: Number(m[2]) });
  }
  await db.query('update rounds set done_at = $2, done_by = $3, shift_id = coalesce(shift_id, $4), note = $5 where id = $1', [round.id, when, by.id, shift?.id || null, str(flags.note) || null]);
  const out = [];
  for (const { cp, value } of results) {
    const sol = (cp.sol_low !== null && value < num(cp.sol_low)) || (cp.sol_high !== null && value > num(cp.sol_high));
    const alarm = !sol && ((cp.alarm_low !== null && value < num(cp.alarm_low)) || (cp.alarm_high !== null && value > num(cp.alarm_high)));
    let entryId = null, entryRef = null;
    if (sol) {
      entryRef = await nextRef(db, 'LOG', 'log_entries', 20000);
      const [e] = await db.query(`insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title, carry_forward) values ($1,$2,$3,$4,$5,'process','high',$6,$7,true) returning id`,
        [entryRef, round.area_id, shift?.id || null, by.id, when, cp.tag, `${cp.tag} ${cp.description} read ${value}${cp.unit ? ' ' + cp.unit : ''}, outside the safe operating limit (${cp.sol_low ?? ''}..${cp.sol_high ?? ''})${flags.note ? `. ${str(flags.note)}` : ''}`]);
      entryId = e.id;
    }
    await db.query('insert into readings (round_id, checkpoint_id, value, recorded_at, recorded_by, log_entry_id) values ($1,$2,$3,$4,$5,$6)', [round.id, cp.id, value, when, by.id, entryId]);
    out.push({ tag: cp.tag, value, unit: cp.unit, band: sol ? 'sol' : alarm ? 'alarm' : 'ok', log_entry: entryRef });
  }
  const missing = cps.filter((c) => !results.some((r) => r.cp.id === c.id)).map((c) => c.tag);
  const lines = out.map((o) => `  ${o.tag.padEnd(9)} ${String(o.value).padStart(8)} ${o.unit || ''}  ${o.band === 'sol' ? `OUTSIDE SAFE OPERATING LIMIT, logged ${o.log_entry}: act on it now` : o.band === 'alarm' ? 'outside the alarm band: log why with `explain`' : 'ok'}`);
  return { json: { round: round.ref, done_at: when, readings: out, not_read: missing }, text: `  ${round.ref} (${round.route}) done by ${by.name} at ${when}.\n${lines.join('\n')}${missing.length ? `\n  Not read: ${missing.join(', ')}` : ''}` };
}

async function cmdExcursions(db, args, flags) {
  const rows = await db.query(`select * from v_excursions where recorded_at > plant_now() - make_interval(days => $1::int) ${flags.open ? 'and log_entry_id is null' : ''} order by recorded_at desc`, [num(flags.days || 7)]);
  return { json: rows, text: heading(`Readings outside limits, last ${num(flags.days || 7)} days`) + '\n' + table(rows, [{ key: 'recorded_at', label: 'at', format: ts }, { key: 'area', label: 'area' }, { key: 'tag', label: 'tag' }, { key: 'description', label: 'what', width: 45 }, { key: 'value', label: 'value', align: 'right' }, { key: 'unit', label: 'unit' }, { key: 'band', label: 'band', format: (v) => (v === 'sol' ? 'SAFE LIMIT' : 'alarm') }, { key: 'explained_by', label: 'logged', format: (v) => v || 'NOT LOGGED' }, { key: 'recorded_by', label: 'by' }]) };
}

async function cmdExplain(db, args, flags) {
  const [tagQ, ...rest] = args;
  const cp = await resolve(db, 'checkpoint', tagQ);
  const text = rest.join(' ').trim() || need(flags, 'text', 'what caused it and what was done');
  const [x] = await db.query('select * from v_excursions where checkpoint_id = $1 and log_entry_id is null order by recorded_at desc limit 1', [cp.id]);
  if (!x) throw new CliError(`${cp.tag} has no unexplained reading outside its limits.`);
  const by = flags.by ? await resolve(db, 'person', flags.by) : null;
  const when = await at(db, flags.at);
  const shift = await currentShift(db, x.area_id, when);
  const ref = await nextRef(db, 'LOG', 'log_entries', 20000);
  const [e] = await db.query(`insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title) values ($1,$2,$3,$4,$5,'process','normal',$6,$7) returning id`,
    [ref, x.area_id, shift?.id || null, by?.id || null, when, cp.tag, `${cp.tag} read ${x.value}${cp.unit ? ' ' + cp.unit : ''} at ${ts(x.recorded_at)}: ${text}`]);
  await db.query('update readings set log_entry_id = $2 where id = $1', [x.reading_id, e.id]);
  return { json: { tag: cp.tag, reading_at: x.recorded_at, entry: ref }, text: `  ${cp.tag} reading of ${x.value} at ${ts(x.recorded_at)} explained by ${ref}.` };
}

async function cmdTrend(db, args, flags) {
  const cp = await resolve(db, 'checkpoint', args.join(' '));
  const rows = await db.query('select recorded_at, value, band, explained_by, recorded_by from v_readings where checkpoint_id = $1 and recorded_at > plant_now() - make_interval(days => $2::int) order by recorded_at', [cp.id, num(flags.days || 3)]);
  const vals = rows.map((r) => num(r.value));
  const stats = vals.length ? { min: Math.min(...vals), max: Math.max(...vals), mean: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 } : {};
  return { json: { tag: cp.tag, description: cp.description, unit: cp.unit, limits: { alarm: [cp.alarm_low, cp.alarm_high], sol: [cp.sol_low, cp.sol_high] }, stats, readings: rows },
    text: heading(`${cp.tag} ${cp.description} (${cp.unit || ''})  alarm ${cp.alarm_low ?? ''}..${cp.alarm_high ?? ''}  safe ${cp.sol_low ?? ''}..${cp.sol_high ?? ''}`) + `\n  min ${stats.min ?? '-'}  max ${stats.max ?? '-'}  mean ${stats.mean ?? '-'}\n` + table(rows, [{ key: 'recorded_at', label: 'at', format: ts }, { key: 'value', label: 'value', align: 'right' }, { key: 'band', label: 'band' }, { key: 'explained_by', label: 'logged' }, { key: 'recorded_by', label: 'by' }]) };
}

// ---------------------------------------------------------------------------
// People, sign-offs, fatigue, starting a shift

async function cmdPeople(db, args, flags) {
  const rows = await db.query(`select p.name, p.role, p.crew, p.status,
      (select string_agg(a.code || case when c.expires_on < plant_now()::date then ' (lapsed)' when c.expires_on < plant_now()::date + setting_num('competency_due_days', 30)::int then ' (due ' || to_char(c.expires_on, 'DD Mon') || ')' else '' end, ', ' order by a.code) from competencies c join areas a on a.id = c.area_id where c.person_id = p.id) as signed_off_for
    from people p where ${flags.all ? 'true' : "p.status = 'active'"} ${args.length ? 'and (p.crew = $1 or p.role = $1)' : ''} order by p.crew nulls last, p.role desc, p.name`, args.length ? [args[0]] : []);
  return { json: rows, text: heading('People') + '\n' + table(rows, [{ key: 'name', label: 'name' }, { key: 'role', label: 'role' }, { key: 'crew', label: 'crew' }, { key: 'signed_off_for', label: 'signed off for' }, { key: 'status', label: 'status' }]) };
}

async function cmdCompetency(db, args, flags) {
  const due = num(flags.days || (await setting(db, 'competency_due_days', 30)));
  const expiring = await db.query(`select p.name as person, a.code as area, c.signed_off_on, c.expires_on, c.signed_off_by, case when c.expires_on < plant_now()::date then 'LAPSED' else 'due' end as state
    from competencies c join people p on p.id = c.person_id join areas a on a.id = c.area_id where p.status = 'active' and c.expires_on < plant_now()::date + $1::int order by c.expires_on`, [due]);
  const gaps = await db.query("select person, area, count(*) as shifts, max(ref) as latest, min(why) as why from v_competency_gaps where starts_at > plant_now() - interval '30 days' and starts_at <= plant_now() group by person, area order by person");
  return { json: { expiring, worked_without: gaps }, text: heading(`Sign-offs lapsed or due in ${due} days`) + '\n' + table(expiring, [{ key: 'person', label: 'person' }, { key: 'area', label: 'area' }, { key: 'expires_on', label: 'expires', format: day }, { key: 'state', label: 'state' }, { key: 'signed_off_by', label: 'signed off by' }]) +
    heading('Worked an area without a current sign-off, last 30 days') + '\n' + table(gaps, [{ key: 'person', label: 'person' }, { key: 'area', label: 'area' }, { key: 'shifts', label: 'shifts', align: 'right' }, { key: 'latest', label: 'latest' }, { key: 'why', label: 'why' }]) };
}

async function cmdSignoff(db, args, flags) {
  const p = await resolve(db, 'person', args.join(' '));
  const a = await resolve(db, 'area', need(flags, 'area'));
  const by = need(flags, 'by', 'who assessed them');
  const on = day(await at(db, flags.on));
  const expires = flags.expires ? day(await at(db, flags.expires)) : null;
  await db.query(`insert into competencies (person_id, area_id, signed_off_on, expires_on, signed_off_by) values ($1,$2,$3,$4,$5)
    on conflict (person_id, area_id) do update set signed_off_on = excluded.signed_off_on, expires_on = excluded.expires_on, signed_off_by = excluded.signed_off_by`, [p.id, a.id, on, expires, by]);
  return { json: { person: p.name, area: a.code, signed_off_on: on, expires_on: expires }, text: `  ${p.name} signed off for ${a.code} on ${on}${expires ? `, to ${expires}` : ''} by ${by}.` };
}

async function cmdFatigue(db) {
  const lim = { shifts: num(await setting(db, 'max_consecutive_shifts', 7)), rest: num(await setting(db, 'min_rest_hours', 10)), hours: num(await setting(db, 'max_hours_7_days', 60)) };
  const rows = (await db.query('select * from v_fatigue order by hours_7_days desc, person')).map((r) => ({
    ...r, over: [num(r.consecutive_shifts) > lim.shifts ? 'shifts in a row' : '', num(r.hours_7_days) > lim.hours ? 'hours' : '', r.min_rest_hours !== null && num(r.min_rest_hours) < lim.rest ? 'rest' : ''].filter(Boolean).join(', '),
  }));
  return { json: { limits: lim, people: rows }, text: heading(`Fatigue: house limits ${lim.shifts} shifts in a row, ${lim.rest} h rest, ${lim.hours} h in 7 days`) + '\n' + table(rows, [{ key: 'person', label: 'person' }, { key: 'crew', label: 'crew' }, { key: 'hours_7_days', label: 'h in 7 days', align: 'right' }, { key: 'consecutive_shifts', label: 'in a row', align: 'right' }, { key: 'min_rest_hours', label: 'least rest h', align: 'right' }, { key: 'last_shift_end', label: 'last shift ended', format: ts }, { key: 'over', label: 'over the limit', format: (v) => (v ? v.toUpperCase() : '') }]) };
}

async function fatigueProblems(db, person, startsAt, endsAt) {
  const lim = { shifts: num(await setting(db, 'max_consecutive_shifts', 7)), rest: num(await setting(db, 'min_rest_hours', 10)), hours: num(await setting(db, 'max_hours_7_days', 60)) };
  const worked = await db.query('select distinct shift_id, starts_at, ends_at, hours from v_worked where person_id = $1 and starts_at < $2 order by starts_at desc', [person.id, startsAt]);
  const out = [];
  const s0 = new Date(startsAt.replace(' ', 'T'));
  const len = (new Date(endsAt.replace(' ', 'T')) - s0) / 3600000;
  if (worked.length) {
    const rest = (s0 - new Date(String(worked[0].ends_at).replace(' ', 'T'))) / 3600000;
    if (rest < lim.rest) out.push(`${person.name} would have ${Math.max(0, rest).toFixed(1)} h rest since their last shift (limit ${lim.rest} h)`);
  }
  let run = 1, prev = s0;
  for (const w of worked) {
    if ((prev - new Date(String(w.ends_at).replace(' ', 'T'))) / 3600000 > 30) break;
    run++; prev = new Date(String(w.starts_at).replace(' ', 'T'));
  }
  if (run > lim.shifts) out.push(`${person.name} would work ${run} shifts in a row (limit ${lim.shifts})`);
  const weekAgo = new Date(s0.getTime() - 7 * 86400000);
  const hrs = worked.filter((w) => new Date(String(w.starts_at).replace(' ', 'T')) > weekAgo).reduce((a, w) => a + num(w.hours), 0) + len;
  if (hrs > lim.hours) out.push(`${person.name} would reach ${hrs} h in 7 days (limit ${lim.hours})`);
  return out;
}

async function cmdStart(db, args, flags) {
  const area = await resolve(db, 'area', args.join(' '));
  const lead = await resolve(db, 'person', need(flags, 'lead'));
  const others = [];
  for (const n of str(flags.people).split(',').map((s) => s.trim()).filter(Boolean)) others.push(await resolve(db, 'person', n));
  const startsAt = await at(db, flags.at);
  const hours = num(flags.hours || 12);
  const [{ ends }] = await db.query("select to_char($1::timestamp + make_interval(mins => $2::int), 'YYYY-MM-DD HH24:MI') as ends", [startsAt, Math.round(hours * 60)]);
  const [overlap] = await db.query('select ref from shifts where area_id = $1 and starts_at < $3 and ends_at > $2', [area.id, startsAt, ends]);
  if (overlap) throw new CliError(`${overlap.ref} already covers ${area.code} at that time.`);
  const problems = [];
  const everyone = [lead, ...others.filter((o) => o.id !== lead.id)];
  const usedExceptions = [];
  for (const p of everyone) {
    const [c] = await db.query('select * from competencies where person_id = $1 and area_id = $2', [p.id, area.id]);
    if (!c || day(c.signed_off_on) > startsAt.slice(0, 10)) problems.push(`${p.name} is not signed off for ${area.code}`);
    else if (c.expires_on && day(c.expires_on) < startsAt.slice(0, 10)) problems.push(`${p.name}'s sign-off for ${area.code} lapsed ${day(c.expires_on)}`);
    const f = await fatigueProblems(db, p, startsAt, ends);
    if (f.length) {
      const [ex] = await db.query('select * from fatigue_exceptions where person_id = $1 and for_date = $2 and used_shift_id is null limit 1', [p.id, startsAt.slice(0, 10)]);
      if (ex) usedExceptions.push({ ex, p, f });
      else problems.push(...f.map((x) => `${x}; a manager can record an exception with \`fatigue-exception "${p.name}" --approved-by= --reason=\``));
    }
  }
  if (problems.length) throw new CliError(`Shift not started on ${area.code}:\n  ${problems.join('\n  ')}`);
  const ref = await nextRef(db, 'SH', 'shifts', 5000);
  const [s] = await db.query("insert into shifts (ref, area_id, kind, crew, starts_at, ends_at, lead_id, status) values ($1,$2,$3,$4,$5,$6,$7,'planned') returning id", [ref, area.id, str(flags.kind) || (Number(startsAt.slice(11, 13)) >= 6 && Number(startsAt.slice(11, 13)) < 18 ? 'day' : 'night'), str(flags.crew) || lead.crew, startsAt, ends, lead.id]);
  for (const p of others) await db.query('insert into shift_people (shift_id, person_id, position) values ($1,$2,$3) on conflict do nothing', [s.id, p.id, null]);
  for (const u of usedExceptions) {
    await db.query('update fatigue_exceptions set used_shift_id = $2 where id = $1', [u.ex.id, s.id]);
    await note(db, 'shift', s.id, ref, `${u.p.name} rostered past the fatigue limits on ${u.ex.approved_by}'s exception (${u.ex.reason}): ${u.f.join('; ')}`);
  }
  await syncShifts(db);
  const [prev] = await db.query("select ref, handover from v_shifts where area_id = $1 and ends_at <= $2 order by ends_at desc limit 1", [area.id, startsAt]);
  const warn = prev && prev.handover === 'missing' ? `\n  ${prev.ref} before it has no handover. Get it given before this crew takes the plant: \`handover ${prev.ref}\`.` : '';
  return { json: { ref, area: area.code, starts_at: startsAt, ends_at: ends, lead: lead.name, people: others.map((o) => o.name), exceptions_used: usedExceptions.length }, text: `  ${ref} on ${area.code}, ${startsAt} to ${ends}, lead ${lead.name}${others.length ? `, with ${others.map((o) => o.name).join(', ')}` : ''}.${warn}` };
}

async function cmdFatigueException(db, args, flags) {
  const p = await resolve(db, 'person', args.join(' '));
  const approver = await resolve(db, 'person', need(flags, 'approved-by', 'a supervisor or manager'));
  if (!['supervisor', 'manager'].includes(approver.role)) throw new CliError(`${approver.name} is ${approver.role}; a fatigue exception is a supervisor's or manager's decision.`);
  const reason = need(flags, 'reason', 'why, and what controls are in place');
  const forDate = day(await at(db, flags.date));
  await db.query('insert into fatigue_exceptions (person_id, for_date, approved_by, reason) values ($1,$2,$3,$4)', [p.id, forDate, approver.name, reason]);
  return { json: { person: p.name, for_date: forDate, approved_by: approver.name }, text: `  Exception recorded: ${p.name} may start one shift on ${forDate} past the fatigue limits, approved by ${approver.name}. It stays on the record.` };
}

// ---------------------------------------------------------------------------
// The week

async function cmdWeek(db, args, flags) {
  const days = num(flags.days || 7);
  const p = [days];
  const iv = 'plant_now() - make_interval(days => $1::int)';
  const [w] = await db.query(`select
      (select count(*) from shifts where ends_at > ${iv} and ends_at <= plant_now()) as shifts,
      (select count(*) from v_shifts where ends_at > ${iv} and ends_at <= plant_now() and handover = 'accepted') as handovers_on_time,
      (select count(*) from v_shifts where ends_at > ${iv} and ends_at <= plant_now() and handover = 'late') as handovers_late,
      (select count(*) from v_shifts where ends_at > ${iv} and ends_at <= plant_now() and handover in ('missing', 'not accepted')) as handovers_open,
      (select count(*) from log_entries where logged_at > ${iv}) as entries,
      (select count(*) from log_entries where logged_at > ${iv} and category = 'trip') as trips,
      (select count(*) from log_entries where logged_at > ${iv} and category = 'safety') as safety_entries,
      (select count(*) from log_entries where logged_at > ${iv} and injury) as injuries,
      (select count(*) from v_rounds where due_at > ${iv} and due_at <= plant_now()) as rounds_due,
      (select count(*) from v_rounds where due_at > ${iv} and state = 'missed') as rounds_missed,
      (select count(*) from v_excursions where recorded_at > ${iv} and band = 'alarm') as alarm_excursions,
      (select count(*) from v_excursions where recorded_at > ${iv} and band = 'sol') as sol_excursions,
      (select count(*) from v_excursions where recorded_at > ${iv} and log_entry_id is null) as excursions_not_logged,
      (select coalesce(sum(hours_on), 0) from v_bypasses where safety_critical and (removed_at is null or removed_at > ${iv})) as safety_critical_bypass_hours,
      (select count(*) from actions where created_at > now() - make_interval(days => $1::int)) as actions_raised,
      (select count(*) from actions where done_at > ${iv}) as actions_done`, p);
  const byArea = await db.query(`select a.code as area, count(le.id) as entries, count(*) filter (where le.category = 'trip') as trips, count(*) filter (where le.priority = 'high') as high_priority
    from areas a left join log_entries le on le.area_id = a.id and le.logged_at > ${iv} group by a.code order by a.code`, p);
  const text = [heading(`The last ${days} days`),
    `  Shifts ${w.shifts}: handovers accepted on time ${w.handovers_on_time}, late ${w.handovers_late}, missing or not accepted ${w.handovers_open}`,
    `  Logbook ${w.entries} entries: ${w.trips} trips, ${w.safety_entries} safety, ${w.injuries} injuries`,
    `  Rounds ${w.rounds_due} due, ${w.rounds_missed} missed. Readings outside the alarm band ${w.alarm_excursions}, outside the safe operating limit ${w.sol_excursions}, ${w.excursions_not_logged} with nothing logged`,
    `  Safety-critical bypass hours ${w.safety_critical_bypass_hours}. Actions raised ${w.actions_raised}, done ${w.actions_done}`,
    heading('By area'), table(byArea, [{ key: 'area', label: 'area' }, { key: 'entries', label: 'entries', align: 'right' }, { key: 'trips', label: 'trips', align: 'right' }, { key: 'high_priority', label: 'high priority', align: 'right' }])].join('\n');
  return { json: { days, ...w, by_area: byArea }, text };
}

// ---------------------------------------------------------------------------
// Compliance

const RULES = [
  { rule: 'handover-recorded', title: 'Every shift is handed over and the handover accepted', source: 'HSE Inspectors Toolkit, Common Topic 3 (safety critical communications); Energy Institute Human Factors Briefing Note 10; US CSB BP Texas City report (2007)',
    sql: "select ref as record, area, 'handover ' || handover || ', shift ended ' || to_char(ends_at, 'DD Mon HH24:MI') as detail, ends_at as at from v_shifts where handover in ('missing', 'not accepted') and ends_at > plant_now() - interval '30 days' order by ends_at desc" },
  { rule: 'handover-late', title: 'The incoming lead accepts within the grace period (house rule)', source: 'House rule, setting handover_grace_minutes, after HSE Common Topic 3 (allow time for handover)',
    sql: "select ref as record, area, 'accepted ' || to_char(accepted_at, 'DD Mon HH24:MI') || ' for a shift ending ' || to_char(ends_at, 'HH24:MI') as detail, ends_at as at from v_shifts where handover = 'late' and ends_at > plant_now() - interval '30 days' order by ends_at desc" },
  { rule: 'bypass-in-handover', title: 'Every bypass active at shift end is on that handover', source: 'HSE Common Topic 3 names safety systems over-ridden as a high-risk point for communication',
    sql: "select s.ref as record, a.code as area, b.ref || ' ' || b.tag || ' active at shift end, not on the handover' as detail, s.ends_at as at from handovers h join shifts s on s.id = h.shift_id join areas a on a.id = s.area_id join bypasses b on b.area_id = s.area_id and b.applied_at <= h.given_at and (b.removed_at is null or b.removed_at > h.given_at) where not (coalesce(h.items->'bypasses', '[]'::jsonb) @> jsonb_build_array(b.ref)) and s.ends_at > plant_now() - interval '30 days' order by s.ends_at desc" },
  { rule: 'bypass-authority', title: 'No bypass runs past its authorised time', source: 'IEC 61511-1 (bypass management for safety instrumented systems); house rule bypass_max_hours for safety-critical bypasses',
    sql: "select ref as record, area, tag || ' ' || replace(kind, '_', ' ') || ', authorised until ' || to_char(authorised_until, 'DD Mon HH24:MI') || case when safety_critical then ', safety critical' else '' end as detail, authorised_until as at from v_bypasses where overdue order by authorised_until" },
  { rule: 'orders-acknowledged', title: 'Everyone who works an area has acknowledged its standing orders', source: 'HSWA 2015 s36(3)(f) (NZ) and WHS Act 2011 s19(3)(f) (AU): information, instruction and supervision; HSE Common Topic 3 (two-way communication)',
    sql: "select ref as record, area, person || ' worked ' || shifts_since || ' shift(s) without acknowledging it' as detail, first_shift_since as at from v_unacked order by first_shift_since" },
  { rule: 'orders-current', title: 'No standing order stays in force past its expiry', source: 'House rule, setting order_max_days',
    sql: "select ref as record, area, '\"' || title || '\" expired ' || coalesce(expires_on::text, 'never set') as detail, expires_on::timestamp as at from v_standing_orders where status = 'active' and (expired or expires_on is null) order by expires_on" },
  { rule: 'rounds-done', title: 'Every operator round is done within its grace period', source: "The site's own operating procedures; house rule round_grace_minutes",
    sql: "select ref as record, area, route || ' due ' || to_char(due_at, 'DD Mon HH24:MI') || ' not done' as detail, due_at as at from v_rounds where state = 'missed' and due_at > plant_now() - interval '30 days' order by due_at desc" },
  { rule: 'excursions-logged', title: 'Every reading outside its limits is explained in the logbook', source: 'US CSB BP Texas City report (2007) on logbook records; house rule',
    sql: "select tag as record, area, value || coalesce(' ' || unit, '') || ' (' || case when band = 'sol' then 'safe operating limit' else 'alarm band' end || ') at ' || to_char(recorded_at, 'DD Mon HH24:MI') as detail, recorded_at as at from v_excursions where log_entry_id is null and recorded_at > plant_now() - interval '30 days' order by recorded_at desc" },
  { rule: 'notifiable', title: 'Every notifiable event is notified to the regulator', source: 'HSWA 2015 ss23 to 25, 56 and 57 (NZ, WorkSafe); WHS Act 2011 ss35 to 39 (AU, the state regulator)',
    sql: "select ref as record, area, title as detail, logged_at as at from v_entries where notifiable and notified_at is null order by logged_at" },
  { rule: 'competency', title: 'Nobody works an area without a current sign-off', source: 'HSWA 2015 s36(3)(f) (NZ); WHS Regulations 2011 reg 39 (AU): information, training and instruction',
    sql: "select person as record, area, count(*) || ' shift(s), ' || min(why) || ', latest ' || max(ref) as detail, max(starts_at) as at from v_competency_gaps where starts_at > plant_now() - interval '30 days' and starts_at <= plant_now() group by person, area order by person" },
  { rule: 'fatigue', title: 'Nobody works past the fatigue limits without a recorded exception', source: 'Safe Work Australia, Guide for managing the risk of fatigue at work (2013); WorkSafe New Zealand fatigue guidance; house limits in settings',
    sql: "select person as record, crew as area, consecutive_shifts || ' shifts in a row, ' || hours_7_days || ' h in 7 days, least rest ' || coalesce(min_rest_hours::text, '-') || ' h' as detail, last_shift_end as at from v_fatigue where consecutive_shifts > setting_num('max_consecutive_shifts', 7) or hours_7_days > setting_num('max_hours_7_days', 60) or min_rest_hours < setting_num('min_rest_hours', 10) order by person" },
];

async function cmdCompliance(db, args) {
  const only = args[0];
  const rules = only ? RULES.filter((r) => r.rule === only) : RULES;
  if (only && !rules.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.rule).join(', ')}`);
  const results = [];
  for (const r of rules) {
    const rows = await db.query(r.sql);
    results.push({ rule: r.rule, title: r.title, source: r.source, breaches: rows.length, worst: rows[0] ? `${rows[0].record}: ${rows[0].detail}` : '', rows });
  }
  const summary = table(results, [{ key: 'rule', label: 'rule' }, { key: 'breaches', label: 'breaches', align: 'right' }, { key: 'worst', label: 'example', width: 100 }]);
  const detail = only ? results.map((r) => heading(`${r.rule}: ${r.title}`) + `\n  Source: ${r.source}\n` + table(r.rows, [{ key: 'record', label: 'record' }, { key: 'area', label: 'area' }, { key: 'detail', label: 'detail', width: 100 }])).join('\n') : '';
  return { json: results, text: heading(`Compliance (${results.filter((r) => r.breaches).length} of ${results.length} rules breached)`) + '\n' + summary + (detail ? '\n' + detail : '\n\n  Detail and source for one rule: compliance <rule>. Not legal advice: docs/compliance.md.') };
}

// ---------------------------------------------------------------------------
// Housekeeping

async function cmdNote(db, args, flags) {
  const [kind, ...rest] = args;
  const body = need(flags, 'text', 'what happened');
  const kinds = { person: 'person', shift: 'shift', entry: 'entry', order: 'order', bypass: 'bypass', area: 'area', action: 'action' };
  if (!kinds[kind]) throw new CliError(`note <${Object.keys(kinds).join('|')}> <which> --text="..."`);
  const r = await resolve(db, kinds[kind], rest.join(' '));
  const label = r.ref || r.name || r.code;
  await note(db, kind, r.id, label, body);
  return { json: { kind, label, body }, text: `  Noted on ${label}.` };
}

async function cmdAdd(db, args, flags) {
  const [kind, ...rest] = args;
  const name = rest.join(' ').trim();
  if (kind === 'area') {
    const code = need(flags, 'code').toUpperCase();
    await db.query('insert into areas (code, name, description, hazard_notes) values ($1,$2,$3,$4)', [code, name || code, str(flags.description) || null, str(flags.hazards) || null]);
    return { json: { area: code }, text: `  Area ${code} added.` };
  }
  if (kind === 'person') {
    if (!name) throw new CliError('add person "Name" --role=operator --crew=A');
    await db.query('insert into people (name, role, crew, email, phone) values ($1,$2,$3,$4,$5)', [name, str(flags.role) || 'operator', str(flags.crew) || null, str(flags.email) || null, str(flags.phone) || null]);
    return { json: { person: name }, text: `  ${name} added. Sign them off for an area before they work it: signoff "${name}" --area= --by= --expires=` };
  }
  if (kind === 'route') {
    const area = await resolve(db, 'area', need(flags, 'area'));
    const code = need(flags, 'code').toUpperCase();
    await db.query('insert into round_routes (code, name, area_id, every_hours, first_at) values ($1,$2,$3,$4,$5)', [code, name || code, area.id, num(flags.every || 4), str(flags.first) || '02:00']);
    return { json: { route: code }, text: `  Round ${code} added on ${area.code}, every ${num(flags.every || 4)} h.` };
  }
  if (kind === 'checkpoint') {
    const route = await resolve(db, 'route', need(flags, 'route'));
    const tag = need(flags, 'tag');
    const [{ n }] = await db.query('select coalesce(max(seq), 0) + 1 as n from checkpoints where route_id = $1', [route.id]);
    const nv = (k) => (flags[k] === undefined ? null : Number(flags[k]));
    await db.query('insert into checkpoints (route_id, seq, tag, description, unit, alarm_low, alarm_high, sol_low, sol_high) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [route.id, n, tag, name || tag, str(flags.unit) || null, nv('alarm-low'), nv('alarm-high'), nv('sol-low'), nv('sol-high')]);
    return { json: { checkpoint: tag }, text: `  ${tag} added to ${route.code}.` };
  }
  throw new CliError('add area|person|route|checkpoint ...');
}

async function cmdLimit(db, args, flags) {
  const cp = await resolve(db, 'checkpoint', args.join(' '));
  const sets = [], vals = [cp.id];
  for (const [flag, col] of [['alarm-low', 'alarm_low'], ['alarm-high', 'alarm_high'], ['sol-low', 'sol_low'], ['sol-high', 'sol_high']]) {
    if (flags[flag] !== undefined) { vals.push(str(flags[flag]) === 'none' ? null : Number(flags[flag])); sets.push(`${col} = $${vals.length}`); }
  }
  if (!sets.length) throw new CliError('Give at least one of --alarm-low --alarm-high --sol-low --sol-high (or "none").');
  const why = need(flags, 'reason', 'a limit change is a change; say why and who approved it');
  await db.query(`update checkpoints set ${sets.join(', ')} where id = $1`, vals);
  await note(db, 'checkpoint', cp.id, cp.tag, `Limits changed (${sets.join(', ').replace(/\$\d+/g, '?')}): ${why}`);
  return { json: { tag: cp.tag }, text: `  ${cp.tag} limits changed. Noted: ${why}. A safe operating limit change normally goes through management of change.` };
}

// Import: j5 and most logbooks report to Excel or CSV. Column names vary by
// site configuration, so each field accepts the common names.
async function cmdImport(db, args, flags) {
  const source = args[0] || 'csv';
  if (!['j5', 'csv'].includes(source)) throw new CliError('import j5|csv --entries=file.csv [--people=file.csv] [--orders=file.csv] [--dry-run]');
  const dry = !!flags['dry-run'];
  const report = { source, dry_run: dry, people: 0, entries: 0, orders: 0, areas_created: [], unmatched_people: new Set(), problems: [] };
  const read = (f) => parseCsv(readFileSync(path.resolve(str(f)), 'utf8'));
  await db.exec('BEGIN');
  try {
    const areaFor = async (v) => {
      const code = String(v || '').trim();
      if (!code) return null;
      const a = await resolve(db, 'area', code, { optional: true }).catch(() => null);
      if (a) return a;
      const c = code.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'AREA';
      const [ins] = await db.query('insert into areas (code, name) values ($1,$2) on conflict (code) do update set name = areas.name returning *', [c, code]);
      report.areas_created.push(c);
      return ins;
    };
    const personFor = async (v) => {
      const n = String(v || '').trim();
      if (!n) return null;
      const p = await resolve(db, 'person', n, { optional: true }).catch(() => null);
      if (!p) report.unmatched_people.add(n);
      return p;
    };
    if (flags.people) {
      for (const r of read(flags.people)) {
        const name = pick(r, 'Name', 'Full Name', 'Person', 'User');
        if (!name) { report.problems.push('person row with no name'); continue; }
        await db.query('insert into people (name, role, crew, email, external_ref) values ($1,$2,$3,$4,$5) on conflict (name) do nothing',
          [name, ['operator', 'shift_lead', 'supervisor', 'manager', 'engineer', 'maintenance'].includes(pick(r, 'Role').toLowerCase().replace(/\s+/g, '_')) ? pick(r, 'Role').toLowerCase().replace(/\s+/g, '_') : 'operator', pick(r, 'Crew', 'Team', 'Shift Team') || null, pick(r, 'Email') || null, pick(r, 'ID', 'User ID', 'Employee ID') || null]);
        report.people++;
      }
    }
    if (flags.entries) {
      let n = 0;
      for (const r of read(flags.entries)) {
        n++;
        const area = await areaFor(pick(r, 'Area', 'Logbook', 'Unit', 'Plant Area', 'Location'));
        const title = pick(r, 'Title', 'Subject', 'Summary', 'Event', 'Entry');
        const when = pick(r, 'Date/Time', 'Date Time', 'Logged', 'Event Date', 'Created', 'Date');
        if (!area || !title || !when) { report.problems.push(`entry row ${n + 1}: needs an area, a title and a date (${[!area && 'area', !title && 'title', !when && 'date'].filter(Boolean).join(', ')} missing)`); continue; }
        const iso = when.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/, (_, d, m, y) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`).replace('T', ' ').slice(0, 16);
        if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) { report.problems.push(`entry row ${n + 1}: "${when}" is not a date`); continue; }
        const person = await personFor(pick(r, 'Author', 'Created By', 'Logged By', 'Operator', 'User'));
        const cat = pick(r, 'Category', 'Entry Type', 'Type', 'Event Type').toLowerCase();
        const category = ['event', 'alarm', 'trip', 'equipment', 'process', 'safety', 'environmental', 'quality', 'instruction', 'note'].find((c) => cat.includes(c)) || 'note';
        const pr = pick(r, 'Priority', 'Severity', 'Importance').toLowerCase();
        const ref = await nextRef(db, 'LOG', 'log_entries', 20000);
        const [{ id: shiftId } = {}] = await db.query('select id from shifts where area_id = $1 and starts_at <= $2 and ends_at > $2 limit 1', [area.id, iso]);
        await db.query(`insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title, body, carry_forward, external_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [ref, area.id, shiftId || null, person?.id || null, iso, category, /high|urgent|critical|1/.test(pr) ? 'high' : /low|3/.test(pr) ? 'low' : 'normal', pick(r, 'Tag', 'Equipment', 'Equipment Tag', 'Asset') || null,
            title, pick(r, 'Description', 'Details', 'Comments', 'Body', 'Notes') || null, yesNo(pick(r, 'Carry Forward', 'Open', 'Handover'), false), pick(r, 'ID', 'Entry ID', 'Reference') || null]);
        report.entries++;
      }
    }
    if (flags.orders) {
      let n = 0;
      for (const r of read(flags.orders)) {
        n++;
        const title = pick(r, 'Title', 'Subject', 'Order');
        const issuer = await personFor(pick(r, 'Issued By', 'Author', 'Created By'));
        if (!title || !issuer) { report.problems.push(`order row ${n + 1}: needs a title and an issuer that matches a person`); continue; }
        const areaName = pick(r, 'Area', 'Logbook', 'Unit');
        const area = areaName && areaName.toUpperCase() !== 'ALL' ? await areaFor(areaName) : null;
        const ref = await nextRef(db, 'SO', 'standing_orders', 100);
        const exp = pick(r, 'Expires', 'Expiry', 'Expiry Date', 'Valid To');
        if (!exp) report.problems.push(`order row ${n + 1}: "${title}" has no expiry; it is imported and shows as breaching orders-current until one is set`);
        await db.query('insert into standing_orders (ref, area_id, title, instruction, issued_by, effective_from, expires_on) values ($1,$2,$3,$4,$5,$6,$7)',
          [ref, area?.id || null, title, pick(r, 'Instruction', 'Description', 'Details') || title, issuer.id, (pick(r, 'Effective', 'Effective From', 'Start', 'Date') || (await plantNow(db))).slice(0, 16), exp ? exp.slice(0, 10) : null]);
        report.orders++;
      }
    }
    await db.exec(dry ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
  const out = { ...report, unmatched_people: [...report.unmatched_people] };
  return { json: out, text: `  ${dry ? 'Dry run, nothing saved' : 'Imported'}: ${out.people} people, ${out.entries} logbook entries, ${out.orders} standing orders.${out.areas_created.length ? `\n  New areas: ${out.areas_created.join(', ')}` : ''}${out.unmatched_people.length ? `\n  Authors not in people (entries kept with no author): ${out.unmatched_people.join(', ')}` : ''}${out.problems.length ? `\n  Skipped or flagged:\n    ${out.problems.join('\n    ')}` : ''}` };
}

async function cmdExport(db, args, flags) {
  const tables = ['settings', 'areas', 'people', 'competencies', 'shifts', 'shift_people', 'fatigue_exceptions', 'log_entries', 'actions', 'standing_orders', 'order_acks', 'bypasses', 'round_routes', 'checkpoints', 'rounds', 'readings', 'handovers', 'notes'];
  const data = { exported_at: new Date().toISOString() };
  for (const t of tables) data[t] = await db.query(`select * from ${t}`);
  const file = path.resolve(str(flags.out) || path.join(REPO_ROOT, 'exports', `shift-operations-${new Date().toISOString().slice(0, 10)}.json`));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  const counts = Object.fromEntries(tables.map((t) => [t, data[t].length]));
  return { json: { file, counts }, text: `  Exported to ${path.relative(process.cwd(), file)}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}` };
}

// ---------------------------------------------------------------------------

const HELP = `Shift Operations for Claude Code

Reads:
  attention                      everything that wants a decision, worst first
  week [--days=7]                the last seven days on one screen
  areas  |  shift [area|ref]     who is on shift now; a shift's card: crew, logbook, rounds, handover
  shifts [area] [--days=3]       shifts and their handover state
  entries [area] [--days=1 --category= --tag= --search= --open]   the logbook
  entry-card <LOG-ref>           one entry with its actions and readings
  orders [area] [--all]  |  order <SO-ref>      standing orders, who has not read them
  bypasses [--all]               safety functions bypassed or inhibited now
  rounds [area] [--state=missed] |  limits [route|area]  |  trend <tag> [--days=3]
  excursions [--days=7 --open]   readings outside the alarm band or the safe operating limit
  actions [--all]  |  people  |  competency  |  fatigue
  compliance [rule]              eleven rules, sources cited (docs/compliance.md)

Shift work:
  entry "what happened" --area= [--by= --category= --priority= --tag= --carry --injury --notifiable --body= --action= --owner= --due=]
  close <LOG>  |  notified <LOG> --ref=  |  done <ACT> [--note=]
  handover <area|shift> [--dry-run --by= --summary=]      give the handover; --dry-run shows the pack
  accept <area|shift> --by=<incoming lead>               refuses an unread standing order or a lapsed sign-off
  round <route|RND> --by= --values="TAG=1.2,TAG2=3"      record a round; a safe-limit excursion logs itself
  explain <tag> "why" [--by=]                            log the cause of the last unexplained excursion
  bypass <tag> --area= --kind= --description= --reason= --by= --authorised-by= --hours= [--safety-critical --ra=]
  extend <BYP> --hours= --authorised-by= [--ra=]  |  restore <BYP> --by=
  issue "title" --area=<code|ALL> --instruction= --by= --approved-by= --expires=
  ack <SO> --by="Name, Name"  |  withdraw <SO> --reason=
  start <area> --lead= [--people="a,b" --at= --hours=12]  refuses a lapsed sign-off or a fatigue limit
  fatigue-exception <person> --approved-by= --reason= [--date=]

Housekeeping:
  add area|person|route|checkpoint ...  |  signoff <person> --area= --by= [--expires=]
  limit <tag> [--alarm-low= --alarm-high= --sol-low= --sol-high=] --reason=
  note <person|shift|entry|order|bypass|area|action> <which> --text=
  import j5|csv --entries= [--people= --orders=] [--dry-run]
  export [--out=file.json]

Any command takes --json. Times are plant time ("2026-11-15 14:30", "14:30" or "now").
A name is matched on any words ("kahu", "boiler 2"); an ambiguous one lists the candidates.
Nothing here connects to a control system, a historian or a regulator, and nothing sends.
`;

const COMMANDS = {
  attention: cmdAttention, week: cmdWeek, areas: cmdAreas, shift: cmdShift, shifts: cmdShifts, entries: cmdEntries, 'entry-card': cmdEntryCard,
  entry: cmdEntry, close: cmdClose, notified: cmdNotified, actions: cmdActions, done: cmdDone,
  handover: cmdHandover, accept: cmdAccept,
  orders: cmdOrders, order: cmdOrderCard, issue: cmdIssue, ack: cmdAck, withdraw: cmdWithdraw,
  bypasses: cmdBypasses, bypass: cmdBypass, extend: cmdExtend, restore: cmdRestore,
  rounds: cmdRounds, limits: cmdLimits, round: cmdRound, excursions: cmdExcursions, explain: cmdExplain, trend: cmdTrend, limit: cmdLimit,
  people: cmdPeople, competency: cmdCompetency, signoff: cmdSignoff, fatigue: cmdFatigue, start: cmdStart, 'fatigue-exception': cmdFatigueException,
  compliance: cmdCompliance, note: cmdNote, add: cmdAdd, import: cmdImport, export: cmdExport,
};

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const [command, ...rest] = args;
  if (!command || command === 'help' || flags.help) { process.stdout.write(HELP); return 0; }
  const fn = COMMANDS[command];
  if (!fn) { process.stderr.write(`Unknown command "${command}".\n\n${HELP}`); return 1; }
  const db = await getDb();
  try {
    await syncShifts(db);
    const result = await fn(db, rest, flags);
    if (flags.json) process.stdout.write(JSON.stringify(result.json, null, 2) + '\n');
    else process.stdout.write(result.text.replace(/^\n/, '') + '\n');
    return 0;
  } catch (e) {
    if (e instanceof CliError) { process.stderr.write(`${e.message}\n`); return e.code; }
    if (/relation "?\w+"? does not exist/.test(e.message)) { process.stderr.write('The database has no tables yet. Run: npm run migrate\n'); return 1; }
    process.stderr.write(`error: ${e.message}\n`);
    return 1;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
