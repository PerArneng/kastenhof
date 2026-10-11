// Headless check of the simulation: no overlaps, no gridlock, throughput ≈ rates.
// Run: node test/selftest.mjs [minutes] [rateMultiplier] [cross|roundabout|toggle]
// `toggle` switches J_CW between crossing and roundabout every 2 sim-minutes.
import { buildNetwork } from '../js/network/build.js';
import { LAYOUTS } from '../js/network/roads.js';
import { World } from '../js/sim/world.js';
import { CONFIG } from '../js/config.js';

const minutes = Number(process.argv[2] || 20);
const mult = Number(process.argv[3] || 1.5);
const mode = process.argv[4] || 'cross';
if (!['cross', 'roundabout', 'toggle'].includes(mode)) throw new Error(`unknown layout ${mode}`);
const nets = { cross: buildNetwork(LAYOUTS.cross), roundabout: buildNetwork(LAYOUTS.roundabout) };
const start = mode === 'roundabout' ? 'roundabout' : 'cross';
let net = nets[start];
const world = new World(net, { seed: 42, layout: start });
for (const r of world.routes) world.setRate(r.id, r.rate * mult);

const dt = CONFIG.sim.dt;
const steps = Math.round((minutes * 60) / dt);
let overlaps = 0, maxStuck = 0, stuckWho = null, peak = 0;
const overlapLog = [];
const swapEvery = Math.round(120 / dt);
let swaps = 0, carsBefore = 0, carsAfter = 0;
for (let i = 0; i < steps; i++) {
  if (mode === 'toggle' && i > 0 && i % swapEvery === 0) {
    const next = world.layout === 'cross' ? 'roundabout' : 'cross';
    carsBefore += world.vehicles.length;
    net = nets[next];
    world.setNetwork(net, next);
    carsAfter += world.vehicles.length;
    swaps++;
  }
  world.step(dt);
  peak = Math.max(peak, world.vehicles.length);
  if (i % 15 === 0) {
    for (const p of net.paths) {
      const vs = p.vehicles.slice().sort((a, b) => a.s - b.s);
      for (let k = 0; k + 1 < vs.length; k++) {
        const a = vs[k], b = vs[k + 1];
        if (b.s - b.len < a.s - 0.3) { overlaps++; if (overlapLog.length < 8) overlapLog.push(`t=${world.t.toFixed(0)} path ${p.id}(${p.kind} ${p.roadId || p.junction || ''}) ${a.id}@${a.s.toFixed(1)} ${b.id}@${b.s.toFixed(1)}`); }
      }
    }
    for (const v of world.vehicles) if (v.waitT > maxStuck) { maxStuck = v.waitT; stuckWho = `${v.id} on ${v.path.id}(${v.path.kind} ${v.path.roadId || v.path.junction || ''}) s=${v.s.toFixed(1)} yielding=${v.yielding} dest=${v.dest}`; }
  }
}
const spawned = world.stats.spawned, exited = world.stats.exited;
const expected = world.routes.reduce((a, r) => a + r.rate, 0) * minutes;
const queued = world.routes.reduce((a, r) => a + r.queue, 0);
console.log(`simulated ${minutes} min, rates x${mult}, layout ${mode}`);
if (swaps) console.log(`swaps ${swaps}: ${carsAfter}/${carsBefore} cars kept across swaps (${world.stats.dropped} dropped)`);
const byLayout = {};
for (const tr of world.stats.trips) {
  if (!tr.via) continue;
  const b = (byLayout[tr.layout] ||= { n: 0, travel: 0, stop: 0 }); b.n++; b.travel += tr.travel; b.stop += tr.stop;
}
for (const [k, b] of Object.entries(byLayout)) console.log(`  via J_CW, ${k}: ${b.n} trips, avg travel ${(b.travel / b.n).toFixed(1)} s, avg stopped ${(b.stop / b.n).toFixed(1)} s`);
console.log(`spawned ${spawned} (expected ≈${expected.toFixed(0)}), exited ${exited}, on map ${world.vehicles.length}, peak ${peak}, queued ${queued}`);
console.log('per route:', world.routes.map((r) => `${r.id}:${r.spawned}/${(r.rate * minutes).toFixed(0)}${r.queue ? ' q' + r.queue : ''}`).join(' '));
const avgTravel = world.stats.travel.reduce((a, b) => a + b, 0) / Math.max(1, world.stats.travel.length);
console.log(`avg travel time ${avgTravel.toFixed(0)} s, overlaps ${overlaps}, longest wait ${maxStuck.toFixed(1)} s (${stuckWho})`);
overlapLog.forEach((l) => console.log('  overlap', l));
let fail = false;
if (overlaps > 0) { console.log('FAIL: overlapping vehicles'); fail = true; }
if (maxStuck > 90) { console.log('FAIL: vehicle stuck > 90 s'); fail = true; }
if (swaps && carsAfter < carsBefore * 0.9) { console.log('FAIL: too many cars lost when switching layout'); fail = true; }
if (spawned < expected * 0.8) { console.log('FAIL: spawn rate well below configured'); fail = true; }
console.log(fail ? 'SELFTEST FAILED' : 'SELFTEST OK');
process.exit(fail ? 1 : 0);
