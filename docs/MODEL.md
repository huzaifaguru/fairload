# FairLoad model

FairLoad is a multi-week linear program, solved with HiGHS. The same code runs in the browser and in the validation scripts (`app/src/core/`).

## Sets

- Hubs `h`: Newark and Milford (approximate locations)
- ZIPs `z`: 31 Delaware ZIPs with mobile pantry records
- Foods `f`: fresh produce, dairy and protein, shelf-stable
- Age `a`: weeks a food has been held
- Weeks `t`: the planning horizon

## Decisions

| Variable | Meaning |
|---|---|
| `x[h,z,f,t]` | Pounds shipped from hub to ZIP |
| `y[h,f,a,t]` | Pounds taken from a shelf-life bucket |
| `d[h,f,a,t]` | Pounds discarded |
| `I[h,f,a,t]` | Pounds carried to next week |
| `u[z,f,t]` | Need left unmet |
| `s[z,b]` | Pounds below the equity target, in penalty band `b` |

## Objective

Minimize:

```
U * sum(u)                      unmet need
+ W * (sum(d) + spoil * sum(I)) food wasted
+ E * sum(weight[b] * s[z,b])   shortfall below the equity target
+ eps * truck hours             tie-break against pointless miles
```

The weights are U = 1, W = 0.5 and E = 2, and they were set before the reported test seeds were run. They express a judgment that a person going without counts more than a pound wasted. Change them in `DEFAULTS`.

## Constraints

| Name | Rule |
|---|---|
| Stock balance | shipped + discarded + carried = arrivals + what survived from last week |
| Shelf life | food in its last week cannot be carried |
| Flow | pounds shipped from a hub = pounds taken from its buckets |
| Need | pounds received + unmet = need, so a ZIP never gets more than it needs |
| Truck time | hours used at a hub <= hours available |
| Cold and dry storage | pounds held <= capacity at each hub |
| Pantry intake | pounds into a ZIP <= sites x weekly site intake |
| Equity | shortfall + past pounds + planned pounds >= target x total need |
| Pins | a forced shipment has a lower bound |

## The equity penalty

The first version penalized every pound below target equally. Testing showed this was wrong: at targets of 90% and 100%, the worst-served ZIP fell to 0%. With a flat penalty a pound counts the same wherever it lands, so the solver chose cheap routes and could leave a far ZIP with nothing.

The penalty now rises with the gap: the first 10 points of shortfall cost 1x, the next 20 cost 2x and the rest cost 4x. The problem is still linear because the penalty is convex. A regression test covers this case.

## How FairLoad runs

Each week it observes this week's supply, orders, stock and any events under way. It solves 4 weeks ahead using average forecasts, carries out week 1 only, and repeats. The equity term counts what each ZIP has already received, so a ZIP that falls behind gets priority later.

## Assumptions not in the public data

| Assumption | Value |
|---|---|
| Supply vs need | Supply covers 85% of need. Need is scaled to match, so this is the share of need assigned to mobile pantries, not a measure of total food need |
| Food mix | 30% produce, 20% dairy and protein, 50% shelf-stable, for both supply and need |
| Shelf life | 2 weeks, 4 weeks, long |
| Weekly spoilage | 15%, 5%, 0.5% |
| Supply variation (CV) | 0.5, 0.3, 0.25 |
| Need variation | 10% by ZIP, 5% shared |
| Truck time | 120% of the hours the current allocation needs |
| Route time | Round trip at 35 mph plus 2 hours handling per 20,000 lb load |
| Road distance | 1.3x straight-line distance |
| Site intake | Twice the 75th percentile of observed weekly pounds per site (1,756 lb) |
| Storage | Cold 1.5 weeks and dry 6 weeks of hub inflow |
| Hub supply | Follows the historical pounds nearest each hub |

## Simplifications

- Truckloads can be fractional, and no vehicle routing is modeled.
- Pantry orders are known when trucks are loaded. Food delivered is used that week.
- Foods cannot substitute for each other.
- Poverty stands in for food need. One sensitivity test blends it with population.
- ZIPs with no mobile pantry record are outside the model, because no site is known there.

## The "pounds/boxes" field

The source field is named `POUNDS_BOXES_DISTRIBUTED`, so we tested whether it mixes units. The smallest value kept is 2,251. Read as boxes at even 20 lb each, that would be about 45,000 lb, more than any other record except the removed mass event. The only small values (6.5 and 14.9) were already removed. Where family counts exist, the median is 82 per family. We treat the field as pounds, but we cannot confirm this without the data owner.
