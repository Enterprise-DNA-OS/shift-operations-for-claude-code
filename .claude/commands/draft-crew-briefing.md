---
description: A start-of-shift crew briefing for an area, from the record, into drafts/. What changed since the crew was last on, what is bypassed, what orders they must read, what rounds are due.
---

1. Run `npm run ops -- handover <area> --dry-run --json`, `npm run ops -- order <SO-ref>` for each order in force, and `npm run ops -- rounds <area>`.
2. Write `drafts/briefing-<area>-<YYYY-MM-DD>.md`, one page: the plant state in two lines, bypasses and why, readings to watch (with limits), standing orders each person must acknowledge (with the full instruction), rounds due this shift, actions due.
3. Plain operator language. Nothing is sent.
