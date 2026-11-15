---
description: Actions raised from the logbook. What is open, what is overdue and who owns it, and close one off.
---

- Open: `npm run ops -- actions` (`--all` includes done). Overdue first.
- Close: `npm run ops -- done <ACT-ref> --note="<what was done>"`, only on the owner's or operator's word.
- New action on an existing entry: log a follow-up entry with `--action=` (see /entry).
