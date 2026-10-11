// Which paths do drivers actually take between an entry and an exit?
//
//   node .claude/skills/add-route/scripts/check-route.mjs            list entry / exit ids
//   node .claude/skills/add-route/scripts/check-route.mjs E20E DAG   road sequences chosen
//
// Runs the real router (with its per-driver noise) for many seeds and every
// entry lane, then prints each distinct road sequence and how often it was
// picked. Compare the sequence with the line drawn on the screenshot.
const root = new URL('../../../../', import.meta.url).pathname;
const { buildNetwork } = await import(root + 'js/network/build.js');
const { Router } = await import(root + 'js/sim/routing.js');

const net = buildNetwork();
const [from, to, n = '200'] = process.argv.slice(2);

if (!from || !to) {
  console.log('entries (route `from`):');
  for (const e of Object.values(net.entries)) console.log(`  ${e.id.padEnd(5)} ${e.label}`);
  console.log('exits (route `to`):');
  for (const e of Object.values(net.exits)) console.log(`  ${e.id.padEnd(5)} ${e.label}`);
  process.exit(0);
}
if (!net.entries[from]) { console.error(`unknown entry "${from}"`); process.exit(1); }
if (!net.exits[to]) { console.error(`unknown exit "${to}"`); process.exit(1); }

const router = new Router(net);
if (!router.reach[from].has(to)) { console.log(`NO PATH from ${from} to ${to}`); process.exit(2); }

const counts = new Map();
let total = 0;
for (let seed = 1; seed <= Number(n); seed++) {
  for (const lane of net.entries[from].lanes) {
    const r = router.route(lane, to, (seed * 2654435761) >>> 0 || 1);
    total++;
    if (!r) { counts.set('(no route)', (counts.get('(no route)') || 0) + 1); continue; }
    const seq = [];
    for (const id of r) {
      const p = net.paths[id];
      const name = p.roadId || (p.kind === 'ring' ? 'RB' : null); // junction connectors are skipped
      if (name && seq[seq.length - 1] !== name) seq.push(name);
    }
    const k = seq.join(' > ');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
}
console.log(`${from} (${net.entries[from].label}) -> ${to} (${net.exits[to].label}), ${total} drivers:`);
for (const [k, c] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${((100 * c) / total).toFixed(0).padStart(3)}%  ${k}`);
