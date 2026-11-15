---
description: Operator rounds. What is due, done or missed, record a round's readings, see the limits, explain an excursion, see a tag's trend.
---

- Rounds in the last 24 hours: `npm run ops -- rounds [area]`, missed only: `--state=missed`.
- Record a round: `npm run ops -- round <route> --by="<name>" --values="TAG=value,TAG=value"`. A reading outside the safe operating limit logs itself as a high-priority, carried-forward entry; say so loudly and ask what is being done about it. A reading outside the alarm band needs a cause: `npm run ops -- explain <tag> "<why>" --by=`.
- Limits: `npm run ops -- limits [route|area]`. Trend: `npm run ops -- trend <tag> --days=3`.
- Changing a limit: `npm run ops -- limit <tag> --alarm-high= --reason="<who approved, MOC reference>"`. A safe operating limit change normally goes through management of change; say so.
