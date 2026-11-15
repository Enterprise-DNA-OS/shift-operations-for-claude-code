-- Shift Operations for Claude Code: the schema.
--
-- A process plant's operations record: the operating areas, the people and
-- their sign-offs for each area, the shifts, the logbook, the handover at every
-- shift change, the standing orders and who has read them, the safety functions
-- that are bypassed or inhibited right now, the operator rounds and their
-- readings against limits, and the actions that come out of it all.
--
-- Plain Postgres. Runs on any Postgres and on PGlite. No extensions.
-- Times are plant wall-clock time (timestamp without time zone), in the zone
-- named by the `timezone` setting. plant_now() is "now" at the plant.

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table settings (
  key text primary key,
  value text not null
);

create or replace function setting_num(k text, dflt numeric) returns numeric language sql stable as $$
  select coalesce((select value::numeric from settings where key = k), dflt)
$$;

create or replace function plant_now() returns timestamp language sql stable as $$
  select (now() at time zone coalesce((select value from settings where key = 'timezone'), 'UTC'))::timestamp(0)
$$;

create table areas (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  hazard_notes text,                   -- e.g. 'ammonia refrigeration, steam boilers'
  status text not null default 'active' check (status in ('active', 'shut', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text not null default 'operator' check (role in ('operator', 'shift_lead', 'supervisor', 'manager', 'engineer', 'maintenance')),
  crew text,                           -- 'A', 'B', 'C', 'D', or null for day staff
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'leave', 'left')),
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A person is signed off to work an area until the sign-off lapses.
create table competencies (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id),
  area_id uuid not null references areas(id),
  signed_off_on date not null,
  expires_on date,
  signed_off_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, area_id)
);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  area_id uuid not null references areas(id),
  kind text not null check (kind in ('day', 'night', 'other')),
  crew text,
  starts_at timestamp not null,
  ends_at timestamp not null check (ends_at > starts_at),
  lead_id uuid not null references people(id),
  status text not null default 'open' check (status in ('planned', 'open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shift_people (
  shift_id uuid not null references shifts(id) on delete cascade,
  person_id uuid not null references people(id),
  position text,                       -- 'panel', 'field', 'boiler', ...
  primary key (shift_id, person_id)
);

-- A manager's recorded decision to let a person work a shift past the fatigue limits.
create table fatigue_exceptions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id),
  for_date date not null,
  approved_by text not null,
  reason text not null,
  used_shift_id uuid references shifts(id),
  created_at timestamptz not null default now()
);

create table log_entries (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  area_id uuid not null references areas(id),
  shift_id uuid references shifts(id),
  person_id uuid references people(id),
  logged_at timestamp not null,
  category text not null default 'note' check (category in ('event', 'alarm', 'trip', 'equipment', 'process', 'safety', 'environmental', 'quality', 'instruction', 'note')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  equipment_tag text,
  title text not null,
  body text,
  carry_forward boolean not null default false,  -- stays on every handover until closed
  closed_at timestamp,
  injury boolean not null default false,
  notifiable boolean not null default false,     -- a notifiable event under HSWA or the WHS Act
  notified_at timestamp,
  regulator_ref text,
  site_preserved_until timestamp,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table actions (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  log_entry_id uuid references log_entries(id),
  area_id uuid not null references areas(id),
  title text not null,
  owner_id uuid references people(id),
  due_on date,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  done_at timestamp,
  done_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table standing_orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  area_id uuid references areas(id),   -- null: every area
  title text not null,
  instruction text not null,
  issued_by uuid not null references people(id),
  approved_by uuid references people(id),
  effective_from timestamp not null,
  expires_on date,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  withdrawn_at timestamp,
  withdrawn_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_acks (
  standing_order_id uuid not null references standing_orders(id) on delete cascade,
  person_id uuid not null references people(id),
  acked_at timestamp not null,
  primary key (standing_order_id, person_id)
);

-- Alarm inhibits, trip bypasses, interlock overrides and forced signals.
create table bypasses (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  area_id uuid not null references areas(id),
  tag text not null,
  description text not null,
  kind text not null check (kind in ('alarm_inhibit', 'trip_bypass', 'interlock_override', 'forced_signal')),
  safety_critical boolean not null default false,
  reason text not null,
  applied_by uuid references people(id),
  authorised_by uuid not null references people(id),
  applied_at timestamp not null,
  authorised_until timestamp not null,
  risk_assessment_ref text,
  extended_count int not null default 0,
  removed_at timestamp,
  removed_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (authorised_until > applied_at)
);

create table round_routes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  area_id uuid not null references areas(id),
  every_hours int not null check (every_hours > 0),
  first_at time not null default '02:00',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table checkpoints (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references round_routes(id),
  seq int not null,
  tag text not null unique,
  description text not null,
  unit text,
  alarm_low numeric,                   -- outside the alarm band: log it and say why
  alarm_high numeric,
  sol_low numeric,                     -- outside the safe operating limit: act now
  sol_high numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_id, seq)
);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  route_id uuid not null references round_routes(id),
  due_at timestamp not null,
  done_at timestamp,
  done_by uuid references people(id),
  shift_id uuid references shifts(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_id, due_at)
);

create table readings (
  id uuid primary key default gen_random_uuid(),
  round_id uuid references rounds(id) on delete cascade,
  checkpoint_id uuid not null references checkpoints(id),
  value numeric not null,
  recorded_at timestamp not null,
  recorded_by uuid references people(id),
  log_entry_id uuid references log_entries(id),   -- the entry that explains an excursion
  note text,
  created_at timestamptz not null default now()
);

-- One handover per outgoing shift. items is the snapshot the outgoing lead
-- handed over: carry-forward entries, bypasses, standing orders, rounds,
-- excursions and open actions, as they stood when it was given.
create table handovers (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references shifts(id),
  given_by uuid not null references people(id),
  given_at timestamp not null,
  summary text,
  items jsonb not null default '{}'::jsonb,
  incoming_shift_id uuid references shifts(id),
  accepted_by uuid references people(id),
  accepted_at timestamp,
  face_to_face boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null,
  target_id uuid,
  target_label text,
  body text not null,
  created_at timestamptz not null default now()
);

create index on log_entries (area_id, logged_at);
create index on shifts (area_id, starts_at);
create index on readings (checkpoint_id, recorded_at);
create index on rounds (route_id, due_at);

do $$
declare t text;
begin
  foreach t in array array['areas', 'people', 'competencies', 'shifts', 'log_entries', 'actions', 'standing_orders', 'bypasses', 'round_routes', 'checkpoints', 'rounds', 'handovers'] loop
    execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

insert into settings (key, value) values
  ('timezone', 'Pacific/Auckland'),
  ('handover_grace_minutes', '30'),       -- house: the next lead accepts within 30 minutes of shift end
  ('round_grace_minutes', '60'),          -- house: a round more than an hour late is missed
  ('bypass_max_hours', '12'),             -- house: a safety-critical bypass is authorised a shift at a time
  ('bypass_extensions_without_ra', '1'),  -- house: a second extension needs a risk assessment reference
  ('order_max_days', '90'),               -- house: every standing order expires within 90 days
  ('max_consecutive_shifts', '7'),        -- house fatigue limits, after Safe Work Australia and WorkSafe guidance
  ('min_rest_hours', '10'),
  ('max_hours_7_days', '60'),
  ('competency_due_days', '30')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Views

-- Each reading against its checkpoint's limits.
create view v_readings as
select rd.id as reading_id, rd.recorded_at, rd.value, rd.note, rd.log_entry_id, rd.round_id,
  cp.id as checkpoint_id, cp.tag, cp.description, cp.unit, cp.alarm_low, cp.alarm_high, cp.sol_low, cp.sol_high,
  rr.code as route, a.id as area_id, a.code as area, p.name as recorded_by,
  case
    when (cp.sol_low is not null and rd.value < cp.sol_low) or (cp.sol_high is not null and rd.value > cp.sol_high) then 'sol'
    when (cp.alarm_low is not null and rd.value < cp.alarm_low) or (cp.alarm_high is not null and rd.value > cp.alarm_high) then 'alarm'
    else 'ok'
  end as band,
  le.ref as explained_by
from readings rd
join checkpoints cp on cp.id = rd.checkpoint_id
join round_routes rr on rr.id = cp.route_id
join areas a on a.id = rr.area_id
left join people p on p.id = rd.recorded_by
left join log_entries le on le.id = rd.log_entry_id;

create view v_excursions as
select * from v_readings where band <> 'ok';

create view v_rounds as
select r.id, r.ref, rr.code as route, rr.name as route_name, a.id as area_id, a.code as area, r.due_at, r.done_at, p.name as done_by, r.note,
  case
    when r.done_at is not null and r.done_at > r.due_at + make_interval(mins => setting_num('round_grace_minutes', 60)::int) then 'late'
    when r.done_at is not null then 'done'
    when plant_now() > r.due_at + make_interval(mins => setting_num('round_grace_minutes', 60)::int) then 'missed'
    when plant_now() >= r.due_at then 'due'
    else 'ahead'
  end as state,
  (select count(*) from readings x where x.round_id = r.id) as readings,
  (select count(*) from checkpoints c where c.route_id = rr.id) as checkpoints
from rounds r
join round_routes rr on rr.id = r.route_id
join areas a on a.id = rr.area_id
left join people p on p.id = r.done_by;

create view v_bypasses as
select b.id, b.ref, a.id as area_id, a.code as area, b.tag, b.description, b.kind, b.safety_critical, b.reason,
  ap.name as applied_by, au.name as authorised_by, b.applied_at, b.authorised_until, b.risk_assessment_ref, b.extended_count,
  b.removed_at, rp.name as removed_by,
  round(extract(epoch from (coalesce(b.removed_at, plant_now()) - b.applied_at)) / 3600.0, 1) as hours_on,
  (b.removed_at is null) as active,
  (b.removed_at is null and plant_now() > b.authorised_until) as overdue
from bypasses b
join areas a on a.id = b.area_id
left join people ap on ap.id = b.applied_by
join people au on au.id = b.authorised_by
left join people rp on rp.id = b.removed_by;

create view v_standing_orders as
select so.id, so.ref, so.area_id, coalesce(a.code, 'ALL') as area, so.title, so.instruction, ib.name as issued_by, ab.name as approved_by,
  so.effective_from, so.expires_on, so.status,
  (so.status = 'active' and so.expires_on is not null and so.expires_on < plant_now()::date) as expired,
  (select count(*) from order_acks k where k.standing_order_id = so.id) as acks
from standing_orders so
left join areas a on a.id = so.area_id
join people ib on ib.id = so.issued_by
left join people ab on ab.id = so.approved_by;

-- Everyone who has worked a shift on an order's area since it took effect,
-- and has not acknowledged it.
create view v_unacked as
select distinct so.id as order_id, so.ref, so.title, coalesce(a.code, 'ALL') as area, p.id as person_id, p.name as person,
  min(sh.starts_at) over (partition by so.id, p.id) as first_shift_since,
  count(*) over (partition by so.id, p.id) as shifts_since
from standing_orders so
left join areas a on a.id = so.area_id
join shifts sh on (so.area_id is null or sh.area_id = so.area_id) and sh.starts_at >= so.effective_from and sh.starts_at <= plant_now()
join (select shift_id, person_id from shift_people union select id, lead_id from shifts) sp on sp.shift_id = sh.id
join people p on p.id = sp.person_id
where so.status = 'active'
  and not exists (select 1 from order_acks k where k.standing_order_id = so.id and k.person_id = p.id);

create view v_shifts as
select sh.id, sh.ref, a.id as area_id, a.code as area, sh.kind, sh.crew, sh.starts_at, sh.ends_at, l.name as lead, sh.status,
  h.id as handover_id, h.given_at, gb.name as given_by, h.accepted_at, ab.name as accepted_by, h.face_to_face,
  case
    when h.id is null and sh.ends_at <= plant_now() then 'missing'
    when h.id is null then 'not due'
    when h.accepted_at is null then 'not accepted'
    when h.accepted_at > sh.ends_at + make_interval(mins => setting_num('handover_grace_minutes', 30)::int) then 'late'
    else 'accepted'
  end as handover,
  (select count(*) from log_entries le where le.shift_id = sh.id) as entries
from shifts sh
join areas a on a.id = sh.area_id
join people l on l.id = sh.lead_id
left join handovers h on h.shift_id = sh.id
left join people gb on gb.id = h.given_by
left join people ab on ab.id = h.accepted_by;

-- Every person on every shift, with hours.
create view v_worked as
select p.id as person_id, p.name as person, p.crew, sh.id as shift_id, sh.ref, sh.area_id, sh.starts_at, sh.ends_at,
  round(extract(epoch from (sh.ends_at - sh.starts_at)) / 3600.0, 1) as hours
from shifts sh
join (select shift_id, person_id from shift_people union select id, lead_id from shifts) sp on sp.shift_id = sh.id
join people p on p.id = sp.person_id;

-- Fatigue: hours in the last 7 days, consecutive shifts ending at the latest,
-- and the shortest rest between two shifts in the last 7 days.
create view v_fatigue as
with w as (
  select person_id, person, crew, starts_at, ends_at, hours,
    lag(ends_at) over (partition by person_id order by starts_at) as prev_end
  from (select distinct person_id, person, crew, shift_id, starts_at, ends_at, hours from v_worked where starts_at <= plant_now()) x
),
g as (
  select *, sum(case when prev_end is null or starts_at - prev_end > interval '30 hours' then 1 else 0 end)
    over (partition by person_id order by starts_at) as run_no
  from w
),
last_run as (
  select person_id, count(*) as consecutive
  from g where (person_id, run_no) in (select person_id, max(run_no) from g group by person_id)
  group by person_id
)
select p.id as person_id, p.name as person, p.crew,
  coalesce((select sum(hours) from w where w.person_id = p.id and w.starts_at > plant_now() - interval '7 days'), 0) as hours_7_days,
  coalesce(lr.consecutive, 0) as consecutive_shifts,
  (select round(min(extract(epoch from (starts_at - prev_end)) / 3600.0), 1) from w where w.person_id = p.id and w.prev_end is not null and w.starts_at > plant_now() - interval '7 days') as min_rest_hours,
  (select max(ends_at) from w where w.person_id = p.id and w.starts_at <= plant_now()) as last_shift_end
from people p
left join last_run lr on lr.person_id = p.id
where p.status = 'active';

-- Anyone on a shift without a current sign-off for that area on the day.
create view v_competency_gaps as
select distinct vw.ref, vw.shift_id, vw.starts_at, a.code as area, vw.person,
  c.expires_on, case when c.id is null then 'never signed off' else 'sign-off lapsed ' || c.expires_on end as why
from v_worked vw
join areas a on a.id = vw.area_id
left join competencies c on c.person_id = vw.person_id and c.area_id = vw.area_id
where c.id is null or c.signed_off_on > vw.starts_at::date or (c.expires_on is not null and c.expires_on < vw.starts_at::date);

create view v_actions as
select ac.id, ac.ref, a.code as area, ac.title, p.name as owner, ac.due_on, ac.status, ac.done_at, le.ref as from_entry,
  (ac.status = 'open' and ac.due_on < plant_now()::date) as overdue,
  case when ac.status = 'open' and ac.due_on is not null then plant_now()::date - ac.due_on end as days_overdue
from actions ac
join areas a on a.id = ac.area_id
left join people p on p.id = ac.owner_id
left join log_entries le on le.id = ac.log_entry_id;

create view v_entries as
select le.id, le.ref, a.code as area, a.id as area_id, sh.ref as shift, p.name as by_person, le.logged_at, le.category, le.priority,
  le.equipment_tag, le.title, le.body, le.carry_forward, le.closed_at, le.injury, le.notifiable, le.notified_at, le.regulator_ref,
  (le.carry_forward and le.closed_at is null) as open_carry
from log_entries le
join areas a on a.id = le.area_id
left join shifts sh on sh.id = le.shift_id
left join people p on p.id = le.person_id;

create view v_attention as
select 1 as rank, 'notifiable' as reason, ref as label, 'Notifiable event logged ' || to_char(logged_at, 'DD Mon HH24:MI') || ', regulator not told: ' || title as detail, area, logged_at as since
  from v_entries where notifiable and notified_at is null
union all
select 2, 'bypass_overdue', ref, tag || ' ' || replace(kind, '_', ' ') || ' past its authority (' || to_char(authorised_until, 'DD Mon HH24:MI') || ')' || case when safety_critical then ', safety critical' else '' end, area, authorised_until
  from v_bypasses where overdue
union all
select 3, 'sol_excursion', tag, tag || ' read ' || value || coalesce(' ' || unit, '') || ' outside the safe operating limit' || case when explained_by is null then ', nothing logged' else ', see ' || explained_by end, area, recorded_at
  from v_excursions where band = 'sol' and recorded_at > plant_now() - interval '72 hours'
union all
select 4, 'handover_open', ref, 'Handover ' || handover || ' (' || area || ' ' || kind || ' ending ' || to_char(ends_at, 'DD Mon HH24:MI') || ', lead ' || lead || ')', area, ends_at
  from v_shifts where handover in ('missing', 'not accepted') and ends_at > plant_now() - interval '14 days'
union all
select 5, 'competency', person, person || ' worked ' || count(*) || ' shift(s) on ' || area || ' with ' || min(why) || ', latest ' || max(ref), area, min(starts_at)
  from v_competency_gaps where starts_at > plant_now() - interval '14 days' and starts_at <= plant_now() group by person, area
union all
select 6, 'fatigue', person, person || ': ' || consecutive_shifts || ' shifts in a row, ' || hours_7_days || ' h in 7 days, shortest rest ' || coalesce(min_rest_hours::text, '-') || ' h', null, last_shift_end
  from v_fatigue where consecutive_shifts > setting_num('max_consecutive_shifts', 7) or hours_7_days > setting_num('max_hours_7_days', 60) or min_rest_hours < setting_num('min_rest_hours', 10)
union all
select 7, 'round_missed', ref, route || ' round due ' || to_char(due_at, 'DD Mon HH24:MI') || ' not done', area, due_at
  from v_rounds where state = 'missed' and due_at > plant_now() - interval '72 hours'
union all
select 8, 'unexplained', tag, tag || ' read ' || value || coalesce(' ' || unit, '') || ' outside the alarm band, nothing logged', area, recorded_at
  from v_excursions where band = 'alarm' and log_entry_id is null and recorded_at > plant_now() - interval '72 hours'
union all
select 9, 'unacked', ref, person || ' has worked ' || shifts_since || ' shift(s) on ' || area || ' without acknowledging "' || title || '"', area, first_shift_since
  from v_unacked
union all
select 10, 'order_expired', ref, '"' || title || '" expired ' || expires_on || ' and is still active', area, expires_on::timestamp
  from v_standing_orders where expired
union all
select 11, 'action_overdue', ref, title || ' (' || coalesce(owner, 'no owner') || ', due ' || to_char(due_on, 'DD Mon') || ')', area, due_on::timestamp
  from v_actions where overdue;
