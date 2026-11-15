---
description: The incoming lead accepts the handover. Refused, with the reason, if they are not signed off for the area or have not acknowledged a standing order in force there.
---

1. Run `npm run ops -- accept <area> --by="<incoming lead>"`.
2. If it is refused, show the reasons as the CLI gives them. For an unread standing order, show the order's text (`npm run ops -- order <SO-ref>`), let the person read it, and only on their word run `npm run ops -- ack <SO-ref> --by="<name>"`, then accept again.
3. A lapsed sign-off is not something to work around. The fix is a signed-off lead accepting, or the supervisor renewing the sign-off with `signoff` after a real assessment.
4. Report: accepted at what time, and whether it was recorded as late.
