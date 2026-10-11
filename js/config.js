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
    E20E: 100, E20W: 100, OFFE: 50, ONE: 50, OFFW: 50, ONW: 50, SLIP_SW: 40, SLIP_EN: 40,
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

  // Traffic is defined as routes: an origin (entry id, see the boundary
  // labels in roads.js) and a destination (exit id), each with its own rate
  // in vehicles per minute. Each car follows the fastest path between them,
  // with some per-driver variation. Add more routes here as needed.
  routes: [
    { id: 'GBG-ALS', label: 'Göteborg → Alingsås', from: 'E20E', to: 'E20E', rate: 24 },
    // E20 westbound straight through, past Kastenhofsmotet.
    { id: 'ALS-GBG', label: 'Alingsås → Göteborg', from: 'E20W', to: 'E20W', rate: 24 },
    // Avfart 86 → roundabout → Södra Långvägen → Dageborgsleden north under E20.
    { id: 'GBG-STK', label: 'Göteborg → Stenkullen', from: 'E20E', to: 'DAG', rate: 3 },
    // Avfart 86 → roundabout → Södra Långvägen west, past Dageborgsleden, out at the bottom-left.
    { id: 'GBG-SLR', label: 'Göteborg → Södra Lerum', from: 'E20E', to: 'SLV', rate: 3 },
    // Westbound off-ramp → Dageborgsleden south under E20 → right slip onto Södra Långvägen west.
    { id: 'ALS-SLR', label: 'Alingsås → Södra Lerum', from: 'E20W', to: 'SLV', rate: 3 },
    // Westbound off-ramp → right onto Dageborgsleden north-west, out at the top-left.
    { id: 'ALS-STK', label: 'Alingsås → Stenkullen', from: 'E20W', to: 'DAG', rate: 3 },
    // Dageborgsleden south → Påfart 86 (westbound ramp) → E20 towards Göteborg.
    { id: 'STK-GBG', label: 'Stenkullen → Göteborg', from: 'DAG', to: 'E20W', rate: 3 },
  ],

  routing: {
    noise: 0.18,            // per-driver lognormal perception noise on link times
    laneChangeCost: 3,      // s
    penalty: { OFFW: 30 },  // through traffic stays on E20 instead of crossing Dageborgsleden
  },

  sim: { dt: 1 / 30, maxVehicles: 900, maxQueue: 60 },
};

export const kmh = (v) => v / 3.6;
