---
description: The people. Who is on which crew, which areas each person is signed off for, sign-offs lapsed or due, who worked an area without one, and fatigue against the house limits.
---

- Crew list and sign-offs: `npm run ops -- people [crew]`.
- Sign-offs lapsed or due, and anyone who worked without one: `npm run ops -- competency`.
- Fatigue: `npm run ops -- fatigue` (hours in 7 days, shifts in a row, least rest between shifts, against the settings).
- Record a sign-off after a real assessment: `npm run ops -- signoff "<name>" --area= --by="<assessor>" --expires=<date>`.

Never record a sign-off the operator has not told you happened.
