---
name: add-route
description: Add a traffic route (origin → destination with cars per minute) to the Kastenhof simulation, usually from a screenshot of the rendered map where the user has drawn the route as a coloured line. Use this whenever the user wants a new route, a new row in the routes table, or more traffic between two places ("Göteborg to Stenkullen", "cars from Hedeforsvägen to E20", "add a route following the orange line"), even if they only attach an annotated screenshot and name the two ends.
---

# Adding a route from a reference screenshot

Traffic in this simulation is defined only by **routes** in `CONFIG.routes`
(`js/config.js`). Each route has an entry where cars appear, an exit where they
leave, and a rate in cars per minute. The routes table in the UI is built from
that list, so adding a route is one config line. The real work is choosing the
right entry and exit, and checking that cars actually drive the way the user drew.

```js
routes: [
  { id: 'GBG-ALS', label: 'Göteborg → Alingsås', from: 'E20E', to: 'E20E', rate: 24 },
  // Avfart 86 → roundabout → Södra Långvägen → Dageborgsleden north under E20.
  { id: 'GBG-STK', label: 'Göteborg → Stenkullen', from: 'E20E', to: 'DAG', rate: 3 },
],
```

Cars don't follow the drawn line point by point. Every car runs Dijkstra from
`from` to `to`, with a little per-driver noise (`js/sim/routing.js`). The drawn
line is the *intended* path, and your job is to make sure the router's choice
matches it.

## Workflow

### 1. Read the screenshot

The screenshot is usually the app's own top-down view: north up, E20 running
diagonally from bottom-left (Göteborg) to top-right (Alingsås), and the roundabout
east of the motorway. Follow the line from start to end and write it down as a
sequence of road ids, using the road guide below. Note:

- where it starts: which road it enters on at the map edge, or the commuter lot;
- where it leaves the map: which road, and at which edge;
- every ramp, junction and turn on the way, especially places with more than one
  option, like which roundabout exit or which slip lane.

The user's wording also tells you direction and place names. "Cars start on E20"
plus "Göteborg" means the eastbound carriageway `E20E`. Lines are often drawn
roughly, beside the road or across a junction corner. Read the intent, not the
exact pixels. If two readings remain genuinely plausible, ask.

### 2. List the ids and check the router's path

```bash
node .claude/skills/add-route/scripts/check-route.mjs            # entry / exit ids and labels
node .claude/skills/add-route/scripts/check-route.mjs E20E DAG   # what drivers actually do
```

The second command prints each road sequence the router picks, and how often:

```
100%  E20E > OFFE > RB > SLV > SLIP_EN > DAG
```

(`RB` is the roundabout. Junction connectors aren't listed.)

- **It matches the drawn line.** Go on to step 3. A small share, say under 10%, on a
  sensible alternative is fine and is what the noise is for. Mention it.
- **It's a clearly different path.** Don't add the route quietly. Tell the user
  what the router does instead, and offer a fix. The config has no waypoint
  option yet. Options:
  - steer it with `CONFIG.routing.penalty`, but this affects every route that uses
    that road;
  - add `via` waypoint support to routes, by routing leg by leg in
    `World.trySpawn`;
  - the network may be missing the movement. Check the `ban` lists on junctions in
    `js/network/roads.js`, and whether the connector exists.
- **`NO PATH`.** The network can't make that trip. Find the missing link or the
  banned turn before touching the routes.

### 3. Add the route

Add one line to `CONFIG.routes` in `js/config.js`:

- `id`: short and stable, e.g. `GBG-STK`. The UI and the self-test key on it.
- `label`: `Origin → Destination`, using the place names the user used. This is
  what the table shows.
- `from` / `to`: an entry id and an exit id from step 2. The same id can be both,
  e.g. `E20E` is "E20 från Göteborg" as an entry and "E20 mot Alingsås" as an
  exit.
- `rate`: use the user's number if they gave one. Otherwise pick something
  plausible: E20 through traffic around 20–25, a route off the motorway onto
  local roads around 2–5, small local roads around 1. Say what you picked; the
  user can change it with −/+.
- Add a one-line comment above it with the path in words, so the next person can
  see the intent.

You don't need to change any UI code. `js/ui/controls.js` makes one table row
per route, with −/+ buttons.

### 4. Verify

```bash
node test/selftest.mjs 20 1
```

It must print `SELFTEST OK`, and the new route's `spawned/expected` should be
close, e.g. `GBG-STK:56/60`. Fewer spawned with a queue (`q12`) means the entry
lane is too congested for the rate.

To check the page itself (optional, but good when you changed more than
config), load it in headless Chrome and read the table rows, e.g.
`[...document.querySelectorAll('#routes tbody tr')].map(t => t.innerText)`. Then
look at a screenshot of the route area.

### 5. Report back

Say which path the cars take, in road names rather than ids, the rate you set,
and the self-test result. Mention any side effect: e.g. with only a few routes,
junctions on the new path may have no crossing traffic, so nobody needs to yield
yet. Don't commit unless the user asks.

## Road guide (as seen in the default top-down view)

The ids are `roadId`s from `js/network/roads.js`. Check there if this guide looks
out of date.

| id | road | where it is |
|---|---|---|
| `E20E` | E20 eastbound | southern carriageway; enters bottom-left (from Göteborg), leaves top-right (to Alingsås) |
| `E20W` | E20 westbound | northern carriageway; enters top-right, leaves bottom-left |
| `OFFE` | Avfart 86 (eastbound) | leaves E20E just north-east of the Dageborgsleden bridge, loops east then south down to the roundabout's west side |
| `ONE` | Påfart 86 (eastbound) | from the roundabout's north-west side up to E20E |
| `OFFW` / `ONW` | westbound ramps | long ramps on the north side of E20, meeting Dageborgsleden at grade (junction `J_CW`) |
| `RB` | roundabout | east of the motorway; legs: OFFE, ONE, HED, HAR, SLV |
| `SLV` | Södra Långvägen | from the roundabout's south side, west past the Dageborgsleden junction and the commuter lot, out at the left/bottom-left edge |
| `HED` | Hedeforsvägen | roundabout → north-east, out at the top-right |
| `HAR` | Härskogsvägen | roundabout → east/south-east, out at the bottom-right |
| `DAG` | Dageborgsleden | enters top-left (towards Stenkullen), runs south-east under E20, ends on Södra Långvägen |
| `SLIP_SW` / `SLIP_EN` | right-turn slips | Dageborgsleden south → Södra Långvägen west, and Södra Långvägen west → Dageborgsleden north |
| `KAST` | Kastenhofsvägen | left edge → joins Dageborgsleden north of E20 |
| `LAG` | Laggarns väg | south off Södra Långvägen, out at the bottom edge |
| `JUT` | Jutagårdsvägen | branches east off Laggarns väg, out at the bottom |
| `PEND` / `P` | commuter lot | short road off Södra Långvägen; `P` is the lot as an entry/exit |
