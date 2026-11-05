# Devpost form answers

## Project name

FairLoad: Fairer Food Bank Allocation

## Elevator pitch

A browser tool that helps food banks plan shipments, test disruptions and see what each fairness choice or manual override costs, with no server.

## About the project

Paste everything between the lines below.

---

## Inspiration

We chose problem DN-SI-01 because food bank allocation is a decision made with limited trucks, storage and time, and its mistakes fall on people who are easy to miss. We started with public data and a simple question: how evenly does food reach people in poverty?

Using Food Bank of Delaware mobile pantry records and US Census estimates, we found a 181× gap between ZIP codes: about 159 lb per person in poverty at the high end and 0.9 lb at the low end. About 14% of Delaware's people in poverty live in ZIP codes with no mobile pantry record.

These gaps are not proof of unfairness. The data covers mobile pantries only, and fixed pantries may serve some of these areas. The gaps do show why planners need a way to test their choices.

## What it does

FairLoad runs in the browser with no server. A planner can:

- Get an 8-week shipping plan by hub, ZIP code and food type
- Switch on a truck breakdown, donation surge, demand spike or cold storage failure, and the plan re-solves
- Set a fairness target and see the trade-off
- **Pin and price:** force a shipment, then see the change in food delivered, waste and miles, and which ZIP codes give up the most
- See what limits the plan, and what another truck, site or more storage would be worth
- Upload their own CSV, which stays in the browser

Delaware is a public test case. The Food Bank of Delaware is not a partner. Supply, need and capacity are assumed, and all results are simulated.

## How we built it

We joined mobile pantry records from FirstMap Delaware with American Community Survey 2020–2024 estimates by ZIP code. After cleaning, the data covers 1,484,579 lb across 31 ZIP codes.

The model is a multi-week linear program solved with HiGHS compiled to WebAssembly. The app uses React and Leaflet, and the same model code runs in the browser and in our validation scripts. Here \\( u \\) is unmet need, \\( d \\) is food discarded, \\( I \\) is food carried and \\( \rho \\) is the weekly spoilage rate:

$$\min \; U\sum u + W\Big(\sum d + \sum \rho I\Big) + E\sum_{z,b} w_b\, s_{z,b}$$

The last term penalizes each ZIP code's pounds below the equity target, and the penalty rises with the gap. Constraints cover shelf-life buckets, hub stock, truck time, cold and dry storage, pantry intake and need. Each week FairLoad reads actual stock and orders, plans four weeks ahead on average forecasts, carries out the first week and repeats.

## Challenges we ran into

**Our first result looked better than it was.** Our pilot showed a 44% drop in people living in low-coverage ZIP codes. When we compared it with a simple rule, the rule matched the optimizer and moved less food. So the full model had to earn its place against rules.

**Our first fairness penalty was wrong.** At fairness targets of 90% and 100%, the worst-served ZIP code fell to 0%. A flat penalty values a pound the same wherever it lands, so the solver chose cheap routes and starved a far ZIP code. We saw this in the app's own chart, replaced the penalty with one that rises with the gap, added a regression test and reran everything.

**Hand rules ignore trucks.** A fair critic could say our baselines were weak, so we added a stronger rule: shortest routes first, with every ZIP code filled to a 70% floor. FairLoad still won, by a smaller margin, and we report that margin.

## Accomplishments that we're proud of

We tested FairLoad on 30 simulated 12-week runs per scenario, with every policy going through the same simulator.

| Scenario | Strongest rule | FairLoad | Gain (points) | 95% interval |
|---|---:|---:|---:|---:|
| Normal weeks | 82.4% | 85.2% | +2.8 | 2.4 to 3.2 |
| Truck breakdown | 78.2% | 81.7% | +3.5 | 3.1 to 3.9 |
| Produce donation surge | 83.3% | 85.9% | +2.7 | 2.4 to 3.0 |
| Demand spike in one county | 78.2% | 80.5% | +2.3 | 1.9 to 2.7 |
| Cold storage failure | 82.0% | 84.8% | +2.8 | 2.3 to 3.2 |
| Truck breakdown and demand spike | 75.5% | 79.2% | +3.7 | 3.5 to 4.0 |

On normal weeks FairLoad came within 0.5 points of perfect hindsight.

## What we learned

**Most of the gain comes from limited truck time.** With fleet hours at 150% of current use the gain over the best hand rule falls to +0.4 points, and at 300% it is +0.1. We have no real fleet data, so a food bank should check this first.

**FairLoad did not consistently cut waste.** Against the strongest rule, waste moved between −580 and +3,368 lb per 12 weeks.

**Re-solving matters.** A plan made once from a forecast wasted 24,910 lb on normal weeks, against 8,438 lb for FairLoad.

**Allocation cannot fix every gap.** ZIP code 19805 has 8,020 people in poverty and one recorded mobile pantry site, and it stays below 30% of need under every plan. In the model, one more site lifts it to 58%. Fixed pantries may already serve this area, so that needs checking first.

## What's next for FairLoad

Replace our assumptions with real fleet, storage and need data. Add fixed pantries and ZIP codes with no mobile pantry record. Then run it alongside real planning decisions before anyone relies on it.

Data credits: Food Bank of Delaware (FirstMap Delaware), US Census Bureau American Community Survey (through Census Reporter), OpenStreetMap contributors.

---

## Built with

Add these one at a time:

javascript, react, vite, leaflet, highs, webassembly, node.js, linear-programming, openstreetmap, arcgis, american-community-survey

## Try it out links

- Live demo: https://huzaifaguru.github.io/fairload/
- GitHub repo: https://github.com/huzaifaguru/fairload

## Image gallery

Upload these from `docs/media/`: `truck_breakdown.png`, `pin_and_price.png`, `test_results.png`, `planner.png`

## Video demo link

Upload `docs/media/fairload_demo.webm` to YouTube as Public or Unlisted, then paste the link.

## Before you submit

- Add every team member to the project. The last slide says members and roles are listed on the Devpost page.
- Ticking the eligibility box confirms that everyone is a student, among other things. Read the Official Rules first.
