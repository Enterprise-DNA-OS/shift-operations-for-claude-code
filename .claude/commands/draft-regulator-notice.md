---
description: Prepare the facts for notifying a notifiable event to WorkSafe (New Zealand) or the state regulator (Australia), from the logbook entry, into drafts/. Never sends or submits.
---

1. Open the entry: `npm run ops -- entry-card <LOG-ref>`. Read every line.
2. Write `drafts/notification-<LOG-ref>.md` with what a regulator asks for: the business and site, the date and time, where it happened, what happened in plain words, who was hurt and how (no more personal detail than the record holds), what was done straight away, how the site is being preserved, who to contact. Mark anything the record does not hold as `[to confirm]`; never fill it in.
3. Say clearly: the notification is made by a person, by phone or the regulator's online form, as soon as possible. Once made, record it with `notified <LOG-ref> --ref=`.
4. `npm run docs -- notifiable-event` renders the record as a branded page for the file.
