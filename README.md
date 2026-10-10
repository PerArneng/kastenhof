# Kastenhof traffic simulation

3D traffic simulation of Kastenhofsmotet (E20 exit 86, Lerum), built from `references/kastenhof.png`.
Three.js renders the scene and D3 drives the overlay UI. The simulation is plain JS and has no build step.

```sh
python3 -m http.server 8000   # or any static server
open http://localhost:8000
node test/selftest.mjs 20 1.5   # headless sim check: overlaps, gridlock, throughput
```

Controls: drag/scroll to orbit and zoom. `Space` pauses, `D` turns on the debug overlay (lanes, conflict points, vehicle states), `R` shows the reference map on the ground, `N` cycles day / evening / night, and `V` resets the view. The −/+ chips at each entry change the cars per minute; hold Shift to step by 5.

## Where to tune
- `js/config.js`: speed limits, spawn rates, origin→destination weights, gap acceptance, driver model, lane-change parameters.
- `js/network/traces.js`: road centrelines in map pixels, auto-snapped to the reference image.
- `js/network/roads.js`: topology and junction rules (`priority` = väjningsplikt for `minor` legs, `exit` = utfartsregeln, `right` = högerregeln, `roundabout`).

## Traffic rules modelled
- Right-hand traffic.
- Väjningsplikt at side roads and roundabout entries.
- Högerregeln at the unsigned Laggarns väg / Jutagårdsvägen junction.
- Utfartsregeln when leaving the commuter car park.
- Left-turners yield to oncoming traffic.
- Drivers don't enter a junction they can't leave.
- On the motorway: keep right and overtake on the left only (no undertaking). Traffic merges from acceleration lanes on a safe gap, and the zipper principle (kugghjulsprincipen) applies at the end of the acceleration lane.
- Drivers signal at turns, lane changes and when leaving the roundabout.
- Drivers slow for curves and lower limits ahead.

Assumption: the map shows no westbound E20 ramps at Kastenhofsmotet. The long one-way road north of E20 is therefore modelled as a westbound parallel carriageway that splits from E20 and rejoins it.
