---
description: Give the shift handover. Builds the pack from the record (carried-forward entries, the shift's trips and safety entries, every bypass, every standing order in force, rounds not done, readings outside limits, actions due) and records it as given.
---

1. Show the pack first: `npm run ops -- handover <area> --dry-run`.
2. Read it to the outgoing lead in this order: bypassed safety functions (overdue ones first), readings outside the safe operating limit, carried-forward entries, standing orders (expired ones flagged), rounds not done, actions due. Ask if anything is missing from the record; log it with /entry before handing over.
3. When the lead is ready: `npm run ops -- handover <area> --summary="<their one or two lines>"` (add `--by=` if someone other than the shift lead gives it, `--not-face-to-face` if it was not given in person).
4. Tell them the incoming lead accepts with /accept. A printable sheet is /draft-handover-sheet.
