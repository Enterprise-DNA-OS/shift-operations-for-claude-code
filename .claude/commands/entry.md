---
description: Put something in the logbook. An event, a trip, an alarm, an equipment change, a safety or environmental event, with an action if one follows. Marks injuries and notifiable events.
---

The operator says what happened in their own words. Turn it into:

```
npm run ops -- entry "<one plain line>" --area=<code> --by="<name>" --category=<category> [--priority=high] [--tag=<equipment>] [--body="<detail>"] [--carry] [--action="<what must be done>" --owner="<name>" --due=<date>]
```

- Pick the category from what happened: a trip is `trip`, anything that hurt or nearly hurt someone is `safety`, a discharge or spill is `environmental`.
- `--carry` keeps it on every handover until closed (`close <LOG>`). Use it for anything the next shift must act on.
- An injury: add `--injury`. If it may be a notifiable event (a death, a notifiable injury or illness, or a notifiable incident such as an uncontrolled escape of a hazardous substance), ask the operator, and if yes add `--notifiable`. Then tell them plainly: notify the regulator as soon as possible, preserve the site, and record it with `notified <LOG> --ref=`. Offer /draft-regulator-notice.
- Read back the entry reference. Do not invent times, tags or names; ask.
