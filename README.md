# Call the Lean

A competitive media-literacy game: real headlines with the source hidden — call each
outlet's political lean before the clock runs out.

- **daily.html** — the daily edition. Ten date-seeded headlines, identical for every
  player, one official run per day, shareable result grid.
- **lean.html** — unlimited practice with the same pool.
- **index.html** — "Spot the Spin," a technique-spotting training mode with fictional
  articles (click the biased sentence, name the technique).

## How content updates

`build-items.mjs` pulls fresh headlines from 11 outlets' public RSS feeds, applies
mechanical filters (no AI), and writes `data/items.json`. The GitHub Actions workflow
in `.github/workflows/daily-refresh.yml` runs it every morning and commits the result,
which republishes the site via GitHub Pages. Nothing to manage.

## Where the answers come from

Lean is an **outlet-level** rating from two independent published raters — Media
Bias/Fact Check and AllSides — mapped onto one five-point scale. Where the raters
disagree, both answers score full credit and the reveal says so. Ratings were checked
2026-08-14 and live in the config at the top of `build-items.mjs`; re-verify them
periodically. Headlines and ledes are quoted from publishers' own feeds with
attribution and a link back to the original article.
