// Headless check of the simulation: no overlaps, no gridlock, throughput ≈ rates.
// Run: node test/selftest.mjs [minutes] [rateMultiplier]
import { buildNetwork } from '../js/network/build.js';
import { World } from '../js/sim/world.js';
import { CONFIG } from '../js/config.js';

const minutes = Number(process.argv[2] || 20);
const mult = Number(process.argv[3] || 1.5);
const net = buildNetwork();
const world = new World(net, { seed: 42 });
for (const e of world.entries) world.setRate(e.id, e.rate * mult);

const dt = CONFIG.sim.dt;
const steps = Math.round((minutes * 60) / dt);
let overlaps = 0, maxStuck = 0, stuckWho = null, peak = 0;
const overlapLog = [];
for (let i = 0; i < steps; i++) {
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
const expected = world.entries.reduce((a, e) => a + e.rate, 0) * minutes;
const queued = world.entries.reduce((a, e) => a + e.queue, 0);
console.log(`simulated ${minutes} min, rates x${mult}`);
console.log(`spawned ${spawned} (expected ≈${expected.toFixed(0)}), exited ${exited}, on map ${world.vehicles.length}, peak ${peak}, queued ${queued}`);
console.log('per entry:', world.entries.map((e) => `${e.id}:${e.spawned}/${(e.rate * minutes).toFixed(0)}${e.queue ? ' q' + e.queue : ''}`).join(' '));
const avgTravel = world.stats.travel.reduce((a, b) => a + b, 0) / Math.max(1, world.stats.travel.length);
console.log(`avg travel time ${avgTravel.toFixed(0)} s, overlaps ${overlaps}, longest wait ${maxStuck.toFixed(1)} s (${stuckWho})`);
overlapLog.forEach((l) => console.log('  overlap', l));
let fail = false;
if (overlaps > 0) { console.log('FAIL: overlapping vehicles'); fail = true; }
if (maxStuck > 90) { console.log('FAIL: vehicle stuck > 90 s'); fail = true; }
if (spawned < expected * 0.8) { console.log('FAIL: spawn rate well below configured'); fail = true; }
console.log(fail ? 'SELFTEST FAILED' : 'SELFTEST OK');
process.exit(fail ? 1 : 0);
