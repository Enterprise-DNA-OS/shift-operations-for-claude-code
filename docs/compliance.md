# The rule book

`npm run ops -- compliance` runs eleven checks against the records. Each one is below: the rule, where it comes from, what a breach looks like in the data, what the CLI refuses at the time, and what fixes it.

This is not legal advice. These are the rules a New Zealand or Australian process plant commonly runs its shift operations under, written down so the system can check them. Your own obligations depend on your site, your hazardous substances, whether you are a major hazard facility, and your state or region. Read each source, confirm it applies to you, and change the rule (`/customise`) where your obligation is different. Where a figure is a house rule rather than law, it says so, and it lives in the `settings` table.

## The sources

- **HSE Inspectors Toolkit, Common Topic 3: Safety critical communications** (Health and Safety Executive, Great Britain): https://www.hse.gov.uk/humanfactors/assets/docs/common3.pdf. Recommends giving shift handover high priority, allowing time for it, two-way communication with both giver and receiver responsible, and names "when safety systems have been over-ridden" and maintenance across a shift change as risk situations.
- **Energy Institute, Human Factors Briefing Note No. 10: Communications**: https://publishing.energyinst.org/topics/process-safety/leadership/human-factors-briefing-note-no.-10-communications. Names poor communication at shift handover as a contributor to Piper Alpha, Grangemouth, Texas City and Buncefield, and recommends face-to-face handovers.
- **US Chemical Safety Board, BP Texas City investigation report (2007)**: found two critical miscommunications among operations personnel, no policy for effective shift communication, and no requirement for logbook or procedural records to make sure information reached the crews.
- **Health and Safety at Work Act 2015 (New Zealand)**: https://www.legislation.govt.nz/act/public/2015/0070/latest/. s36(3)(f) (information, training, instruction and supervision), ss23 to 25 (notifiable injury or illness, notifiable incident, notifiable event), s56 (duty to notify WorkSafe), s57 (duty to preserve the site).
- **Work Health and Safety Act 2011 (Australia, model law as adopted by each state)**: s19(3)(f) (information, training, instruction and supervision), ss35 to 37 (notifiable incident, serious injury or illness, dangerous incident), s38 (duty to notify the regulator), s39 (duty to preserve the site). **Work Health and Safety Regulations 2011**, reg 39 (information, training and instruction).
- **IEC 61511-1, Functional safety: safety instrumented systems for the process industry sector**: requires bypasses of safety instrumented functions to be controlled by written procedures, authorised and recorded, with compensating measures while the bypass is in place.
- **Safe Work Australia, Guide for managing the risk of fatigue at work (2013)**, and **WorkSafe New Zealand guidance on fatigue**: shift length, consecutive shifts and the rest between them are the controls. Neither sets a single legal number; the limits here are house limits.

## 1. handover-recorded: every shift is handed over, and the handover accepted

- **Source.** HSE Common Topic 3; Energy Institute Briefing Note 10; CSB Texas City report.
- **Breach.** A shift that ended in the last 30 days with no handover (`missing`) or a handover given and never accepted (`not accepted`).
- **Refused at the time.** `accept` refuses an incoming lead who is not signed off for the area or has not acknowledged a standing order in force there.
- **Fix.** `handover <area|shift>`, then `accept <area> --by=`.

## 2. handover-late: the incoming lead accepts within the grace period

- **Source.** House rule, setting `handover_grace_minutes` (30), after HSE Common Topic 3 (allow time for handover, and do it then).
- **Breach.** A handover accepted more than 30 minutes after the shift ended.

## 3. bypass-in-handover: every bypass active at shift end is on that handover

- **Source.** HSE Common Topic 3 names over-ridden safety systems as a high-risk point for communication.
- **Breach.** A handover whose snapshot (`handovers.items.bypasses`) does not list a bypass that was active in that area when it was given.
- **Refused at the time.** Not needed: `handover` builds the list from the record, so a handover given here cannot leave one off. The rule catches handovers imported or written by hand.

## 4. bypass-authority: no bypass runs past its authorised time

- **Source.** IEC 61511-1 bypass management; house rule `bypass_max_hours` (12) for safety-critical bypasses and `bypass_extensions_without_ra` (1).
- **Breach.** An active bypass past `authorised_until`.
- **Refused at the time.** `bypass` refuses a safety-critical bypass (every trip bypass is one) authorised by the person applying it, authorised by an operator, or authorised for longer than `bypass_max_hours`; `extend` refuses a second extension without a risk assessment reference.
- **Fix.** `restore <BYP> --by=`, or `extend <BYP> --hours= --authorised-by= --ra=`.

## 5. orders-acknowledged: everyone who works an area has read its standing orders

- **Source.** HSWA 2015 s36(3)(f); WHS Act 2011 s19(3)(f); HSE Common Topic 3 (two-way communication).
- **Breach.** Someone who has worked a shift on an order's area since it took effect and has no acknowledgement on record.
- **Refused at the time.** `accept` refuses an incoming lead with an unread order.
- **Fix.** The person reads it; `ack <SO> --by=`.

## 6. orders-current: no standing order stays in force past its expiry

- **Source.** House rule, setting `order_max_days` (90). A standing order is a temporary instruction; one that lives forever belongs in the operating procedure.
- **Breach.** An active order past its expiry, or with no expiry (imported).
- **Refused at the time.** `issue` refuses an order with no expiry or one beyond 90 days.
- **Fix.** `withdraw <SO> --reason=`, or reissue it.

## 7. rounds-done: every operator round is done within its grace period

- **Source.** The site's own operating procedures; house rule `round_grace_minutes` (60).
- **Breach.** A round due in the last 30 days and not done an hour after it was due.
- **Fix.** Do the round (`round <route> --by= --values=`); log why it was missed (`entry`).

## 8. excursions-logged: every reading outside its limits is explained in the logbook

- **Source.** CSB Texas City report on logbook records; house rule.
- **Breach.** A reading outside the alarm band or the safe operating limit with no logbook entry linked to it.
- **At the time.** `round` logs a safe operating limit excursion itself as a high-priority, carried-forward entry.
- **Fix.** `explain <tag> "<cause and action>" --by=`.

## 9. notifiable: every notifiable event is notified to the regulator

- **Source.** New Zealand: HSWA 2015 ss23 to 25 define notifiable injuries, illnesses and incidents; s56 requires the business to notify WorkSafe as soon as possible after becoming aware; s57 requires the site to be preserved until an inspector releases it. Australia: WHS Act 2011 ss35 to 37 define notifiable incidents; s38 requires the regulator to be notified immediately after becoming aware; s39 requires the site to be preserved.
- **Breach.** An entry marked `notifiable` with no `notified_at`.
- **Refused at the time.** `close` refuses to close a notifiable entry before the notification is recorded.
- **Fix.** Notify by phone or the regulator's form, then `notified <LOG> --ref=`. `/draft-regulator-notice` prepares the facts.

## 10. competency: nobody works an area without a current sign-off

- **Source.** HSWA 2015 s36(3)(f); WHS Regulations 2011 reg 39.
- **Breach.** A person on a shift in the last 30 days with no sign-off for that area on that date, or a lapsed one.
- **Refused at the time.** `start` refuses a lead or crew member without a current sign-off; `accept` refuses an incoming lead without one.
- **Fix.** A real assessment, then `signoff <person> --area= --by= --expires=`.

## 11. fatigue: nobody works past the fatigue limits without a recorded exception

- **Source.** Safe Work Australia, Guide for managing the risk of fatigue at work (2013); WorkSafe New Zealand fatigue guidance. House limits: `max_consecutive_shifts` (7), `min_rest_hours` (10), `max_hours_7_days` (60).
- **Breach.** A person over any limit across the shifts they have worked.
- **Refused at the time.** `start` refuses anyone who would pass a limit, unless a supervisor or manager has recorded a `fatigue-exception` for that person and date. The exception is used once and stays on the record.
- **Fix.** Change the roster, or a manager's recorded decision.
