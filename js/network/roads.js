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
    // Westbound off-ramp from Kastenhofsmotet down to Dageborgsleden, and the
    // on-ramp from there back to E20. Both meet Dageborgsleden at grade.
    { id: 'OFFW', name: 'Avfart 86', pts: TRACES.OFFW, from: { carriageway: 'E20W' }, to: { junction: 'J_CW' }, group: 'OFFW' },
    { id: 'ONW', name: 'Påfart 86', pts: TRACES.ONW, from: { junction: 'J_CW' }, to: { carriageway: 'E20W' }, group: 'ONW' },
    // Channelised right turns at Dageborgsleden / Södra Långvägen (satellite):
    // southbound Dageborgsleden → westbound Södra Långvägen, passing the
    // commuter-lot access, and westbound Södra Långvägen → northbound Dageborgsleden.
    { id: 'SLIP_SW', name: 'Södra Långvägen', pts: [[998, 688], [994, 698], [991, 708], [989, 718], [985, 728], [978, 735], [966, 739], [950, 740], [934, 742], [921, 746], [911, 752]],
      from: { junction: 'J_DN' }, to: { junction: 'J_P' }, slip: true },
    { id: 'SLIP_EN', name: 'Dageborgsleden', pts: [[1066, 756], [1052, 750], [1040, 746], [1029, 742], [1021, 736], [1016, 728], [1013, 718], [1010, 706], [1005, 696], [998, 688]],
      from: { junction: 'J_SE' }, to: { junction: 'J_DN' }, slip: true },
  ],

  // Two-way roads (one lane each direction).
  roads: [
    { id: 'SLV', name: 'Södra Långvägen', kind: 'main', pts: TRACES.SLV,
      start: { junction: 'RB' }, end: { boundary: { id: 'SLV', label: 'Södra Långvägen' } }, via: ['J_SE', 'J_DS', 'J_P', 'J_LS'] },
    { id: 'HED', name: 'Hedeforsvägen', kind: 'main', pts: TRACES.HED,
      start: { junction: 'RB' }, end: { boundary: { id: 'HED', label: 'Hedeforsvägen' } } },
    { id: 'HAR', name: 'Härskogsvägen', kind: 'main', pts: TRACES.HAR,
      start: { junction: 'RB' }, end: { boundary: { id: 'HAR', label: 'Härskogsvägen' } } },
    { id: 'DAG', name: 'Dageborgsleden', kind: 'main', pts: TRACES.DAG,
      start: { boundary: { id: 'DAG', label: 'Dageborgsleden' } }, end: { junction: 'J_DS' }, via: ['J_KD', 'J_CW', 'J_DN'] },
    { id: 'KAST', name: 'Kastenhofsvägen', kind: 'local', pts: TRACES.KAST,
      start: { boundary: { id: 'KAST', label: 'Kastenhofsvägen' } }, end: { junction: 'J_KD' } },
    { id: 'LAG', name: 'Laggarns väg', kind: 'local', pts: TRACES.LAG,
      start: { junction: 'J_LS' }, end: { boundary: { id: 'LAG', label: 'Laggarns väg' } }, via: ['J_JL'] },
    { id: 'JUT', name: 'Jutagårdsvägen', kind: 'local', pts: TRACES.JUT,
      start: { junction: 'J_JL' }, end: { boundary: { id: 'JUT', label: 'Jutagårdsvägen' } } },
    { id: 'PEND', name: 'Pendelparkering', kind: 'local', pts: [[911, 752], [912, 740], [914, 728], [918, 717], [926, 709], [938, 704], [948, 702]],
      start: { junction: 'J_P' }, end: { parking: { id: 'P', label: 'Pendelparkering' } } },
  ],

  // Junction control. Roles default to 'major'.
  //   priority  – väjningsplikt (B1) for the `minor` legs, utfartsregeln for `exit` legs
  //   right     – unsigned junction: högerregeln (yield to traffic from the right)
  //   roundabout– cirkulationsplats, väjningsplikt on every entry
  // `ban` lists movements that don't exist as `fromRoad:turn` (U-turns are never built).
  junctions: [
    { id: 'RB', type: 'roundabout', center: [1310, 645], radius: 38, legTrim: 58 },
    // Dageborgsleden / Södra Långvägen: right turns use the slips, so only the
    // left turns (and Södra Långvägen through) cross the main junction.
    { id: 'J_DS', type: 'priority', center: [1005, 748], minor: ['DAG'], trim: 9, ban: ['DAG:right', 'SLV:right'] },
    { id: 'J_DN', type: 'priority', center: [998, 690], minor: ['SLIP_EN'], trim: 8, ban: ['SLIP_EN:left', 'DAG:left'] },
    { id: 'J_SE', type: 'priority', center: [1066, 756], trim: 8 },
    { id: 'J_CW', type: 'priority', center: [872, 479], minor: ['OFFW', 'ONW'], trim: 9 },
    { id: 'J_KD', type: 'priority', center: [783, 403], minor: ['KAST'], trim: 8 },
    // The slip lane merges into Södra Långvägen where the commuter-lot road joins.
    { id: 'J_P', type: 'priority', center: [911, 752], minor: ['SLIP_SW'], exit: ['PEND'], trim: 8 },
    { id: 'J_LS', type: 'priority', center: [655, 866], minor: ['LAG'], trim: 8 },
    { id: 'J_JL', type: 'right', center: [658, 900], trim: 6 },
  ],

  // Extra surfacing (map px). `paved`: asphalt between lanes, e.g. where the
  // slips run alongside Dageborgsleden; `painted`: spärrområde (white border
  // and diagonal hatching) instead of a raised island.
  areas: [
    { kind: 'paved', poly: [[998, 690], [1000, 700], [1002, 712], [1003, 724], [1004, 736], [1005, 748], [987, 748], [963, 748], [945, 749],
      [950, 740], [966, 739], [978, 735], [985, 728], [989, 718], [991, 708], [994, 698]] },
    { kind: 'paved', poly: [[998, 690], [1000, 700], [1002, 712], [1003, 724], [1004, 736], [1005, 748], [1023, 752], [1047, 754], [1060, 756],
      [1052, 750], [1040, 746], [1029, 742], [1021, 736], [1016, 728], [1013, 718], [1010, 706], [1005, 696]] },
    { kind: 'painted', poly: [[988, 742], [997, 742], [997, 726]] },
    { kind: 'painted', poly: [[1011, 744], [1011, 733], [1022, 744]] },
  ],

  parking: [
    { id: 'P', center: [945, 703], size: [46, 32], angle: -0.45 },
    // Large gravel lot north of the roundabout, between the on-ramp and Hedeforsvägen
    // (seen on the satellite image; scenery only, no traffic).
    { id: 'P2', center: [1295, 535], size: [128, 40], angle: 1.242 },
  ],
};

// The what-if under test: Dageborgsleden / westbound ramps (J_CW) as a
// roundabout instead of today's priority crossing. Toggled live in the UI.
export const TOGGLE_JUNCTION = 'J_CW';
const J_CW_ROUNDABOUT = { id: 'J_CW', type: 'roundabout', center: [872, 479], radius: 30, legTrim: 46 };
export const LAYOUTS = {
  cross: NETWORK,
  roundabout: { ...NETWORK, junctions: NETWORK.junctions.map((j) => (j.id === TOGGLE_JUNCTION ? J_CW_ROUNDABOUT : j)) },
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
  // One E20 shield ~110 m in from each end of the motorway, on the median.
  shields: [[208, 975], [1497, 139]],
  exits: [],
  pois: [],
  busStops: [[880, 763], [1597, 348]],
};
