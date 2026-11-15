# Moving off j5 Operations Management (Octave Tempo)

j5 Operations Management Solutions is now sold by Octave as Tempo Operations Management. It is configured per site, so its reports have whatever columns your site set up. This guide assumes you can run its logbook, standing orders and people reports and save them as CSV, which is how most sites hand data to an auditor. If you run your logbook in spreadsheets today, the same import works on those.

## 1. Export

From j5, run and save as CSV:

1. **Logbook entries.** All logbooks, the date range you want to keep live (most sites bring the last 12 months and archive the rest as the export file itself).
2. **Standing orders.** Active ones at least.
3. **People.** Name, role, crew or team, email.

Put the files in `imports/` (ignored by git: they hold names).

## 2. Dry run

```bash
npm run ops -- import j5 --people=imports/people.csv --entries=imports/entries.csv --orders=imports/orders.csv --dry-run
```

Nothing is saved. You see how many rows would come in, the new areas it would create from logbook names, the authors it could not match to a person, and every skipped row with its reason. That list is the first audit of your old system: entries with no date, orders with no expiry, authors who have left.

## 3. Import

The same command without `--dry-run`. Then `npm run ops -- attention` and `npm run ops -- compliance`.

## What maps

| This system | Accepted column names |
|---|---|
| Entry area | Area, Logbook, Unit, Plant Area, Location (a name that matches no area becomes a new area) |
| Entry time | Date/Time, Date Time, Logged, Event Date, Created, Date (YYYY-MM-DD or DD/MM/YYYY) |
| Entry title | Title, Subject, Summary, Event, Entry |
| Entry detail | Description, Details, Comments, Body, Notes |
| Category | Category, Entry Type, Type, Event Type (matched to event, alarm, trip, equipment, process, safety, environmental, quality, instruction, note) |
| Priority | Priority, Severity, Importance |
| Equipment | Tag, Equipment, Equipment Tag, Asset |
| Author | Author, Created By, Logged By, Operator, User (matched to people by name) |
| Carry forward | Carry Forward, Open, Handover (yes or no) |
| Your reference | ID, Entry ID, Reference |
| Person | Name, Full Name, Person, User; Role; Crew, Team, Shift Team; Email; ID, User ID, Employee ID |
| Standing order | Title, Subject, Order; Area (ALL for every area); Instruction, Description, Details; Issued By; Effective, Effective From, Start, Date; Expires, Expiry, Expiry Date, Valid To |

If your export uses another name for a field, ask Claude Code to add it to the import and rerun the dry run.

## What does not carry over

- **Handover history.** j5 handover reports are form-shaped and differ by site. Keep the old export as the record; handovers here start from your first shift on the new system.
- **Operator rounds history and limits.** Set up routes and checkpoints with `add route` and `add checkpoint` (your limits from the operating envelope), then rounds run from day one. Old readings stay in the historian or the export.
- **Control of work, incident management, management of change.** Those are separate modules in j5. This system holds the control room record; permits, incidents and changes stay where they are or move to their own systems.
- **Historian and control system connections.** j5 reads tags from historians and the DCS. Here a round is typed, or a reading is written by a script you connect to your historian. That connection is a small, specific job, and it is the kind Enterprise DNA does when it installs this.
- **Attachments and photos.** Logbook attachments stay in the export or your document system; link them in the entry's detail.

## Run both for a fortnight

Most sites run the old and new logbooks side by side for two weeks, compare the handovers, then switch the control room over at a crew change.
