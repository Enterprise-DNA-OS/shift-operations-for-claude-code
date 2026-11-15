---
description: Who is on shift now, or one shift's card. The crew and their positions, the logbook for the shift, the rounds due and done, and where the handover stands.
---

1. With no area named, run `npm run ops -- shift` (every area's open shift).
2. With an area ("utilities", "UTL") or a shift reference, run `npm run ops -- shift <area|SH-ref>`.
3. Present the header line first (times, lead, handover state), then the crew, then the logbook, then rounds. Call out a round that is due or missed and any high-priority entry.
4. For past shifts use `npm run ops -- shifts <area> --days=N`.
