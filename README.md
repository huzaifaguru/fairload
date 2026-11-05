# FairLoad

A browser tool for planning where limited donated food goes each week. A manager can test disruptions, set a fairness target, force a shipment and see what that choice costs.

Built by team 404 Error Found for DataNova 2026, problem DN-SI-01 (Food Bank Resource Allocation Optimization).

**Delaware is a public test case.** The Food Bank of Delaware is not a project partner and has not endorsed this work. Supply, need and capacity are assumed and results are simulated, so nothing here is an allocation recommendation.

**Live demo:** https://huzaifaguru.github.io/fairload/

## What it does

- **Recommend:** an 8-week shipping plan by hub, ZIP and food type, with hub stock by shelf life
- **Stress-test:** switch on a truck breakdown, donation surge, demand spike or cold storage failure, and the plan re-solves
- **Balance:** a fairness target, with a chart of the trade-off
- **Pin and price:** force a shipment and see the change in food delivered, waste and miles, and which ZIPs give up the most
- **Find limits:** see what is holding the plan back, and what another truck, site or more storage would be worth
- **Use your own data:** upload a CSV, which stays in the browser

## Main result

In simulation, FairLoad met 2.3 to 3.7 percentage points more need than the strongest rule tested, in all 6 scenarios. Most of that comes from limited truck time, and the gain nearly disappears when trucks never limit delivery. FairLoad did not consistently cut waste. Full results are in [docs/RESULTS.md](docs/RESULTS.md).

## Run it

Requires Node.js 18 or later.

```sh
cd app
npm install
npm run dev        # development server
npm run build      # static site in app/dist
```

`app/dist` can go on any static host, and no server is needed. The map tiles come from OpenStreetMap, so the base map needs internet access.

## Reproduce the analysis

The `highs` solver is installed by `npm install` in `app`. Run these from the project root:

```sh
node model/04_export_data.js     # build the app's data file from the source data
node model/05_tests.mjs          # integrity tests
node model/06_validate.mjs       # full scenario analysis, about 10 minutes
node model/07_strong_rule.mjs    # truck-aware baseline
node model/08_report.mjs         # write docs/RESULTS.md
cp data/processed/validation.json app/src/core/validation.json
```

Runs use fixed seeds, so the simulated scenarios repeat. Solve times vary by machine.

## Project layout

| Path | Contents |
|---|---|
| `app/src/core/model.js` | Linear program, data setup and assumptions |
| `app/src/core/sim.js` | Scenarios, simulator and comparison rules |
| `app/src/` | React app and solver worker |
| `model/` | Data preparation, tests, validation and report |
| `data/raw/`, `data/processed/` | Source data and outputs |
| `docs/MODEL.md` | Full model and every assumption |
| `docs/RESULTS.md` | Scenario analysis |
| `docs/VIDEO_SCRIPT.md` | Demo video script |
| `deck/` | Presentation and its generator |

## Technology

The problem statement suggests Python with PuLP or OR-Tools. We used JavaScript and HiGHS compiled to WebAssembly so the same model runs in the browser with no server. HiGHS is also a solver PuLP can call.

- Solver: [HiGHS](https://highs.dev/) through [highs-js](https://github.com/lovasoa/highs-js)
- App: React, Vite and Leaflet

## Data credits

- Food Bank of Delaware Mobile Pantries, Q1 and Q2 FY25, from FirstMap Delaware
- US Census Bureau, American Community Survey 2020–2024 5-year estimates (B17001, B01003), through Census Reporter
- Base map: © OpenStreetMap contributors

## Known limits

The data covers mobile pantries only and two quarters, and poverty stands in for food need. ZIPs with no mobile pantry record (38 ZIPs, 15,035 people in poverty) are outside the model. Trucks are modeled as hours with fractional loads, without vehicle routing. See [docs/MODEL.md](docs/MODEL.md).
