# Peptide Log

A phone-friendly log for peptides, aminos and other cycles, with a reconstitution calculator and dose calculators. It installs to your home screen, works offline, and keeps all data on your device (nothing is sent anywhere).

> For record keeping and math only. Not medical advice. Double-check every draw.

## What it does

- **Today**: doses due today from your cycles, one tap to log them, plus anything else you took. Warns when a vial is low or past its use-by window.
- **Calculator**
  - *Reconstitution*: vial amount (mg, mcg or IU) + bacteriostatic water → concentration, units to draw on a U-100 (or U-50/U-40) syringe, mL, doses per vial, with a syringe picture.
  - *Units → dose*: how much is in the units you drew.
  - *How much water*: water to add so each dose lands on a round number of units.
  - *Per body weight*: e.g. mcg per kg, with lb or kg.
  - *Vial duration*: how many days a vial lasts at your schedule.
- **History**: every dose grouped by day, filter by type or compound, 7-day totals, CSV export.
- **Cycles**: repeating schedules (daily, every N days, or set weekdays), several times a day, start/end dates, weeks on / weeks off, linked to a vial so it estimates when the vial runs out.
- **Vials & compounds**: vials with amount left (subtracts logged doses), concentration, mix date and use-by days, lot number. Compounds are tagged Peptide, Amino or Other and carry a default dose, unit and route.
- **Settings**: default syringe, backup to a JSON file, restore, erase.

## Run it

It's plain HTML/CSS/JS with no build step.

```sh
npm start        # serves on http://localhost:8080
npm test         # calculator + schedule unit tests
```

To use it on your phone, host the folder anywhere static. The easiest is GitHub Pages: repo **Settings → Pages → Deploy from a branch → `main` / root**. Open the URL on your phone and choose **Add to Home Screen**.

## Code layout

- `js/calc.js` – all the math (pure functions, unit tested in `tests/`)
- `js/store.js` – localStorage persistence, backup/restore
- `js/app.js` – screens and forms
- `sw.js`, `manifest.webmanifest` – offline + installable
