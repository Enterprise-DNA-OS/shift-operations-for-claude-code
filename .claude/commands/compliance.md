---
description: Check the records against the eleven rules in docs/compliance.md (handovers, bypasses, standing orders, rounds, excursions, notifiable events, sign-offs, fatigue) and report what is breached, with the source cited.
---

1. Run `npm run ops -- compliance`. For the detail and source of one rule: `npm run ops -- compliance <rule>`.
2. Report as a table: rule, breaches, the worst example, the source. Breached rules first, people's safety and the law before house rules.
3. For anything breached, give the command that fixes it (see /attention) or draft the paperwork into `drafts/` (never send).
4. If a rule in `docs/compliance.md` does not fit this site, say so and stop. Do not guess at law. The operator confirms the rule, then you update the doc and the check together (/customise).

Nothing here is legal advice. The doc records the rules the operator has told the system to enforce, with sources, and this command checks the data against them.
