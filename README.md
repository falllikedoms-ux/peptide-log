# Dialed-In

(Formerly Peptide Log.) A phone-friendly log for peptides, hormones and other cycles, plus daily weight, blood pressure, night sweats, injection sites and labs, with a reconstitution calculator and dose calculators. It installs to your home screen, works offline, and keeps all data on your device (nothing is sent anywhere).

> For record keeping and math only. Not medical advice. Double-check every draw.

## What it does

- **Today**: a daily check-in card (weight, fasted or not, AM/PM blood pressure with back-to-back readings averaged, night sweats, notes), doses due today from your protocols, one tap to log them, plus anything else you took. Warns when a vial is low or past its use-by window, or when a site reaction was logged.
- **Body & labs**: 7-day fasted weight and BP averages, weight trend (fasted only, with a 7-day rolling average), morning BP chart, injection-site rotation (days since each site, next SubQ/IM site to use, recent reactions), and a lab table that lines up every marker across panels. Paste lab results one per line. **Copy summary for Claude** builds a plain-text summary of a date range to paste into a chat.
- **Calculator**
  - *Reconstitution*: vial amount (mg, mcg or IU) + bacteriostatic water → concentration, units to draw on a U-100 (or U-50/U-40) syringe, mL, doses per vial, with a syringe picture.
  - *Units → dose*: how much is in the units you drew.
  - *How much water*: water to add so each dose lands on a round number of units.
  - *Per body weight*: e.g. mcg per kg, with lb or kg.
  - *Vial duration*: how many days a vial lasts at your schedule.
- **History**: every dose grouped by day, filter by type or compound, 7-day totals, CSV export.
- **Stack → Protocols**: repeating schedules (daily, every N days, or set weekdays), several times a day, start/end dates, weeks on / weeks off, linked to a vial so it estimates when the vial runs out.
- **Stack → Vials & compounds**: vials with amount left (subtracts logged doses), concentration, mix date and use-by days, lot number. Compounds are tagged Peptide, Hormone, SARM, Amino or Other and carry a default dose, unit and route.
- **Doses** record route, site (with a suggested next site) and any reaction.
- **Settings**: default syringe, summary for Claude, backup to a JSON file, add entries from a file (merges, keeps what's there), restore (replaces), erase.

Data stays in `localStorage` under the old key `peptide-log-v1`, so installs from before the rename keep their logs; v1 data is migrated in `js/store.js`.

## Run it

It's plain HTML/CSS/JS with no build step.

```sh
npm start        # serves on http://localhost:8080
npm test         # calculator, schedule and body-tracking unit tests
```

To use it on your phone, host the folder anywhere static. The easiest is GitHub Pages: repo **Settings → Pages → Deploy from a branch → `main` / root**. Open the URL on your phone and choose **Add to Home Screen**.

## Code layout

- `js/calc.js` – all the math (pure functions, unit tested in `tests/`)
- `js/store.js` – localStorage persistence, backup/restore
- `js/app.js` – screens and forms
- `sw.js`, `manifest.webmanifest` – offline + installable
