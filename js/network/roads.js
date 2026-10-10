// Topology of the Kastenhof network, built on the traced centrelines.
// Coordinates are map pixels (2000×1240). Right-hand traffic everywhere.
import { TRACES } from './traces.js';

const rev = (a) => a.slice().reverse();

export const NETWORK = {
  // One-way multi-lane motorway carriageways, listed in travel direction.
  carriageways: [
    {
      id: 'E20E', name: 'E20', lanes: 2, pts: rev(TRACES.E20E),
      entry: { id: 'E20E', label: 'E20 från Göteborg' },
      exit: { id: 'E20E', label: 'E20 mot Alingsås' },
      bridgeOver: 'DAG',
    },
    {
      id: 'E20W', name: 'E20', lanes: 2, pts: TRACES.E20W,
      entry: { id: 'E20W', label: 'E20 från Alingsås' },
      exit: { id: 'E20W', label: 'E20 mot Göteborg' },
      bridgeOver: 'DAG',
    },
  ],

  // Single-lane one-way links. `from`/`to` is either a carriageway (diverge /
  // acceleration-lane merge) or a junction.
  ramps: [
    // Eastbound off-ramp to the roundabout (avfart 86 Kastenhofsmotet).
    { id: 'OFFE', name: 'Avfart 86', pts: TRACES.OFFE, from: { carriageway: 'E20E' }, to: { junction: 'RB' }, group: 'E20E' },
    // Eastbound on-ramp from the roundabout.
    { id: 'ONE', name: 'Påfart 86', pts: TRACES.ONE, from: { junction: 'RB' }, to: { carriageway: 'E20E' }, group: 'E20E' },
    // Westbound parallel carriageway (drawn one-way on the map): splits off at
    // Kastenhofsmotet and re-joins E20 west of Dageborgsleden.
    { id: 'CONN', name: 'E20', pts: TRACES.CONN, from: { carriageway: 'E20W' }, to: { carriageway: 'E20W' }, group: 'CONN', bridgeOver: 'DAG' },
  ],

  // Two-way roads (one lane each direction).
  roads: [
    { id: 'SLV', name: 'Södra Långvägen', kind: 'main', pts: TRACES.SLV,
      start: { junction: 'RB' }, end: { boundary: { id: 'SLV', label: 'Södra Långvägen' } }, via: ['J_DS', 'J_P', 'J_LS'] },
    { id: 'HED', name: 'Hedeforsvägen', kind: 'main', pts: TRACES.HED,
      start: { junction: 'RB' }, end: { boundary: { id: 'HED', label: 'Hedeforsvägen' } } },
    { id: 'HAR', name: 'Härskogsvägen', kind: 'main', pts: TRACES.HAR,
      start: { junction: 'RB' }, end: { boundary: { id: 'HAR', label: 'Härskogsvägen' } } },
    { id: 'DAG', name: 'Dageborgsleden', kind: 'main', pts: TRACES.DAG,
      start: { boundary: { id: 'DAG', label: 'Dageborgsleden' } }, end: { junction: 'J_DS' }, via: ['J_KD'] },
    { id: 'KAST', name: 'Kastenhofsvägen', kind: 'local', pts: TRACES.KAST,
      start: { boundary: { id: 'KAST', label: 'Kastenhofsvägen' } }, end: { junction: 'J_KD' } },
    { id: 'LAG', name: 'Laggarns väg', kind: 'local', pts: TRACES.LAG,
      start: { junction: 'J_LS' }, end: { boundary: { id: 'LAG', label: 'Laggarns väg' } }, via: ['J_JL'] },
    { id: 'JUT', name: 'Jutagårdsvägen', kind: 'local', pts: TRACES.JUT,
      start: { junction: 'J_JL' }, end: { boundary: { id: 'JUT', label: 'Jutagårdsvägen' } } },
    { id: 'PEND', name: 'Pendelparkering', kind: 'local', pts: [[902, 748], [903, 722], [915, 706], [940, 698]],
      start: { junction: 'J_P' }, end: { parking: { id: 'P', label: 'Pendelparkering' } } },
  ],

  // Junction control. Roles default to 'major'.
  //   priority  – väjningsplikt (B1) for the `minor` legs, utfartsregeln for `exit` legs
  //   right     – unsigned junction: högerregeln (yield to traffic from the right)
  //   roundabout– cirkulationsplats, väjningsplikt on every entry
  junctions: [
    { id: 'RB', type: 'roundabout', center: [1307, 642], radius: 28, legTrim: 46 },
    { id: 'J_DS', type: 'priority', center: [1000, 748], minor: ['DAG'], trim: 9 },
    { id: 'J_KD', type: 'priority', center: [783, 403], minor: ['KAST'], trim: 8 },
    { id: 'J_P', type: 'priority', center: [903, 751], exit: ['PEND'], trim: 7 },
    { id: 'J_LS', type: 'priority', center: [655, 866], minor: ['LAG'], trim: 8 },
    { id: 'J_JL', type: 'right', center: [658, 900], trim: 6 },
  ],

  parking: [
    { id: 'P', center: [928, 700], size: [70, 32], angle: -0.18 },
  ],
};

// Labels, signs and points of interest drawn on the map (map pixels).
export const LABELS = {
  roads: [
    { text: 'Dageborgsleden', at: [433, 140], road: 'DAG' },
    { text: 'Dageborgsleden', at: [793, 420], road: 'DAG' },
    { text: 'Kastenhofsvägen', at: [343, 508], road: 'KAST' },
    { text: 'Kastenhofsvägen', at: [690, 470], road: 'KAST' },
    { text: 'Södra Långvägen', at: [583, 884], road: 'SLV' },
    { text: 'Södra Långvägen', at: [180, 1046], road: 'SLV' },
    { text: 'Hedeforsvägen', at: [1717, 222], road: 'HED' },
    { text: 'Hedeforsvägen', at: [1430, 520], road: 'HED' },
    { text: 'Härskogsvägen', at: [1665, 920], road: 'HAR' },
    { text: 'Laggarns väg', at: [600, 975], road: 'LAG' },
    { text: 'Jutagårdsvägen', at: [760, 886], road: 'JUT' },
  ],
  water: [{ text: 'Säveån', at: [337, 325], angle: -0.62 }],
  shields: [[1155, 432], [581, 804], [340, 913], [1630, 60]],
  exits: [[1434, 173], [1068, 572]],
  pois: [
    { text: 'Kastenhof Herrgård', at: [280, 566], kind: 'pin' },
    { text: 'Pendelparkering Kastenhof', at: [917, 693], kind: 'parking' },
    { text: 'Burhults Stuteri & Ridskola', at: [1427, 1003], kind: 'pin' },
  ],
  busStops: [[880, 763], [1597, 348]],
};
