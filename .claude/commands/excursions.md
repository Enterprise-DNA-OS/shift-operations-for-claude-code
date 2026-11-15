---
description: Readings outside the alarm band or the safe operating limit, and which ones nobody has explained in the logbook.
---

1. Run `npm run ops -- excursions --days=7` (`--open` for unexplained only).
2. Safe operating limit excursions first, then alarm band. For each unexplained one, ask the operator what caused it and record it with `npm run ops -- explain <tag> "<cause and action>" --by=`.
3. If the same tag keeps coming up, show `trend <tag>` and suggest an action (`entry ... --action=`).
