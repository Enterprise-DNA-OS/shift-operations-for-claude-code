---
description: Bring logbook entries, people and standing orders across from j5 or any logbook or spreadsheet export. Dry run first; the dry run is the first audit.
---

1. Ask for the export files (CSV). From j5, run the logbook, standing orders and people reports and save them as CSV. From a spreadsheet logbook, save each sheet as CSV.
2. Dry run: `npm run ops -- import j5 --entries=imports/entries.csv [--people=imports/people.csv] [--orders=imports/orders.csv] --dry-run`.
3. Show what would come in, the new areas it would create, the authors it could not match, and every skipped row with its reason. Orders with no expiry come in and show as breaching `orders-current`.
4. Column names vary by site. If a column was missed, read the header row and map it (docs/replace-j5-operations-management.md lists the names each field accepts). Add a name to the import in `scripts/ops.mjs` if needed and rerun the dry run.
5. Import for real only on the operator's word. Then run /attention.
