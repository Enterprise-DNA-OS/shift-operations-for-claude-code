---
description: Read the operations logbook. Entries by area, day, category, equipment tag or a word, the open carry-forward items, or one entry in full.
---

- Today on an area: `npm run ops -- entries <area>` (default the last day).
- A longer window or a filter: `--days=7`, `--category=trip|safety|alarm|equipment|process|environmental|quality|instruction|note|event`, `--tag=BLR2`, `--search="drum level"`.
- What is still being carried forward: `npm run ops -- entries --open`.
- One entry with its actions and the readings it explains: `npm run ops -- entry-card <LOG-ref>`.

Present entries newest first in a table. When the operator asks "what happened with X", search first, then open the matching entry card. Never summarise an entry you have not read.
