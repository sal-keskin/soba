# Soba

**TR** · Soba, kömür ve odun sobalarından kaynaklanan karbonmonoksit ölümlerini
önlemeye yönelik, tarayıcıda çalışan eğitim amaçlı bir modeldir. Evi kesit
olarak görürsünüz: soba, soba borusu, baca ve uyuyan bir aile. Rüzgârı,
sıcaklığı, baca yüksekliğini, klapeyi, hava ayarını ve pencereyi siz
değiştirirsiniz; baca çekişinin ne zaman zayıflayıp ters döndüğüne ve odaya
CO dolduğuna fiziksel model karar verir.

**EN** · Soba is an educational browser model aimed at preventing carbon
monoxide deaths from coal and wood stoves in Türkiye. You see a house in
cross-section: stove, flue pipe, chimney, a family asleep. You play the
weather and the house; a physical model decides when the draught weakens or
reverses and CO spills indoors, and a Coburn–Forster–Kane model raises each
sleeper's COHb in real time. Nothing is scripted: every visual is drawn from
live model state.

> **Educational, uncalibrated model.** It does not replace a CO alarm, chimney
> sweeping or official warnings, and it never shows that a house is without
> risk. If you suspect poisoning, get to fresh air at once and call **112**.
>
> **Eğitim amaçlı, kalibre edilmemiş bir modeldir.** CO alarmının, baca
> temizliğinin ve resmî uyarıların yerini tutmaz. Zehirlenme şüphesinde hemen
> temiz havaya çıkın ve **112**'yi arayın.

Live site (once GitHub Pages is enabled): https://sal-keskin.github.io/soba/

## What is in it

- **Play.** One night (22:00–06:00) in about two minutes. Drag the chimney
  top, windsock, thermometer, damper, air inlet and window on the drawing, tap
  the inner door; pause, change speed, scrub the timeline. Five presets: calm
  frosty night, lodos, stove banked at midnight, sooted flue, chimney below
  the ridge. A debrief at 06:00 says which mechanism caused what and gives
  three practical actions.
- **Tonight.** Search for a town; tonight's hourly forecast from
  [Open-Meteo](https://open-meteo.com/) is run through a standard house and
  shown as a timeline of relative draught-failure risk. No geolocation
  prompt, no backend, no analytics, no cookies.
- **Turkish by default**, English toggle. Works with keyboard and screen
  readers through the Settings panel, respects reduced motion, and never uses
  colour as the only signal.

## Model

Pure TypeScript in `src/model/`, no DOM, fixed 2 s time step, seeded
randomness. Equations, units, the full parameter table with sources,
simplifications and open questions are in [`docs/model.md`](docs/model.md).

More than half of the constants are engineering guesses, each marked as such.
The model shows mechanisms and directions; its numbers are orders of
magnitude. Corrections from people who measure stoves, chimneys or patients
are very welcome.

## Develop

```sh
npm install
npm run dev          # local server
npm test             # Vitest
npm run build        # type-check and build to dist/
npm run night -- lodos --every 600   # one night as CSV (frost|lodos|banked|soot|ridge, --seed N, --summary)
npm run docs:params  # regenerate the parameter table in docs/model.md
```

Layout:

```
src/model/   physics and physiology (params.ts holds every constant)
src/ui/      canvas scene, timeline, Tonight mode, Turkish/English text
tests/       unit tests for physics, CFK, the simulation, forecast and API parsing
scripts/     headless night runner, parameter-table generator
docs/        model description
```

## Deploy

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub
Pages on every push to `main` (base path `/soba/`). In the repository settings
choose **Pages → Source: GitHub Actions** once.

## Data and licence

Code: MIT, see [`LICENSE`](LICENSE). Weather data by
[Open-Meteo.com](https://open-meteo.com/) under CC BY 4.0; place names from
GeoNames via the Open-Meteo geocoding API. Only the place name you type and
the coordinates of the place you choose are sent to Open-Meteo.
