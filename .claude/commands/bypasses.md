---
description: Safety functions bypassed, inhibited, overridden or forced. What is bypassed now, apply one with its authority, extend it, restore it.
---

- Now: `npm run ops -- bypasses` (`--all` adds the last 30 days).
- Apply: `npm run ops -- bypass <tag> --area= --kind=alarm_inhibit|trip_bypass|interlock_override|forced_signal --description="<the safety function>" --reason="<why, and what covers the risk meanwhile>" --by="<who applies it>" --authorised-by="<supervisor, manager or engineer>" --hours=<n> [--safety-critical] [--ra=<risk assessment>]`.
- Extend: `npm run ops -- extend <BYP-ref> --hours= --authorised-by= [--ra=]`. Restore: `npm run ops -- restore <BYP-ref> --by=`.

The CLI refuses a safety-critical bypass (every trip bypass is one) authorised by the person applying it, longer than one authority period (`bypass_max_hours`), or extended a second time without a risk assessment reference. Never suggest changing the setting to get one through. Every bypass logs itself and stays on every handover until restored.
