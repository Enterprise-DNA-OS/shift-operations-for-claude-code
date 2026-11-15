---
description: Notifiable events. Which ones the regulator has not been told about, record the notification, and keep the site preserved until released.
---

1. Run `npm run ops -- entries --days=30 --category=safety` and `npm run ops -- compliance notifiable`.
2. For each event not notified, say when it was logged and how long ago. The law says notify as soon as possible (New Zealand: HSWA 2015 s56, WorkSafe; Australia: WHS Act 2011 s38, the state regulator) and preserve the site (s57 and s39). See docs/compliance.md.
3. When the operator says it has been notified: `npm run ops -- notified <LOG-ref> --ref="<regulator reference or who they spoke to>" [--preserve-until="<when the regulator released the site>"]`.
4. Offer /draft-regulator-notice to prepare the facts for the call or the online form.
