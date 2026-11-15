<h1 align="center">Shift Operations for Claude Code</h1>

<p align="center">
  <strong>The open-source shift operations system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your j5 Operations Management data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=j5-operations-management">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/j5-operations-management?utm_source=github&utm_medium=readme&utm_campaign=j5-operations-management">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-j5-operations-management">Instead of j5 Operations Management</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Shift Operations for Claude Code does the job you pay j5 Operations Management for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the j5 Operations Management dashboard cannot.

Octave (which took over the j5 line from Hexagon and now sells it as Tempo Operations Management) publishes no price. It is sold through a sales conversation as a suite: Operations Logbook, Shift Handover, Standing Orders, Work Instructions, Operator Rounds, Control of Work, Incident Management and Management of Change, with connectors to historians and control systems ([Octave Tempo Operations Management](https://www.octave.com/products/operations-optimization/tempo/operations-management)). Every one of those modules is a screen over the same records: areas, shifts, entries, handovers, orders, bypasses, rounds and readings.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=j5-operations-management).

Shift Operations for Claude Code is for New Zealand and Australian process plants: dairy and food factories, water and wastewater treatment, power stations and boiler houses, chemical, timber and mineral processing, anywhere a crew runs the plant around the clock and hands it to the next crew twice a day. It holds the operating areas, the people and their sign-offs for each area, the shifts, the logbook, the handover at every shift change, the standing orders and who has read them, every safety function bypassed or inhibited, the operator rounds and their readings against alarm and safe operating limits, and the actions that come out of it.

It builds every handover from the record, so a bypass cannot be left off. It refuses, with no override, a handover accepted by someone who has not read the standing orders in force or is not signed off for the area, a trip bypass authorised by the person applying it or for longer than one authority period, a shift started with someone past the fatigue limits without a manager's recorded exception, a standing order with no expiry, and closing a notifiable event before the regulator has been told.

## Ten questions j5's dashboards do not answer

Each is a real command on the demo data today.

1. **Which bypasses were active at a shift change and left off that handover?** `compliance bypass-in-handover`
2. **Who has worked the utilities since the feedwater standing order went out, and not read it?** `order SO-101`
3. **Which safety-critical bypasses are running past their authority right now, and who authorised them?** `bypasses`
4. **Who worked the ammonia plant last week with a lapsed sign-off, and how many shifts?** `competency`
5. **Who went straight from a day shift onto a night shift this fortnight?** `fatigue`
6. **Which readings went outside their alarm band and nobody wrote down why?** `excursions --open`
7. **Which notifiable events has the regulator not been told about, and how long ago were they logged?** `compliance notifiable`
8. **Which handovers were accepted late, or never accepted, this month?** `compliance handover-recorded` and `handover-late`
9. **What has the Boiler 2 drum level done over three days, and which low reading was explained?** `trend LT-202`
10. **Which standing orders are still in force past their expiry?** `compliance orders-current`

## Your first hour: ten things to ask for

1. "What needs a decision right now?"
2. "Show me the utilities handover pack before I give it."
3. "Kahu is accepting the utilities handover." (and see why it is refused)
4. "Kahu has read SO-101." then accept again
5. "Log it: Boiler 2 relit on pump A, Kahu, utilities, carry it forward."
6. "Record the wastewater round: DO 2.1, pH 7.4, flow 60, turbidity 12, Liam."
7. "Which bypasses are on, and which are overdue?"
8. "Who is past the fatigue limits?"
9. "Draft the WorkSafe notification for the steam burn."
10. "Make the handover grace period 20 minutes." (`/customise`)

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/shift-operations-for-claude-code.git
cd shift-operations-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`, or just ask "what needs a decision right now?"

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first |
| `/shift` | Who is on shift now, or one shift's crew, logbook and rounds |
| `/logbook` | Read the logbook by area, day, category, tag or word |
| `/entry` | Log an event, trip, alarm or injury, with an action; marks notifiable events |
| `/handover` | Build the handover pack from the record and give it |
| `/accept` | The incoming lead accepts; refused on an unread order or a lapsed sign-off |
| `/standing-orders` | Orders in force, who has not read them, issue, acknowledge, withdraw |
| `/bypasses` | Safety functions bypassed now; apply, extend, restore with authority |
| `/rounds` | Rounds due, done and missed; record readings; limits and trends |
| `/excursions` | Readings outside the alarm band or the safe operating limit |
| `/actions` | Open and overdue actions, and close them |
| `/people` | Crews, sign-offs, competency gaps and fatigue |
| `/start-shift` | Start a shift or call-out; refused past a sign-off or fatigue limit |
| `/notifiable` | Notifiable events not yet notified; record the notification |
| `/compliance` | Eleven rules from the safety law and handover guidance, sources cited |
| `/week` | The last seven days on one screen |
| `/weekly-review` | The Monday review, written from three commands |
| `/draft-handover-sheet` | A printable handover sheet, into `drafts/` |
| `/draft-regulator-notice` | The facts for notifying WorkSafe or the state regulator, into `drafts/` |
| `/draft-crew-briefing` | A start-of-shift briefing for the crew, into `drafts/` |
| `/add` | Add an area, person, round route or checkpoint |
| `/note` | Put a note on a person, order, bypass or shift |
| `/import` | Entries, people and orders from j5 or any logbook export |
| `/export` | The whole database as one JSON file |
| `/new-view` | A new printable dashboard in plain language |
| `/customise` | Add a field, change a rule, rename a thing: migration written and applied |

Everything runs through one CLI, `npm run ops -- <command>` (`npm run ops -- help` lists it all). `npm run view` renders the control room board and the operations week; `npm run docs` renders handover sheets, standing orders with their acknowledgements, notifiable event records and the bypass register for each area, in the business's brand from `brand.json`.

## Instead of j5 Operations Management

Export logbook entries, standing orders and people from j5 reports to CSV, then one command:

```bash
npm run ops -- import j5 --entries=imports/entries.csv --orders=imports/orders.csv --people=imports/people.csv --dry-run
```

The dry run is the first audit: entries with no date, authors who are not on the staff list, orders with no expiry. The full guide, including what maps and what does not carry over: [docs/replace-j5-operations-management.md](docs/replace-j5-operations-management.md). The rule book and its sources: [docs/compliance.md](docs/compliance.md).

## Architecture

```
shift-operations-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Shift Operations for Claude Code for your business, migrates your j5 Operations Management data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=j5-operations-management)
- Read more: [enterprisedna.co/omni/instead-of/j5-operations-management](https://enterprisedna.co/omni/instead-of/j5-operations-management?utm_source=github&utm_medium=readme&utm_campaign=j5-operations-management)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
