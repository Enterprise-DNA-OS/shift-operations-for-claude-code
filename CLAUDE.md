# Shift Operations for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs a decision, what is on fire | `/attention` |
| Who is on shift, a shift's log and rounds | `/shift` |
| What happened on an area, find an entry | `/logbook` |
| Something happened: log it, an injury, a trip | `/entry` |
| Give the handover, show the pack | `/handover` |
| The incoming lead takes the plant | `/accept` |
| Standing orders: what is in force, issue, read, withdraw | `/standing-orders` |
| A trip or alarm bypassed, inhibited, overridden; extend; restore | `/bypasses` |
| A round, readings, limits, a tag's trend | `/rounds` |
| Readings out of limits, unexplained | `/excursions` |
| Actions, who owns what, close one | `/actions` |
| Crews, sign-offs, fatigue | `/people` |
| Start a shift or a call-out | `/start-shift` |
| Tell the regulator, notifiable events | `/notifiable` |
| The rules, are we compliant | `/compliance` |
| The week, how did we do | `/week` |
| Monday review | `/weekly-review` |
| Print the handover | `/draft-handover-sheet` |
| Prepare a WorkSafe or regulator notification | `/draft-regulator-notice` |
| Brief the crew at shift start | `/draft-crew-briefing` |
| A new area, person, route, checkpoint | `/add` |
| Note a conversation or decision on a record | `/note` |
| Bring data across from j5 or a spreadsheet | `/import` |
| Back up everything, hand data to an investigator | `/export` |
| A new dashboard page | `/new-view` |
| Add a field, change a rule, rename something | `/customise` |

If an ask fits nothing here, run the CLI directly (`npm run ops -- help`) and then propose a new command for it.

## Hard rules

- The CLI refuses what the plant's rules say must not happen: a handover accepted with an unread standing order or a lapsed sign-off, a trip bypass self-authorised or longer than one authority period, a second extension without a risk assessment, a shift started past a sign-off or fatigue limit, an order with no expiry, closing a notifiable event before it is notified. There is no force flag. Never suggest editing a sign-off date, a limit, an acknowledgement or a setting to get something through; the fix is the real assessment, the real read, or a manager's recorded decision.
- Never record an acknowledgement, a sign-off, a notification or a fatigue exception the operator has not told you happened.
- A reading outside a safe operating limit is said first and loudly, before anything else.

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off j5 Operations Management.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/j5-operations-management
