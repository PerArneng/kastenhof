This is a traffic simulation of the Kastenhof area. references/kastenhof.png is the reference image from google maps.

See README.md for how to run it, the controls and where to tune things. The notes below are an overview of decisions that aren't obvious from the code.

## Traffic
- Traffic is defined only by `CONFIG.routes` in `js/config.js` (entry, exit, cars per minute). Every car runs Dijkstra from entry to exit, with a little per-driver noise (`js/sim/routing.js`).
- To add a route, use the `add-route` skill (`.claude/skills/add-route`). Its `scripts/check-route.mjs` shows which road sequence drivers actually take.
- `node test/selftest.mjs 20 1` must print `SELFTEST OK` after any change to the network or the simulation.

## Rendering
- The canvas `antialias` flag does nothing, because everything is drawn through the EffectComposer (bloom). The composer gets its own 4× MSAA render target in `js/render/scene.js`. Without it, the thin lane markings shimmer as the camera moves.
- The diorama clips all geometry at the block edges (`renderer.clippingPlanes`). Overlays that must reach outside the block are drawn on the 2D canvas `#overlay2d`, projected from 3D each frame. The auto-mode path preview (`js/ui/pathPreview.js`) is one example.
- Route highlight: hovering a row in the routes table draws that route's main (noise-free) path as floating arrows (`js/render/routeOverlay.js`). The arrows scale with zoom, so they keep a steady size on screen.
- Map labels are kept minimal on purpose. There are two E20 shields, one near each end of the motorway. There are no "86 Kastenhofsmotet" exit signs and no place-name pins (`LABELS` in `js/network/roads.js`).
- The day backdrop gradient was darkened slightly (`TOD.day.backdrop`).

## Camera
- Drönare (drone hover, `H`) adds a slow drift to the camera only while rendering, then removes it again. OrbitControls never sees it.
- Auto mode (`A`, `js/render/autoCam.js`) is an ambient "traffic chopper" and is on by default, at 2× speed (choices are 1×, 2× and 4×).
  - It flies a closed loop of orbit poses (`SHOTS`: target, distance, polar angle, bearing). The loop is interpolated in orbit parameters, never in raw positions, so the camera can't dip into the ground. The bearing adds up to one full turn per loop.
  - Turning it on also turns on Drönare. The camera then eases back onto the nearest point of the loop. Turning Drönare off ends auto mode.
  - Any user orbit, pan or zoom (OrbitControls `start`) turns auto mode off, and so does reset view (`V`).
  - Hovering the Auto button previews the loop and its focus points.

## UI
- The HUD (top left) and the routes table (top right) can be hidden with the eye button just below the HUD, or with `M`. They slide out (HUD up, routes right). The choice is kept in `localStorage`.
- UI text is in Swedish.

## Checking the page
- Serve the folder statically (`python3 -m http.server`), drive headless Chrome over the DevTools protocol, and take screenshots. `window.kastenhof` exposes `net`, `world`, `view` and `autoCam` for scripting.
