// All tunables for the Kastenhof simulation live here.
// Units: metres, seconds, km/h where noted. Map coordinates are pixels in the
// 2000×1240 reference image space (references/kastenhof.png scaled to 2000 wide).

export const CONFIG = {
  mapW: 2000,
  mapH: 1240,
  scale: 0.5,               // metres per map pixel (Google zoom ≈17 at 57.8°N)

  lane: { motorway: 3.5, ramp: 3.6, main: 3.25, local: 3.0, ring: 5.0 },

  // Posted limits (km/h) by road id: E20 is 100, every other road 50.
  // Ring/connector/parking values are caps; curves usually limit speed more.
  speed: {
    E20E: 100, E20W: 100, OFFE: 50, ONE: 50, OFFW: 50, ONW: 50,
    HED: 50, HAR: 50, SLV: 50, DAG: 50, KAST: 50, LAG: 50, JUT: 50, PEND: 20,
    ring: 30, connector: 40,
  },

  // Satellite footprint (tools/satellite.py): `bounds` is the map-pixel box that
  // references/satellite-map.webp covers. Roads inside it were traced from the photo.
  satellite: { bounds: [570, 325, 1440, 850] },

  roundaboutFlare: { width: 2.4, length: 20 }, // lanes part around splitter islands (m)
  extendBeyondEdge: 90,     // roads continue this far outside the map so cars don't pop in
  accelLaneLength: 210,     // parallel acceleration lane at on-ramps (m)
  taperLength: 60,
  bridge: { height: 6.5, halfLength: 95 }, // E20 passes over Dageborgsleden

  // Driver model (Intelligent Driver Model) – per-vehicle values are jittered.
  idm: {
    car:   { a: 1.5, b: 2.2, T: 1.25, s0: 2.0, len: [4.2, 4.9], width: 1.82 },
    truck: { a: 0.75, b: 1.7, T: 1.7, s0: 2.6, len: [12, 16.5], width: 2.5, vmax: 90 },
  },
  lateralAccel: 2.2,        // comfortable lateral acceleration in curves (m/s²)
  anticipationDecel: 1.4,   // comfortable decel when approaching a slower section

  // Gap acceptance (s). Critical gaps from Swedish/European field studies.
  gaps: {
    roundabout: 3.4,        // väjningsplikt into circulating traffic
    priority: 4.6,          // väjningsplikt / left turn across a priority road
    right: 4.2,             // högerregeln junction
    exit: 5.5,              // utfartsregeln: leaving a parking area
    margin: 0.7,            // extra clearance on top of own crossing time
  },

  // Lane changing (MOBIL-style). Swedish rules: keep right, overtake on the left only.
  lc: { politeness: 0.25, threshold: 0.25, keepRightBias: 0.25, bSafe: 2.5, signalTime: 1.1, duration: 3.2 },

  truckShare: { motorway: 0.12, other: 0.035 },

  // Spawn rates (vehicles / minute) per entry. E20 is the busy one.
  rates: {
    E20E: 24, E20W: 22, SLV: 5, DAG: 3, KAST: 1, HED: 4, HAR: 3, LAG: 1, JUT: 1, P: 1,
  },

  // Origin → destination weights. Unreachable pairs are dropped automatically.
  od: {
    E20E: { E20E: 86, HED: 5, HAR: 3, SLV: 2, DAG: 2, P: 1, LAG: 0.5, JUT: 0.5 },
    E20W: { E20W: 90, DAG: 3, SLV: 3, KAST: 1, P: 1, LAG: 1, JUT: 1 },
    SLV:  { E20W: 15, E20E: 30, HED: 18, HAR: 12, DAG: 14, SLV: 0, KAST: 3, P: 6, LAG: 6, JUT: 4 },
    DAG:  { E20W: 15, E20E: 30, SLV: 30, HED: 14, HAR: 8, KAST: 5, P: 6, LAG: 4, JUT: 3 },
    KAST: { E20W: 15, DAG: 35, SLV: 30, E20E: 15, HED: 10, HAR: 5, P: 5 },
    HED:  { E20W: 15, E20E: 35, SLV: 30, DAG: 14, HAR: 8, P: 6, LAG: 4, JUT: 3 },
    HAR:  { E20W: 15, E20E: 35, SLV: 28, HED: 12, DAG: 12, P: 5, LAG: 4, JUT: 4 },
    LAG:  { E20W: 15, SLV: 40, E20E: 25, HED: 12, DAG: 10, HAR: 6, JUT: 7 },
    JUT:  { E20W: 15, SLV: 35, E20E: 25, HED: 12, DAG: 10, HAR: 6, LAG: 12 },
    P:    { E20W: 15, SLV: 40, E20E: 25, HED: 15, DAG: 12, HAR: 8 },
  },

  routing: {
    noise: 0.18,            // per-driver lognormal perception noise on link times
    laneChangeCost: 3,      // s
    penalty: { OFFW: 30 },  // through traffic stays on E20 instead of crossing Dageborgsleden
  },

  sim: { dt: 1 / 30, maxVehicles: 900, maxQueue: 60 },
};

export const kmh = (v) => v / 3.6;
