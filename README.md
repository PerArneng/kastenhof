# Kastenhof traffic simulation

3D traffic simulation of Kastenhofsmotet (E20 exit 86, Lerum), built from `references/kastenhof.png` (Google map) and refined with `references/kastenhof-satelite.png` (satellite photo). The map is shown as a diorama block.
Three.js renders the scene and D3 drives the overlay UI. The simulation is plain JS and has no build step.

```sh
python3 -m http.server 8000   # or any static server
open http://localhost:8000
node test/selftest.mjs 20 1.5   # headless sim check: overlaps, gridlock, throughput
```

Controls: drag to orbit, right-drag to pan, scroll to zoom towards the point under the mouse. Keys:

| Key | |
|---|---|
| `Space` | pause |
| `A` | auto mode on/off |
| `H` | Drönare (drone hover) on/off |
| `M` | hide / show the menus |
| `V` | reset the view |
| `N` | cycle day / evening / night |
| `D` | debug overlay (lanes, conflict points, vehicle states) |
| `R` | cycle the reference overlay (Google map → satellite photo → off) |
| `C` | switch the Dageborgsleden / westbound ramps junction between crossing and roundabout |

**Auto mode** is on when the page loads. The camera flies a slow loop like a traffic helicopter, from a high overview down to close-ups of the roundabout, the bridge and the side roads. It runs at 1×, 2× (the default) or 4×. Drönare stays on while it runs. Dragging, panning or zooming hands the camera back to you, and turning Auto on again eases the camera back onto the loop. Hover over the Auto button to see the loop and the spots it looks at.

**Drönare** adds a slight, smooth up-and-down hover to the camera.

**Routes table** (top right): one row per route with its cars per minute. −/+ change the rate, and holding Shift steps by 5. Hover over a row to see that route on the map as arrows in the direction of travel, or over the "Rutter" title to see all routes at once.

**Crossing or roundabout:** the point of the simulation is to test whether a roundabout would make traffic smoother where Dageborgsleden crosses the westbound E20 ramps. The round yellow button floating above that junction switches it live between today's crossing and a roundabout (or press `C`). It shows the layout you switch *to*. Cars already on the road are moved onto the new layout. The HUD shows **Restid** and **Väntetid**: the average travel time and time spent stopped for cars that drove through that junction, over the last 2 sim-minutes. The graph at the bottom left plots that travel time over the last 15 sim-minutes, coloured by layout, with a marker at each switch.

**Hiding the menus:** the eye button below the top-left menu slides the menus out of view, which is useful for a wall-mounted dashboard. Click it again to bring them back. The browser remembers the choice.

## Where to tune
- `js/config.js`: speed limits, gap acceptance, driver model, lane-change parameters, and the routes (origin, destination and cars per minute). Add new routes with the `add-route` Claude skill, which also checks the path drivers actually take.
- `js/network/traces.js`: road centrelines in map pixels, auto-snapped to the reference image.
- `tools/satellite.py`: regenerates `references/satellite-map.webp` (satellite warped onto the map) and `references/landcover.png` (forest cover used for tree placement). Run it with `uv run --with numpy --with pillow --with scipy python tools/satellite.py`.
- `js/render/autoCam.js`: the auto-mode camera loop (`SHOTS`) and its speed.
- `js/network/roads.js`: map labels (`LABELS`), topology and junction rules (`priority` = väjningsplikt for `minor` legs, `exit` = utfartsregeln, `right` = högerregeln, `roundabout`).

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

The westbound E20 exit and entry ramps north of E20 cross Dageborgsleden at grade, as on the satellite photo. The roundabout alternative is `LAYOUTS.roundabout` in `js/network/roads.js`.

To compare the two layouts from the command line, run `node test/selftest.mjs 20 1 cross`, `... roundabout` or `... toggle` (switches every 2 sim-minutes). Each prints the average travel and stopped time for cars through that junction.

If the browser keeps showing an old version after an update, hard-reload (Cmd+Shift+R): `python3 -m http.server` lets the browser cache the modules.
