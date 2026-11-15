---
description: Everything that wants a decision now, worst first. A notifiable event the regulator has not heard about, a bypass past its authority, a reading outside its safe operating limit, an open handover, someone working without a sign-off or past the fatigue limits, a missed round, an unread or expired standing order, overdue actions.
---

1. Run `npm run ops -- attention`.
2. Present it in its order (it is sorted worst first). Group repeated rows for the same person or order into one line.
3. For each item give the one command that clears it: `notified <LOG> --ref=` for a notifiable event, `restore` or `extend --ra=` for a bypass, `entry` or `explain` for an excursion, `handover` then `accept` for a handover, `signoff` for a lapsed sign-off, `fatigue-exception` (a manager's decision) or a roster change for fatigue, `round` for a missed round, `ack` for an unread order, `withdraw` or reissue for an expired order, `done` for an action.
4. Clear nothing without the operator's word. An empty list is the plant record working; say so in one line.
