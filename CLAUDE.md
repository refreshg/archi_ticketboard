# CLAUDE.md — Archi ticket LiveBoard

Static, no-build dashboard over Bitrix24 pipeline 23. Plain ES modules, no
framework, no bundler. Georgian UI.

## Running

```bash
node serve.mjs        # http://localhost:4173
node src/verify.mjs   # grades aggregation against server-side totals
```

ES modules mean `file://` does not work — the HTTP server is required.

## Two portal behaviours the code is built around

These are the reason several helpers look more defensive than they need to.

1. **Batch filter keys must be percent-encoded.** Inside a `batch.json` command
   string, a filter key with an operator prefix (`>=`, `<=`, `>`, `<`, `!`) is
   *silently dropped* unless encoded. `filter[>=DATE_CREATE]` returned all 8935
   deals instead of 411 — no error. `encodeQuery` in `src/bitrix.js` encodes
   keys for this reason. Never hand-build a batch command string without it.

2. **`crm.deal.list` omits `UF_` fields not named in `select`.** They come back
   absent, not null. `DEAL_SELECT` in `src/model.js` is the single source of
   truth; extend it when adding a drawer column.

Related: `crm.deal.userfield.list` and `crm.deal.fields` return **null labels**
through these webhooks, so fields cannot be discovered by label — identify them
from populated values on real deals. `start: -1` disables the `total` count.
Paging needs `order[ID]=ASC` for a stable window.

## Metric definitions (confirmed with the user)

| Metric | Definition |
|---|---|
| თიქეთების რაოდ. | `CATEGORY_ID = 23` |
| ვადაგადაცილებული | stage `C23:UC_RGEFQ9` |
| ჩახურული | `C23:WON` **+** `C23:PREPAYMENT_INVOIC` |
| ვადაგ. ჩახურული | ჩახურული **and** `UF_CRM_1731998758508 = True` |

The date filter runs on **`BEGINDATE`** by default — the field the CRM list
filter labels "თარიღიდან", which is what the ticket team (Ana Gogatishvili)
filters by when checking the board against the CRM. A `#datefield` selector
switches to `DATE_CREATE`; `DATE_FIELDS` in `src/model.js` is the option list.

The board originally filtered on `DATE_CREATE`, and the client reported every
number as wrong (2026-09-15). On this pipeline `BEGINDATE` sits 11–30 days after
`DATE_CREATE` on nearly every ticket, so the two windows select very different
deals: 15.08–15.09.2026 gave 416 by `BEGINDATE` (CRM showed 418) vs 309 by
`DATE_CREATE`, with a completely different stage mix. **When someone says the
board disagrees with the CRM, first ask which date field their CRM filter uses.**

## Field map

`UF_CRM_5E1EECDB0571C` პროექტი (enum, **multiple** → array) ·
`UF_CRM_1731998758508` overdue-closed (boolean, `"1"`/`"0"`) ·
`UF_CRM_1677604396941` მიმართულება · `UF_CRM_1682005626208` პრობლემის ჯგუფი ·
`UF_CRM_1610362285` თანაპასუხისმგებლები (multi) · `UF_CRM_1688037739` მოგვარები ·
`CLOSEDATE` მიმდინარე დედლაინი

Multi-value UF fields arrive as an array, a bare scalar, or absent — `toArray`
normalizes all three.

## Portfolio managers

From list `111`, field `PROPERTY_1299` (user IDs). The list element `NAME`
matches the project enum `VALUE` exactly (50/50 verified), which is what joins a
deal to its manager. Manager totals are derived from project membership, so they
can exceed the deal count when several projects share one manager — that is
expected, not a bug.

## Frontend gotchas already hit

- **Palette tokens live on `:root` *and* `.viz-root`.** Scoped only to
  `.viz-root`, `getComputedStyle(documentElement)` returned `""` and charts
  rendered **black**; the drawer (outside `.viz-root`) rendered transparent.
- **Do not use `ka-GE` locale formatting.** It is missing in some runtimes
  (including headless Chromium) and silently falls back to US `MM/DD/YYYY`.
  `formatDate` and `num` format explicitly.
- **`[hidden]` loses to `display:flex`** — hence `[hidden]{display:none!important}`.
- The drawer row click handler skips `e.target.closest('a')` so the ID anchor
  and the row don't both fire and open the deal twice.

All four rendered as plausible output rather than errors. **Screenshot the page
and look at it** before calling frontend work done.

## Verification

`src/verify.mjs` compares client-side aggregation against server-side `total`
for the same filters (12 checks). Run it after any data-layer change — it is the
guard against silently-wrong numbers.

Browser drivers in `tools/` (need `npx playwright install chromium` once):
`drive.mjs` board + drawer + dark mode, `drive-filter.mjs` date filtering,
`drive-links.mjs` deal links. Screenshots are gitignored.

## Next steps

Nothing outstanding — the delivered scope is complete and verified. Candidates
if the board grows:

- **`CLOSEDATE` filter mode.** A toggle between "created in window" and "closed
  in window"; the latter is the more natural question for the closed metrics.
- **Reference-data caching.** Users, enums and list 111 are refetched on every
  page load (~1s). `sessionStorage` with a short TTL would make reloads instant.
- **Auto-refresh.** A polling interval for wall-display use.
- **Direction / problem-group filters.** The fields are already fetched and
  resolved; only UI is missing.
- **Deep links.** Encoding the date range and open drawer in the URL hash would
  make a view shareable.
