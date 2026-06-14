# TSS World Cup 2026 — League Dashboard

A live leaderboard for the TSS bracket pool. Open `index.html` (or the hosted GitHub Pages link) to see standings; scores update automatically every 10 minutes.

## How it works

```
ESPN fifa.world feed  ──►  update-scores.mjs  ──►  results.json  ──►  index.html
   (live match scores)      (computes tables)      (published)        (leaderboard)
```

`update-scores.mjs` pulls group-stage results from ESPN's free `fifa.world` feed (no API key), computes each group's table with FIFA tiebreakers (best-effort), works out the 8 best third-place qualifiers once every group is final, merges any manual corrections from `overrides.json`, and writes `results.json`.

`.github/workflows/update-scores.yml` runs that script every 10 minutes on GitHub's servers and commits `results.json` when scores change — so the board stays current even when nobody has it open.

`index.html` is a self-contained dashboard. It fetches `results.json` on load (and every 2 min), and re-scores everyone live. Player email addresses are not included in the published page.

## Scoring (group-stage phase)

| Event | Points |
|---|---|
| 1st place in group (per team) | 3 |
| 2nd place in group (per team) | 3 |
| 3rd place in group (per team) | 2 |
| 4th place in group (per team) | 1 |
| 3rd-place team correctly called to advance | 2 |
| Tournament Champion | 15 |
| Golden Boot | 7 |

Points from a group lock once that group is final; before that the contribution is provisional.

## Making manual corrections

Everything the live feed can't know lives in `overrides.json`:

- `champion` — set to a team name once the final is played, e.g. `"Spain"`
- `boot` — set to a scorer's last name, e.g. `"Mbappé"` (matching is last-name based)
- `eliminated` — array of team names knocked out (flips champion pick to show "OUT")
- `standings` — `{ "A": { "Mexico": 1, "South Africa": 2, ... } }` to override a group if the auto tiebreaker gets an edge case wrong
- `thirds` — array of 8 team names to manually override the advancing third-place teams

Edit the file via GitHub web UI, commit, and the next run picks it up. You can also trigger a run immediately from the **Actions** tab → **Update WC scores** → **Run workflow**.

## Data notes

- **SC18 (Shiv's test entry):** Excluded from the dashboard — only SC1802 counts

## Coming later

Knockout-bracket scoring (Round of 32 → Final) will be layered on once those picks are collected.
