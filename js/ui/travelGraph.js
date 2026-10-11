// Travel time through the junction under test (J_CW) over the last 15 sim
// minutes, so the crossing and the roundabout can be compared after toggling.
// Each point is the mean over cars that left in the 2 minutes before it; the
// line takes the colour of the layout that was active at that moment.
import * as d3 from 'd3';

const SPAN = 900, STEP = 10, WINDOW = 120;
const W = 300, H = 132, M = { top: 8, right: 10, bottom: 20, left: 30 };
export const LAYOUT_STYLE = {
  cross: { name: 'Korsning', color: '#3987e5' },
  roundabout: { name: 'Cirkulation', color: '#d95926' },
};
const clock = (t) => { const m = 7 * 60 + 30 + t / 60; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`; };

export function createTravelGraph(root, world) {
  root.append('div').attr('class', 'gr-title').text('Restid genom korsningen');
  root.append('div').attr('class', 'gr-sub').text('medel för bilar som kört igenom, senaste 2 min (s)');
  const legend = root.append('div').attr('class', 'gr-legend');
  for (const k of Object.keys(LAYOUT_STYLE)) {
    const it = legend.append('span');
    it.append('i').style('background', LAYOUT_STYLE[k].color);
    it.append('span').text(LAYOUT_STYLE[k].name);
  }
  const svg = root.append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H)
    .attr('role', 'img').attr('aria-label', 'Restid genom korsningen över tid');
  const x = d3.scaleLinear().range([M.left, W - M.right]);
  const y = d3.scaleLinear().range([H - M.bottom, M.top]);
  const gGrid = svg.append('g').attr('class', 'gr-grid');
  const gX = svg.append('g').attr('class', 'gr-axis').attr('transform', `translate(0,${H - M.bottom})`);
  const gY = svg.append('g').attr('class', 'gr-axis').attr('transform', `translate(${M.left},0)`);
  const gSwitch = svg.append('g');
  const gLines = svg.append('g');
  const hair = svg.append('line').attr('class', 'gr-hair').attr('y1', M.top).attr('y2', H - M.bottom).style('display', 'none');
  const dot = svg.append('circle').attr('r', 4).attr('class', 'gr-dot').style('display', 'none');
  const tip = root.append('div').attr('class', 'gr-tip').style('display', 'none');
  let samples = [], hoverT = null;

  const layoutAt = (t) => { let l = 'cross'; for (const s of world.stats.switches) if (s.t <= t) l = s.layout; return l; };

  function draw() {
    const now = world.t, t0 = Math.max(0, now - SPAN);
    samples = [];
    for (let t = Math.ceil(t0 / STEP) * STEP; t <= now; t += STEP) {
      const a = world.recentAvg(WINDOW, true, t);
      samples.push({ t, ...a, layout: layoutAt(t) });
    }
    x.domain([now - SPAN, now]);
    const ymax = d3.max(samples, (d) => d.travel) || 60;
    y.domain([0, Math.max(60, ymax * 1.15)]).nice();
    gGrid.selectAll('line').data(y.ticks(4)).join('line')
      .attr('x1', M.left).attr('x2', W - M.right).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
    gX.call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(6).tickFormat((t) => (t < 0 ? '' : clock(t)))).call((g) => g.select('.domain').remove());
    gY.call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(6)).call((g) => g.select('.domain').remove());

    // One path per run of the same layout, so the colour changes at each switch.
    const runs = [];
    for (const s of samples) {
      const last = runs[runs.length - 1];
      if (!last || last.layout !== s.layout) runs.push({ layout: s.layout, pts: last ? [last.pts[last.pts.length - 1], s] : [s] });
      else last.pts.push(s);
    }
    const line = d3.line().defined((d) => Number.isFinite(d.travel)).x((d) => x(d.t)).y((d) => y(d.travel));
    gLines.selectAll('path').data(runs).join('path').attr('class', 'gr-line')
      .attr('stroke', (r) => LAYOUT_STYLE[r.layout].color).attr('d', (r) => line(r.pts));

    const sw = world.stats.switches.filter((s) => s.t > 0 && s.t >= now - SPAN);
    const g = gSwitch.selectAll('g').data(sw).join((e) => { const g = e.append('g').attr('class', 'gr-switch'); g.append('line'); g.append('text'); return g; });
    g.select('line').attr('x1', (s) => x(s.t)).attr('x2', (s) => x(s.t)).attr('y1', M.top).attr('y2', H - M.bottom);
    g.select('text').attr('x', (s) => x(s.t) + 3).attr('y', M.top + 8).text((s) => LAYOUT_STYLE[s.layout].name);
    if (hoverT != null) showAt(hoverT);
  }

  function showAt(t) {
    const d = samples.length ? samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)) : null;
    if (!d) return;
    hair.style('display', null).attr('x1', x(d.t)).attr('x2', x(d.t));
    const ok = Number.isFinite(d.travel);
    dot.style('display', ok ? null : 'none').attr('cx', x(d.t)).attr('cy', ok ? y(d.travel) : 0).attr('fill', LAYOUT_STYLE[d.layout].color);
    tip.style('display', null);
    tip.selectAll('*').remove();
    tip.append('div').attr('class', 'gr-tip-h').text(`${clock(d.t)} · ${LAYOUT_STYLE[d.layout].name}`);
    tip.append('div').text(ok ? `Restid ${d.travel.toFixed(0)} s` : 'Inga bilar ännu');
    if (ok) tip.append('div').text(`Väntetid ${d.stop.toFixed(1)} s · ${d.n} bilar`);
  }
  svg.append('rect').attr('x', M.left).attr('y', 0).attr('width', W - M.left - M.right).attr('height', H).attr('fill', 'transparent')
    .on('pointermove', (ev) => { hoverT = x.invert(d3.pointer(ev)[0]); showAt(hoverT); })
    .on('pointerleave', () => { hoverT = null; hair.style('display', 'none'); dot.style('display', 'none'); tip.style('display', 'none'); });

  return { draw };
}
