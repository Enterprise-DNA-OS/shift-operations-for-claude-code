# Why there is no front end

j5 Operations Management is a database with a subscription and a project. The records underneath it are ordinary: areas, shifts, logbook entries, handovers, standing orders, bypasses, rounds, readings and actions. What you pay for is the layer on top that lets people who do not write SQL get at those records. Screens, forms, dashboards.

That layer used to be the whole product, because talking to a database was hard. It is not hard any more. Open this folder in Claude Code, say what happened or what you want, and it runs the right command, writes the record and explains the answer. Ask a question the dashboard never had a chart for and you still get an answer.

## What you gain

- **Better answers.** "Which bypasses were left off a handover this month?" "Who has worked the ammonia plant without reading the standing order?" A dashboard shows what the vendor decided to chart. Here you ask.
- **Rules that hold.** The handover cannot be accepted by someone who has not read the orders in force. A trip bypass cannot be self-authorised. A shift cannot start with someone past the fatigue limits. No configuration project to get there.
- **No seats.** Every operator, contractor and engineer can read and write. The bill does not grow with headcount.
- **Your data in your database.** Plain records you own. Back them up, query them from anything, leave any time.

## What you give up

- **A screen on the control room wall that updates itself.** Here the board is a page rendered on demand (`npm run view`), refreshed when you ask or on a timer. Enterprise DNA builds a live board onto the same database when a control room wants one.
- **Tablet forms in the field.** Rounds are typed or read out to Claude Code after the round. A simple phone form onto the same database is a small build.
- **Live tags from the historian or the DCS.** j5 has connectors. Here a reading arrives by a round or by a script you point at your historian. Connecting it is a specific job, and it is the kind Enterprise DNA does when it installs this.
- **Formal electronic signatures.** Acceptance and acknowledgement are recorded by name and time in the database, not by a signature service. If your regulator or your procedures need more, that is a customisation.
- **A vendor help desk.** This is open source. Enterprise DNA supports the installed version for businesses that want someone to call.

## Who this fits

Plants that run their logbook in spreadsheets, a shared document or an old system nobody likes, and plants paying for an enterprise suite where most of the modules sit unused. If your control room needs a live wall board fed from the DCS all day, have the screen built onto this database, or keep the suite. If you need the record, the rules and the answers more than the screens, this is cheaper, faster and yours.

Installed and run for you: https://enterprisedna.co/omni/instead-of/j5-operations-management
