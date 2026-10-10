// Overlay UI built with D3: a "cars per minute" chip with −/+ at every road
// entering the view, plus the HUD (stats, pause, speed, time of day, debug).
import * as d3 from 'd3';
import * as THREE from 'three';

export function createControls({ world, camera, onToggle }) {
  const chips = d3.select('#chips');
  const data = world.entries.map((e) => ({ e, anchor: new THREE.Vector3(e.anchor[0], 3, e.anchor[1]) }));
  const sel = chips.selectAll('div.chip').data(data, (d) => d.e.id).join((enter) => {
    const c = enter.append('div').attr('class', (d) => `chip${d.e.motorway ? ' motorway' : ''}`);
    c.append('div').attr('class', 'name').text((d) => d.e.label);
    const row = c.append('div').attr('class', 'row');
    row.append('button').attr('aria-label', 'Färre bilar').text('−').on('click', (ev, d) => bump(d, ev.shiftKey ? -5 : -1));
    row.append('div').attr('class', 'rate');
    row.append('button').attr('aria-label', 'Fler bilar').text('+').on('click', (ev, d) => bump(d, ev.shiftKey ? 5 : 1));
    c.append('div').attr('class', 'unit').text('cars / min');
    c.append('div').attr('class', 'queue');
    return c;
  });
  function bump(d, delta) {
    const cur = d.e.rate;
    let next = cur + delta;
    if (delta < 0 && cur <= 1 && cur > 0) next = cur === 1 ? 0.5 : 0;
    else if (delta > 0 && cur < 1) next = cur === 0 ? 0.5 : 1;
    world.setRate(d.e.id, Math.max(0, Math.min(90, next)));
    refreshText();
  }
  function refreshText() {
    sel.select('.rate').text((d) => (d.e.rate % 1 ? d.e.rate.toFixed(1) : d.e.rate));
    sel.select('.queue').text((d) => (d.e.queue > 0 ? `${d.e.queue} väntar` : ''));
  }
  refreshText();

  const v = new THREE.Vector3();
  function position() {
    const W = window.innerWidth, H = window.innerHeight;
    const top = (document.getElementById('hud')?.getBoundingClientRect().bottom || 0) + 46;
    const m = 64;
    for (const d of data) {
      v.copy(d.anchor).project(camera);
      d.behind = v.z > 1;
      d.x = Math.max(m, Math.min(W - m, (v.x * 0.5 + 0.5) * W));
      d.y = Math.max(top, Math.min(H - 40, (-v.y * 0.5 + 0.5) * H));
    }
    // push overlapping chips apart (a few relaxation passes)
    const cw = 124, ch = 74;
    for (let it = 0; it < 12; it++) for (let i = 0; i < data.length; i++) for (let j = i + 1; j < data.length; j++) {
      const a = data[i], b = data[j];
      const ox = cw - Math.abs(a.x - b.x), oy = ch - Math.abs(a.y - b.y);
      if (ox > 0 && oy > 0) {
        if (ox < oy) { const s = (a.x < b.x ? -1 : 1) * ox / 2; a.x += s; b.x -= s; }
        else { const s = (a.y < b.y ? -1 : 1) * oy / 2; a.y += s; b.y -= s; }
        for (const c of [a, b]) { c.x = Math.max(m, Math.min(W - m, c.x)); c.y = Math.max(top, Math.min(H - 40, c.y)); }
      }
    }
    sel.each(function (d) {
      this.style.left = `${Math.max(m, Math.min(W - m, d.x))}px`;
      this.style.top = `${Math.max(top, Math.min(H - 40, d.y))}px`;
      this.style.opacity = d.behind ? 0 : 1;
    });
  }

  // ----- HUD
  const speeds = [1, 2, 4, 8];
  const state = { speed: 1, paused: false, tod: 'day', debug: false, ref: false };
  d3.select('#seg-speed').selectAll('button').data(speeds).join('button').text((d) => `${d}×`)
    .classed('on', (d) => d === state.speed).on('click', (ev, d) => { state.speed = d; d3.selectAll('#seg-speed button').classed('on', (x) => x === d); });
  const tods = [['day', 'Dag'], ['golden', 'Kväll'], ['night', 'Natt']];
  d3.select('#seg-tod').selectAll('button').data(tods).join('button').text((d) => d[1])
    .classed('on', (d) => d[0] === state.tod).on('click', (ev, d) => setTod(d[0]));
  function setTod(k) { state.tod = k; d3.selectAll('#seg-tod button').classed('on', (x) => x[0] === k); onToggle('tod', k); }
  const pauseBtn = d3.select('#btn-pause').on('click', () => togglePause());
  function togglePause() { state.paused = !state.paused; pauseBtn.text(state.paused ? '▶' : '❚❚').classed('on', state.paused); }
  const dbg = d3.select('#btn-debug').on('click', () => toggleDebug());
  function toggleDebug() { state.debug = !state.debug; dbg.classed('on', state.debug); d3.select('#legend').classed('hidden', !state.debug); onToggle('debug', state.debug); }
  const ref = d3.select('#btn-ref').on('click', () => toggleRef());
  function toggleRef() { state.ref = !state.ref; ref.classed('on', state.ref); onToggle('ref', state.ref); }
  d3.select('#btn-view').on('click', () => onToggle('view'));
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { togglePause(); e.preventDefault(); }
    else if (e.key === 'd' || e.key === 'D') toggleDebug();
    else if (e.key === 'r' || e.key === 'R') toggleRef();
    else if (e.key === 'v' || e.key === 'V') onToggle('view');
    else if (e.key === 'n' || e.key === 'N') setTod(state.tod === 'day' ? 'golden' : state.tod === 'golden' ? 'night' : 'day');
  });

  const stVeh = d3.select('#st-veh'), stFlow = d3.select('#st-flow'), stClock = d3.select('#st-clock');
  let lastStat = 0;
  function update(now) {
    position();
    if (now - lastStat > 400) {
      lastStat = now;
      refreshText();
      stVeh.text(world.vehicles.length);
      stFlow.text(Math.round(world.throughputPerMin()));
      const mins = 7 * 60 + 30 + world.t / 60;
      stClock.text(`${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`);
    }
  }
  return { state, update };
}
