---
description: Standing orders. What is in force on each area, who has worked the area without reading one, issue a new order, record that people have read it, withdraw one.
---

- In force: `npm run ops -- orders [area]` (`--all` includes withdrawn).
- One order, who read it and who has not: `npm run ops -- order <SO-ref>`.
- Issue: `npm run ops -- issue "<title>" --area=<code|ALL> --instruction="<what operators must do>" --by="<issuer>" --approved-by="<supervisor, manager or engineer>" --expires=<date>`. Every order expires within 90 days (setting `order_max_days`); the CLI refuses otherwise.
- Read and understood: `npm run ops -- ack <SO-ref> --by="Name, Name"`. Only on each person's own word.
- No longer needed: `npm run ops -- withdraw <SO-ref> --reason="..."`.

Draft the instruction in plain operator language: what to do, how often, and what to do if it goes wrong. Show it before issuing.
