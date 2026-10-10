# Kastenhof traffic simulation

3D traffic simulation of Kastenhofsmotet (E20 exit 86, Lerum), built from `references/kastenhof.png` (Google map) and refined with `references/kastenhof-satelite.png` (satellite photo). The map is shown as a diorama block.
Three.js renders the scene and D3 drives the overlay UI. The simulation is plain JS and has no build step.

```sh
python3 -m http.server 8000   # or any static server
open http://localhost:8000
node test/selftest.mjs 20 1.5   # headless sim check: overlaps, gridlock, throughput
```

Controls: drag to orbit, right-drag to pan, scroll to zoom towards the point under the mouse. `Space` pauses, `D` turns on the debug overlay (lanes, conflict points, vehicle states), `R` cycles the reference overlay (Google map → satellite photo → off), `N` cycles day / evening / night, and `V` resets the view. The −/+ chips at each entry change the cars per minute; hold Shift to step by 5.

## Where to tune
- `js/config.js`: speed limits, spawn rates, origin→destination weights, gap acceptance, driver model, lane-change parameters.
- `js/network/traces.js`: road centrelines in map pixels, auto-snapped to the reference image.
- `tools/satellite.py`: regenerates `references/satellite-map.webp` (satellite warped onto the map) and `references/landcover.png` (forest cover used for tree placement). Run it with `uv run --with numpy --with pillow --with scipy python tools/satellite.py`.
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

The westbound E20 exit and entry ramps north of E20 cross Dageborgsleden at grade, as on the satellite photo.

If the browser keeps showing an old version after an update, hard-reload (Cmd+Shift+R): `python3 -m http.server` lets the browser cache the modules.
