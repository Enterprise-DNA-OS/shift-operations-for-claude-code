---
description: Add an area, a person, a round route or a checkpoint with its limits.
---

- `npm run ops -- add area "<name>" --code=<CODE> [--hazards="..."]`
- `npm run ops -- add person "<name>" --role=operator|shift_lead|supervisor|manager|engineer|maintenance [--crew=A]`, then `signoff` them for each area once they have been assessed.
- `npm run ops -- add route "<name>" --code=<CODE> --area=<code> --every=<hours> [--first=02:00]`
- `npm run ops -- add checkpoint "<what is read>" --route=<code> --tag=<TAG> --unit= [--alarm-low= --alarm-high= --sol-low= --sol-high=]`

Ask for anything missing rather than guessing a limit.
