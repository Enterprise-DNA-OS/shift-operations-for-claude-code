---
description: Start a shift or a call-out on an area. Refused if anyone is not signed off for the area or would pass the fatigue limits, unless a manager has recorded an exception.
---

1. Run `npm run ops -- start <area> --lead="<name>" --people="<name>, <name>" [--at="<YYYY-MM-DD HH:MM>"] [--hours=12]`.
2. If refused for fatigue, say what limit and by how much. A supervisor or manager can decide to allow it: `npm run ops -- fatigue-exception "<name>" --approved-by="<supervisor or manager>" --reason="<why and what controls>" --date=<date>`. That decision stays on the record. Never suggest it on your own.
3. If the shift before has no handover, the CLI says so: get it given (/handover) before the new crew takes the plant.
