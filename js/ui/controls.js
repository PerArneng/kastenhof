// Overlay UI built with D3: the routes table (cars per minute per route,
// with −/+) and the HUD (stats, pause, speed, time of day, debug).
import * as d3 from 'd3';
import { createTravelGraph } from './travelGraph.js';

export function createControls({ world, onToggle, onHoverRoute = () => {}, onHoverAuto = () => {} }) {
  const rows = d3.select('#routes tbody').selectAll('tr').data(world.routes, (r) => r.id).join((enter) => {
    const tr = enter.append('tr')
      .on('mouseenter', function (ev, r) { d3.select(this).classed('hover', true); onHoverRoute(r); })
      .on('mouseleave', function () { d3.select(this).classed('hover', false); onHoverRoute(null); });
    const name = tr.append('td').attr('class', 'rt-name');
    name.append('div').text((r) => r.label);
    name.append('div').attr('class', 'rt-queue');
    const ctl = tr.append('td').attr('class', 'rt-rate').append('div').attr('class', 'stepper');
    ctl.append('button').attr('aria-label', 'Färre bilar').attr('title', 'Shift: −5').text('−').on('click', (ev, r) => bump(r, ev.shiftKey ? -5 : -1));
    ctl.append('span').attr('class', 'rate');
    ctl.append('button').attr('aria-label', 'Fler bilar').attr('title', 'Shift: +5').text('+').on('click', (ev, r) => bump(r, ev.shiftKey ? 5 : 1));
    return tr;
  });
  // Hovering the title highlights every route at once.
  d3.select('#routes .rt-title')
    .on('mouseenter', () => onHoverRoute(world.routes))
    .on('mouseleave', () => onHoverRoute(null));
  function bump(r, delta) {
    const cur = r.rate;
    let next = cur + delta;
    if (delta < 0 && cur <= 1 && cur > 0) next = cur === 1 ? 0.5 : 0;
    else if (delta > 0 && cur < 1) next = cur === 0 ? 0.5 : 1;
    world.setRate(r.id, Math.max(0, Math.min(90, next)));
    refreshText();
  }
  function refreshText() {
    rows.select('.rate').text((r) => (r.rate % 1 ? r.rate.toFixed(1) : r.rate));
    rows.select('.rt-queue').text((r) => (r.queue > 0 ? `${r.queue} väntar vid infarten` : ''));
  }
  refreshText();

  // ----- HUD
  const speeds = [1, 2, 4, 8];
  const state = { speed: 1, paused: false, tod: 'day', debug: false, ref: false, hover: true, auto: false, autoSpeed: 2 };
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
  // Cycles: off → Google map → satellite photo → off
  function toggleRef() {
    state.ref = state.ref === false ? 'map' : state.ref === 'map' ? 'satellite' : false;
    ref.classed('on', !!state.ref).text(state.ref === 'satellite' ? 'Ref: satellit' : state.ref === 'map' ? 'Ref: karta' : 'Ref');
    onToggle('ref', state.ref);
  }
  const hov = d3.select('#btn-hover').on('click', () => toggleHover());
  function setHover(on) { state.hover = on; hov.classed('on', on); onToggle('hover', on); }
  // Auto mode needs the drone hover, so turning the hover off ends auto mode.
  function toggleHover() { if (state.hover && state.auto) setAuto(false); setHover(!state.hover); }
  const autoBtn = d3.select('#btn-auto').on('click', () => setAuto(!state.auto))
    .on('mouseenter', () => onHoverAuto(true)).on('mouseleave', () => onHoverAuto(false));
  const autoSpeed = d3.select('#seg-autospeed');
  autoSpeed.selectAll('button').data([1, 2, 4]).join('button').text((d) => `${d}×`)
    .classed('on', (d) => d === state.autoSpeed).on('click', (ev, d) => {
      state.autoSpeed = d; autoSpeed.selectAll('button').classed('on', (x) => x === d); onToggle('autoSpeed', d);
    });
  function setAuto(on) {
    if (on === state.auto) return;
    state.auto = on;
    autoBtn.classed('on', on);
    autoSpeed.classed('hidden', !on);
    if (on && !state.hover) setHover(true);
    onToggle('auto', on);
  }
  // Show / hide the menus; remembered per browser. The toggle sits below
  // the HUD, whose height changes when it wraps on narrow windows.
  const hudEl = document.getElementById('hud');
  const placeUiBtn = () => document.documentElement.style.setProperty('--hud-bottom', `${hudEl.offsetTop + hudEl.offsetHeight}px`);
  new ResizeObserver(placeUiBtn).observe(hudEl);
  placeUiBtn();
  const uiBtn = d3.select('#btn-ui').on('click', () => setUi(!state.ui));
  function setUi(on) {
    state.ui = on;
    document.body.classList.toggle('ui-hidden', !on);
    uiBtn.attr('title', on ? 'Dölj menyer (M)' : 'Visa menyer (M)').attr('aria-label', on ? 'Dölj menyer' : 'Visa menyer').attr('aria-pressed', on);
    try { localStorage.setItem('kastenhof.ui', on ? '1' : '0'); } catch {}
  }
  let uiSaved = null;
  try { uiSaved = localStorage.getItem('kastenhof.ui'); } catch {}
  setUi(uiSaved !== '0');
  d3.select('#btn-view').on('click', () => { setAuto(false); onToggle('view'); });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { togglePause(); e.preventDefault(); }
    else if (e.key === 'd' || e.key === 'D') toggleDebug();
    else if (e.key === 'r' || e.key === 'R') toggleRef();
    else if (e.key === 'v' || e.key === 'V') { setAuto(false); onToggle('view'); }
    else if (e.key === 'h' || e.key === 'H') toggleHover();
    else if (e.key === 'a' || e.key === 'A') setAuto(!state.auto);
    else if (e.key === 'm' || e.key === 'M') setUi(!state.ui);
    else if (e.key === 'c' || e.key === 'C') onToggle('junction');
    else if (e.key === 'n' || e.key === 'N') setTod(state.tod === 'day' ? 'golden' : state.tod === 'golden' ? 'night' : 'day');
  });

  const graph = createTravelGraph(d3.select('#graph'), world);
  const stTravel = d3.select('#st-travel'), stStop = d3.select('#st-stop');
  let lastGraph = 0;
  const stVeh = d3.select('#st-veh'), stFlow = d3.select('#st-flow'), stClock = d3.select('#st-clock');
  let lastStat = 0;
  function update(now) {
    if (now - lastGraph > 1000) { lastGraph = now; graph.draw(); }
    if (now - lastStat > 400) {
      lastStat = now;
      refreshText();
      stVeh.text(world.vehicles.length);
      stFlow.text(Math.round(world.throughputPerMin()));
      const avg = world.recentAvg();
      stTravel.text(Number.isFinite(avg.travel) ? Math.round(avg.travel) : '–');
      stStop.text(Number.isFinite(avg.stop) ? avg.stop.toFixed(1) : '–');
      const mins = 7 * 60 + 30 + world.t / 60;
      stClock.text(`${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`);
    }
  }
  return { state, update, setAuto };
}
