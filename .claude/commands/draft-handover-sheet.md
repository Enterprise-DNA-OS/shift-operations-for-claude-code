---
description: A printable shift handover sheet for an area, in your brand, from the record. For the control room wall, the shift folder or the crew briefing.
---

1. Run `npm run docs -- shift-handover` for given handovers (the last three days), or for the current shift's pack run `npm run ops -- handover <area> --dry-run --json`.
2. For the current pack, write `drafts/handover-<area>-<YYYY-MM-DD-HHMM>.md` with: the shift, lead and crew; bypassed safety functions (overdue flagged); readings outside limits; carried-forward entries; standing orders in force; rounds not done; actions due; a blank for the outgoing and incoming leads' names and times.
3. Tell the operator where the file is. Nothing is sent.
