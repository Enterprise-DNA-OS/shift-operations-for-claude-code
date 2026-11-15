-- Demo data: Kaimai Valley Dairy, a milk powder plant near Matamata, Waikato.
-- Three operating areas (the powder plant, the utilities with its boilers and
-- ammonia refrigeration, and wastewater treatment), four crews on twelve-hour
-- shifts (two days, two nights, four off), and fourteen days of history.
--
-- Every time is relative to plant_now(), so the demo always has something to
-- say: a steam burn logged as notifiable with the regulator not yet told, a
-- safety-critical trip bypass past its authority (and left off one handover),
-- a boiler drum level below its safe operating limit, last shift's utilities
-- handover given but not accepted, a wastewater handover never given, a
-- standing order two operators have not read, an expired order still in force,
-- an operator whose ammonia sign-off lapsed and who kept working the area, an
-- operator who went straight from a day shift onto a night shift, a missed
-- round, a dryer temperature outside its alarm band with nothing logged, and
-- overdue actions.
-- Idempotent: a second run does nothing.

do $seed$
declare
  d0 date;
  nowp timestamp;
  i int;
  k int;
  c text;
  crews text[] := array['A', 'B', 'C', 'D'];
  a record;
  sh record;
  rr record;
  cp record;
  sid uuid;
  lead uuid;
  shift_n int := 5000;
  log_n int := 20000;
  rnd_n int := 70000;
  rid uuid;
  due timestamp;
  v numeric;
  mid numeric;
  amp numeric;
  pool text[];
  pick text;
  parts text[];
  nxt uuid;
  byp301 uuid;
  le uuid;
  p_mere uuid; p_steve uuid; p_nikhil uuid; p_craig uuid;
  a_pwd uuid; a_utl uuid; a_wwt uuid;
begin
  if exists (select 1 from areas where code = 'PWD') then
    return;
  end if;

  nowp := plant_now();
  d0 := nowp::date;

  insert into settings (key, value) values ('business_name', 'Kaimai Valley Dairy') on conflict (key) do update set value = excluded.value;

  insert into areas (code, name, description, hazard_notes) values
    ('PWD', 'Powder plant', 'Evaporator 1 and Dryer 1, bag filters, powder handling and packing', 'Combustible dust, hot surfaces, CIP chemicals'),
    ('UTL', 'Utilities', 'Boilers 1 and 2, ammonia refrigeration, compressed air, cooling towers', 'Steam at 18 bar, anhydrous ammonia (3.2 t charge)'),
    ('WWT', 'Wastewater treatment', 'Dissolved air flotation, aeration basin, sludge press, discharge to the Waihou catchment under resource consent', 'Biogas, confined spaces, caustic and acid dosing');
  select id into a_pwd from areas where code = 'PWD';
  select id into a_utl from areas where code = 'UTL';
  select id into a_wwt from areas where code = 'WWT';

  insert into people (name, role, crew, email) values
    ('Aroha Wiremu', 'shift_lead', 'A', 'aroha.wiremu@kaimaidairy.example'),
    ('Ben Carter', 'operator', 'A', null), ('Sione Taufa', 'operator', 'A', null), ('Priya Nair', 'operator', 'A', null),
    ('Hemi Walker', 'shift_lead', 'B', 'hemi.walker@kaimaidairy.example'),
    ('Jack Thompson', 'operator', 'B', null), ('Mei Lin Chen', 'operator', 'B', null), ('Tom Evans', 'operator', 'B', null),
    ('Rachel Morgan', 'shift_lead', 'C', 'rachel.morgan@kaimaidairy.example'),
    ('Tama Ngata', 'operator', 'C', null), ('Liam O''Brien', 'operator', 'C', null), ('Anika Patel', 'operator', 'C', null),
    ('Daniel Kim', 'shift_lead', 'D', 'daniel.kim@kaimaidairy.example'),
    ('Kahu Rangi', 'operator', 'D', null), ('Grace Wilson', 'operator', 'D', null), ('Luke Hughes', 'operator', 'D', null),
    ('Mere Tane', 'supervisor', null, 'mere.tane@kaimaidairy.example'),
    ('Steve Bishop', 'manager', null, 'steve.bishop@kaimaidairy.example'),
    ('Nikhil Rao', 'engineer', null, 'nikhil.rao@kaimaidairy.example'),
    ('Craig Dunn', 'maintenance', null, 'craig.dunn@kaimaidairy.example');
  select id into p_mere from people where name = 'Mere Tane';
  select id into p_steve from people where name = 'Steve Bishop';
  select id into p_nikhil from people where name = 'Nikhil Rao';
  select id into p_craig from people where name = 'Craig Dunn';

  -- Crew positions: [PWD lead, UTL, WWT, PWD field].
  create temp table crew_pos (crew text, area text, person text, position text) on commit drop;
  insert into crew_pos values
    ('A', 'PWD', 'Aroha Wiremu', 'panel'), ('A', 'UTL', 'Ben Carter', 'boiler house'), ('A', 'WWT', 'Sione Taufa', 'plant'), ('A', 'PWD', 'Priya Nair', 'field'),
    ('B', 'PWD', 'Hemi Walker', 'panel'), ('B', 'UTL', 'Jack Thompson', 'boiler house'), ('B', 'WWT', 'Mei Lin Chen', 'plant'), ('B', 'PWD', 'Tom Evans', 'field'),
    ('C', 'PWD', 'Rachel Morgan', 'panel'), ('C', 'UTL', 'Tama Ngata', 'boiler house'), ('C', 'WWT', 'Liam O''Brien', 'plant'), ('C', 'PWD', 'Anika Patel', 'field'),
    ('D', 'PWD', 'Daniel Kim', 'panel'), ('D', 'UTL', 'Kahu Rangi', 'boiler house'), ('D', 'WWT', 'Grace Wilson', 'plant'), ('D', 'PWD', 'Luke Hughes', 'field');

  -- Sign-offs: everyone for their own area, two years, with three exceptions.
  insert into competencies (person_id, area_id, signed_off_on, expires_on, signed_off_by)
  select p.id, ar.id, d0 - 400 + (hashtext(p.name) % 60), d0 - 400 + (hashtext(p.name) % 60) + 730, 'Mere Tane'
  from crew_pos cp2 join people p on p.name = cp2.person join areas ar on ar.code = cp2.area
  on conflict do nothing;
  update competencies set expires_on = d0 - 10 where person_id = (select id from people where name = 'Tama Ngata') and area_id = a_utl;
  update competencies set expires_on = d0 + 20 where person_id = (select id from people where name = 'Grace Wilson') and area_id = a_wwt;
  insert into competencies (person_id, area_id, signed_off_on, expires_on, signed_off_by)
    select id, a_pwd, d0 - 200, d0 + 530, 'Mere Tane' from people where name = 'Jack Thompson';
  insert into competencies (person_id, area_id, signed_off_on, expires_on, signed_off_by)
    select p.id, ar.id, d0 - 300, d0 + 430, 'Steve Bishop' from people p cross join areas ar where p.name in ('Mere Tane', 'Nikhil Rao');

  -- Shifts: day 06:00 to 18:00, night 18:00 to 06:00. Crew k works days on
  -- cycle days 0 and 1 and nights on 2 and 3 of an eight-day cycle.
  for i in -14..1 loop
    for k in 0..3 loop
      c := crews[k + 1];
      for a in select * from areas order by code loop
        if ((i - 2 * k) % 8 + 8) % 8 in (0, 1, 2, 3) then
          shift_n := shift_n + 1;
          select p.id into lead from crew_pos cp2 join people p on p.name = cp2.person
            where cp2.crew = c and cp2.area = a.code and cp2.position <> 'field';
          insert into shifts (ref, area_id, kind, crew, starts_at, ends_at, lead_id, status)
          values ('SH-' || shift_n, a.id,
            case when ((i - 2 * k) % 8 + 8) % 8 in (0, 1) then 'day' else 'night' end, c,
            (d0 + i) + case when ((i - 2 * k) % 8 + 8) % 8 in (0, 1) then time '06:00' else time '18:00' end,
            (d0 + i) + case when ((i - 2 * k) % 8 + 8) % 8 in (0, 1) then time '18:00' else time '18:00' end + case when ((i - 2 * k) % 8 + 8) % 8 in (0, 1) then interval '0' else interval '12 hours' end,
            lead, 'planned')
          returning id into sid;
          insert into shift_people (shift_id, person_id, position)
            select sid, p.id, cp2.position from crew_pos cp2 join people p on p.name = cp2.person
            where cp2.crew = c and cp2.area = a.code;
        end if;
      end loop;
    end loop;
  end loop;
  update shifts set status = case when ends_at <= nowp then 'closed' when starts_at <= nowp then 'open' else 'planned' end;

  -- Jack Thompson (crew B, utilities) covered a powder plant night straight
  -- after his own day shift: no rest at all between them.
  select s.id into sid from shifts s join areas ar on ar.id = s.area_id
    where s.crew = 'B' and ar.code = 'UTL' and s.kind = 'day' and s.ends_at <= nowp - interval '24 hours'
    order by s.starts_at desc limit 1;
  insert into shift_people (shift_id, person_id, position)
    select s2.id, (select id from people where name = 'Jack Thompson'), 'field cover'
    from shifts s1 join shifts s2 on s2.starts_at = s1.ends_at and s2.area_id = a_pwd
    where s1.id = sid
    limit 1;

  -- The logbook: two to four entries a shift, from each area's ordinary week.
  for sh in select s.*, ar.code as area_code from shifts s join areas ar on ar.id = s.area_id where s.starts_at <= nowp order by s.starts_at loop
    pool := case sh.area_code
      when 'PWD' then array[
        'process|normal|EVP1|Evaporator 1 on product, 52 % solids at the finisher',
        'process|normal|DRY1|Dryer 1 at 10.2 t/h, outlet 88 C, moisture 3.1 %',
        'equipment|normal|BF-330|Bag filter 330 pulse cleaning cycle checked, dP steady',
        'quality|normal|PACK|Lab hold on bag lot 4471 released after retest',
        'event|normal|CIP|Evaporator 1 CIP complete, caustic 1.6 %, rinse conductivity clean',
        'equipment|low|PACK|Bagging line 2 sealer jaw replaced by maintenance',
        'alarm|normal|DRY1|Dryer 1 inlet air high temperature alarm, cleared on damper reset',
        'note|low|PWD|Contractor induction for packing hall lighting, permit 2231 issued'
      ]
      when 'UTL' then array[
        'process|normal|BLR1|Boiler 1 on line at 14 t/h steam, Boiler 2 standby hot',
        'equipment|normal|NH3|Ammonia compressor 3 oil changed, returned to auto',
        'process|normal|AIR|Compressed air dew point -38 C, dryer B in service',
        'event|normal|BLR2|Boiler 2 blowdown completed, TDS 2,400 ppm',
        'equipment|low|CT1|Cooling tower 1 fan vibration reading taken, within limits',
        'alarm|normal|NH3|Engine room ammonia detector low alarm 25 ppm at valve station 4, leak found on a gland and nipped up',
        'note|low|UTL|Water treatment chemical delivery received, 2 IBCs to bund 3'
      ]
      else array[
        'process|normal|DAF|DAF float removal steady, outlet COD 410 mg/L',
        'process|normal|AER|Aeration basin DO 2.1 mg/L, blowers 1 and 3 running',
        'equipment|normal|PRESS|Sludge press belt tracking adjusted, cake 18 % dry solids',
        'environmental|normal|DISCH|Discharge composite sample taken for the consent laboratory',
        'event|low|DOSE|Caustic day tank topped up from bulk',
        'alarm|normal|PH|Equalisation tank pH high alarm 10.4 during CIP dump, dosing caught it'
      ]
    end;
    for k in 0..(2 + abs(hashtext(sh.ref)) % 3) - 1 loop
      pick := pool[1 + (abs(hashtext(sh.ref)) + k * 3) % array_length(pool, 1)];
      parts := string_to_array(pick, '|');
      log_n := log_n + 1;
      insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title)
      values ('LOG-' || log_n, sh.area_id, sh.id,
        case when k % 2 = 0 then sh.lead_id else coalesce((select person_id from shift_people where shift_id = sh.id and person_id <> sh.lead_id limit 1), sh.lead_id) end,
        least(sh.starts_at + make_interval(hours => 1 + k * 3, mins => abs(hashtext(sh.ref || 'm' || k)) % 50), nowp - interval '5 minutes'),
        parts[1], parts[2], parts[3], parts[4]);
    end loop;
  end loop;

  -- The entries that matter.
  -- A steam burn two days ago: logged as notifiable, the regulator not told.
  select s.* into sh from shifts s where s.area_id = a_utl and s.starts_at <= nowp - interval '44 hours' order by s.starts_at desc limit 1;
  log_n := log_n + 1;
  insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title, body, injury, notifiable, carry_forward)
  values ('LOG-' || log_n, a_utl, sh.id, sh.lead_id, sh.starts_at + interval '4 hours 20 minutes', 'safety', 'high', 'BLR2',
    'Steam burn to forearm at Boiler 2 sight glass, operator taken to Waikato Hospital emergency department',
    'Gasket on the Boiler 2 level gauge glass failed while it was being blown down. Area barricaded, gauge glass isolated. Operator admitted for treatment of a burn to the right forearm. Supervisor called.',
    true, true, true);
  insert into actions (ref, log_entry_id, area_id, title, owner_id, due_on)
  values ('ACT-801', (select id from log_entries where ref = 'LOG-' || log_n), a_utl, 'Replace Boiler 2 gauge glass gaskets and add a shield to the sight glass', p_craig, d0 + 3);

  -- An old injury properly notified.
  log_n := log_n + 1;
  insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title, injury, notifiable, notified_at, regulator_ref)
  select 'LOG-' || log_n, a_pwd, s.id, s.lead_id, s.starts_at + interval '3 hours', 'safety', 'high', 'PACK',
    'Forklift struck racking in the powder store, racking upright buckled, store closed', false, true, s.starts_at + interval '4 hours', 'WorkSafe notification 2026-NE-04417'
  from shifts s where s.area_id = a_pwd and s.starts_at <= nowp - interval '11 days' order by s.starts_at desc limit 1;

  -- Boiler 2 drum level below its safe operating limit 30 hours ago, explained.
  log_n := log_n + 1;
  select s.* into sh from shifts s where s.area_id = a_utl and s.starts_at <= nowp - interval '30 hours' order by s.starts_at desc limit 1;
  insert into log_entries (ref, area_id, shift_id, person_id, logged_at, category, priority, equipment_tag, title, body, carry_forward)
  values ('LOG-' || log_n, a_utl, sh.id, sh.lead_id, nowp - interval '30 hours' + interval '10 minutes', 'trip', 'high', 'BLR2',
    'Boiler 2 low drum level: feedwater pump B tripped, level fell to 17 %, Boiler 2 tripped on low-low and was relit on pump A',
    'Feedwater pump B motor overload tripped twice. Pump B left in hand under standing order SO-101 until the motor is tested.', true);
  le := (select id from log_entries where ref = 'LOG-' || log_n);
  insert into actions (ref, log_entry_id, area_id, title, owner_id, due_on)
  values ('ACT-802', le, a_utl, 'Megger and overload test feedwater pump B motor', p_craig, d0 - 1);

  insert into actions (ref, area_id, title, owner_id, due_on, status, done_at, done_note) values
    ('ACT-790', a_pwd, 'Replace Dryer 1 bag filter 330 bags (row C)', p_craig, d0 + 9, 'open', null, null),
    ('ACT-791', a_wwt, 'Recalibrate aeration basin DO probe 2', (select id from people where name = 'Grace Wilson'), d0 - 6, 'open', null, null),
    ('ACT-792', a_pwd, 'Update the Dryer 1 start-up procedure after the reduced-rate trial', p_nikhil, d0 + 14, 'open', null, null),
    ('ACT-785', a_utl, 'Engine room ammonia detector bump test', p_craig, d0 - 12, 'done', d0 - 13 + time '10:00', 'All six heads within 10 % of the test gas');

  -- Standing orders.
  insert into standing_orders (ref, area_id, title, instruction, issued_by, approved_by, effective_from, expires_on) values
    ('SO-101', a_utl, 'Feedwater pump B in hand: check Boiler 2 drum level every hour',
      'Feedwater pump B stays in hand until maintenance clears the motor. Check the Boiler 2 drum level gauge glass and the panel reading every hour and log both. If they disagree by more than 5 %, take Boiler 2 off line.',
      p_mere, p_steve, nowp - interval '28 hours', d0 + 7),
    ('SO-102', null, 'No hot work in the dryer building during CIP week without the supervisor''s sign-off',
      'During the dryer CIP week no hot work permit is issued for the dryer building unless the operations supervisor has signed the permit as well as the issuer.',
      p_mere, p_steve, d0 - 19 + time '06:00', d0 - 5),
    ('SO-103', a_pwd, 'Run Dryer 1 at no more than 9.5 t/h until the row C bags are replaced',
      'Bag filter 330 row C is blinding. Hold Dryer 1 at 9.5 t/h or less and log the bag filter dP every two hours. Do not clear the dP alarm inhibit BYP-302 without the process engineer.',
      p_nikhil, p_mere, d0 - 9 + time '06:00', d0 + 12),
    ('SO-104', a_wwt, 'Sludge press: dose polymer at 4 L/h for the trial',
      'Dose polymer at 4 L/h at the sludge press while the new product is trialled. Log cake dry solids every shift.',
      p_nikhil, p_mere, d0 - 6 + time '06:00', d0 + 21);
  -- Acknowledged by everyone who has worked the area since, except two on SO-101.
  insert into order_acks (standing_order_id, person_id, acked_at)
  select distinct so.id, vw.person_id, vw.starts_at + interval '15 minutes'
  from standing_orders so join v_worked vw on (so.area_id is null or vw.area_id = so.area_id) and vw.starts_at >= so.effective_from and vw.starts_at <= nowp
  where not (so.ref = 'SO-101' and vw.person in ('Kahu Rangi', 'Tama Ngata'))
  on conflict do nothing;
  insert into order_acks (standing_order_id, person_id, acked_at)
    select so.id, p.id, so.effective_from from standing_orders so cross join people p where p.name in ('Mere Tane', 'Steve Bishop') on conflict do nothing;

  -- Bypasses and inhibits.
  insert into bypasses (ref, area_id, tag, description, kind, safety_critical, reason, applied_by, authorised_by, applied_at, authorised_until, removed_at, removed_by) values
    ('BYP-298', a_wwt, 'XS-512', 'Aeration blower 2 low-flow interlock', 'interlock_override', false, 'Blower 2 flow switch replaced, override while it was proved',
      (select id from people where name = 'Mei Lin Chen'), p_mere, nowp - interval '4 days 6 hours', nowp - interval '3 days 22 hours', nowp - interval '3 days 23 hours', (select id from people where name = 'Mei Lin Chen'));
  insert into bypasses (ref, area_id, tag, description, kind, safety_critical, reason, applied_by, authorised_by, applied_at, authorised_until) values
    ('BYP-301', a_utl, 'PSHH-412', 'Ammonia compressor 2 high-high discharge pressure trip', 'trip_bypass', true, 'Pressure transmitter PT-412 being replaced; compressor 2 run on local gauge with an operator in attendance',
      (select id from people where name = 'Kahu Rangi'), p_mere, nowp - interval '20 hours', nowp - interval '8 hours'),
    ('BYP-302', a_pwd, 'PDAH-330', 'Dryer 1 bag filter 330 high differential pressure alarm', 'alarm_inhibit', false, 'Nuisance alarm while row C bags are blinding; dP logged every two hours under SO-103',
      (select id from people where name = 'Daniel Kim'), p_nikhil, nowp - interval '9 hours', nowp + interval '6 hours');
  select id into byp301 from bypasses where ref = 'BYP-301';

  -- Rounds: routes, checkpoints, three days of rounds and readings.
  insert into round_routes (code, name, area_id, every_hours, first_at) values
    ('PWD-R', 'Powder plant field round', a_pwd, 4, '02:00'),
    ('UTL-R', 'Boiler house round', a_utl, 4, '02:00'),
    ('NH3-R', 'Ammonia engine room round', a_utl, 8, '04:00'),
    ('WWT-R', 'Wastewater round', a_wwt, 4, '02:00');
  insert into checkpoints (route_id, seq, tag, description, unit, alarm_low, alarm_high, sol_low, sol_high)
  select rr2.id, x.seq, x.tag, x.descr, x.unit, x.al, x.ah, x.sl, x.sh
  from (values
    ('PWD-R', 1, 'TT-301', 'Dryer 1 outlet air temperature', 'C', 80, 95, 70, 105),
    ('PWD-R', 2, 'PDT-330', 'Bag filter 330 differential pressure', 'kPa', null, 1.8, null, 2.5),
    ('PWD-R', 3, 'AT-305', 'Powder moisture at the sifter', '%', 2.5, 3.8, null, 4.5),
    ('PWD-R', 4, 'FT-110', 'Evaporator 1 feed flow', 'm3/h', 25, 42, 15, 48),
    ('UTL-R', 1, 'LT-201', 'Boiler 1 drum level', '%', 35, 65, 20, 80),
    ('UTL-R', 2, 'LT-202', 'Boiler 2 drum level', '%', 35, 65, 20, 80),
    ('UTL-R', 3, 'PT-210', 'Steam header pressure', 'bar', 15.5, 18.0, 12.0, 19.0),
    ('UTL-R', 4, 'AT-215', 'Boiler feedwater conductivity', 'uS/cm', null, 60, null, 100),
    ('NH3-R', 1, 'PT-411', 'Ammonia compressor 1 discharge pressure', 'kPa', 900, 1350, null, 1550),
    ('NH3-R', 2, 'PT-412', 'Ammonia compressor 2 discharge pressure (local gauge)', 'kPa', 900, 1350, null, 1550),
    ('NH3-R', 3, 'AIT-420', 'Engine room ammonia detector, highest head', 'ppm', null, 25, null, 150),
    ('WWT-R', 1, 'AIT-501', 'Aeration basin dissolved oxygen', 'mg/L', 1.5, 3.5, 0.8, null),
    ('WWT-R', 2, 'AIT-520', 'Final discharge pH', 'pH', 6.5, 8.5, 6.0, 9.0),
    ('WWT-R', 3, 'FT-530', 'Final discharge flow', 'm3/h', null, 140, null, 160),
    ('WWT-R', 4, 'AIT-525', 'Final discharge turbidity', 'NTU', null, 25, null, 40)
  ) as x(route, seq, tag, descr, unit, al, ah, sl, sh)
  join round_routes rr2 on rr2.code = x.route;

  for rr in select * from round_routes loop
    due := (d0 - 3) + rr.first_at;
    while due <= nowp + interval '8 hours' loop
      rnd_n := rnd_n + 1;
      select s.* into sh from shifts s where s.area_id = rr.area_id and s.starts_at <= due and s.ends_at > due limit 1;
      insert into rounds (ref, route_id, due_at, shift_id, done_at, done_by)
      values ('RND-' || rnd_n, rr.id, due, sh.id,
        case when due + interval '20 minutes' <= nowp then due + make_interval(mins => 5 + abs(hashtext(rr.code || due::text)) % 35) end,
        case when due + interval '20 minutes' <= nowp then coalesce((select person_id from shift_people where shift_id = sh.id and position = 'field' limit 1), sh.lead_id) end)
      returning id into rid;
      if due + interval '20 minutes' <= nowp then
        for cp in select * from checkpoints where route_id = rr.id loop
          if cp.alarm_low is not null and cp.alarm_high is not null then
            mid := (cp.alarm_low + cp.alarm_high) / 2; amp := (cp.alarm_high - cp.alarm_low) * 0.3;
          elsif cp.alarm_high is not null then
            mid := cp.alarm_high * 0.6; amp := cp.alarm_high * 0.2;
          else
            mid := cp.alarm_low * 1.5; amp := cp.alarm_low * 0.3;
          end if;
          v := round((mid + amp * sin(abs(hashtext(cp.tag || due::text)) % 628 / 100.0))::numeric, 2);
          insert into readings (round_id, checkpoint_id, value, recorded_at, recorded_by)
          values (rid, cp.id, v, due + interval '10 minutes', coalesce((select person_id from shift_people where shift_id = sh.id and position = 'field' limit 1), sh.lead_id));
        end loop;
      end if;
      due := due + make_interval(hours => rr.every_hours);
    end loop;
  end loop;

  -- The Boiler 2 drum level below its safe operating limit, explained by the trip entry.
  update readings set value = 17, log_entry_id = le, note = 'Feedwater pump B tripped'
  where id = (select rd.id from readings rd join checkpoints c2 on c2.id = rd.checkpoint_id where c2.tag = 'LT-202'
              and rd.recorded_at <= nowp - interval '26 hours' order by rd.recorded_at desc limit 1);
  -- Dryer 1 outlet temperature above its alarm band eight hours ago, nothing logged.
  update readings set value = 97.5
  where id = (select rd.id from readings rd join checkpoints c2 on c2.id = rd.checkpoint_id where c2.tag = 'TT-301'
              and rd.recorded_at <= nowp - interval '6 hours' order by rd.recorded_at desc limit 1);
  -- The last wastewater round that is past its grace was missed.
  delete from readings where round_id = (select r.id from rounds r join round_routes x on x.id = r.route_id where x.code = 'WWT-R'
    and r.due_at < nowp - interval '61 minutes' order by r.due_at desc limit 1);
  update rounds set done_at = null, done_by = null
  where id = (select r.id from rounds r join round_routes x on x.id = r.route_id where x.code = 'WWT-R'
    and r.due_at < nowp - interval '61 minutes' order by r.due_at desc limit 1);

  -- Handovers for every closed shift, accepted by the next lead on the same area.
  for sh in select * from shifts where status = 'closed' order by starts_at loop
    select s2.id into nxt from shifts s2 where s2.area_id = sh.area_id and s2.starts_at = sh.ends_at limit 1;
    insert into handovers (shift_id, given_by, given_at, summary, items, incoming_shift_id, accepted_by, accepted_at)
    values (sh.id, sh.lead_id, sh.ends_at - interval '15 minutes',
      'Plant steady. Entries, bypasses and standing orders as listed.',
      jsonb_build_object(
        'carry_forward', coalesce((select jsonb_agg(ref) from log_entries where area_id = sh.area_id and carry_forward and closed_at is null and logged_at <= sh.ends_at), '[]'::jsonb),
        'bypasses', coalesce((select jsonb_agg(ref) from bypasses where area_id = sh.area_id and applied_at <= sh.ends_at and (removed_at is null or removed_at > sh.ends_at)), '[]'::jsonb),
        'standing_orders', coalesce((select jsonb_agg(ref) from standing_orders where (area_id is null or area_id = sh.area_id) and effective_from <= sh.ends_at and status = 'active'), '[]'::jsonb)
      ),
      nxt, (select lead_id from shifts where id = nxt), sh.ends_at + make_interval(mins => 5 + abs(hashtext(sh.ref)) % 15));
  end loop;
  -- Last night's utilities handover was given and never accepted.
  update handovers set accepted_by = null, accepted_at = null
  where shift_id = (select id from shifts where area_id = a_utl and status = 'closed' order by ends_at desc limit 1);
  -- A wastewater handover four days ago was never given.
  delete from handovers where shift_id = (select id from shifts where area_id = a_wwt and status = 'closed' and ends_at <= nowp - interval '4 days' order by ends_at desc limit 1);
  -- A powder plant handover six days ago was accepted late.
  update handovers h set accepted_at = s.ends_at + interval '95 minutes'
  from shifts s where s.id = h.shift_id and h.shift_id = (select id from shifts where area_id = a_pwd and status = 'closed' and ends_at <= nowp - interval '6 days' order by ends_at desc limit 1);
  -- The first utilities handover after BYP-301 went on left it off the list.
  update handovers h set items = jsonb_set(h.items, '{bypasses}', (h.items->'bypasses') - 'BYP-301')
  where h.shift_id = (select s.id from shifts s where s.area_id = a_utl and s.status = 'closed' and s.ends_at > (select applied_at from bypasses where id = byp301) order by s.ends_at limit 1);
end
$seed$;
