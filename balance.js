// balance.js — every tunable number in the game lives here.
// Nothing outside this file may hardcode a balance value.

export const BALANCE = {
  world: {
    // The arena: every spot you may build on. The path (game.js) sits inside
    // it. The arena was grown *around* the path rather than the path being
    // moved, so towers saved before the world got bigger keep their exact
    // positions, and enemy walking distance is untouched.
    x: -180, y: -210,
    width: 720, height: 900,
    // What one screenful shows at zoom 1 — the old fixed view, so the game
    // still opens framed the way it always was.
    viewWidth: 360, viewHeight: 480,
    pathWidth: 26,
  },

  camera: {
    minZoom: 0.42,       // far enough out to see the whole arena on a phone
    maxZoom: 2.4,
    panSlop: 8,          // px of travel before a touch counts as a pan, not a tap
    wheelZoom: 0.0018,   // desktop wheel sensitivity
  },

  economy: {
    startingCredits: 45,
    sellRefund: 0.6,     // fraction of money spent returned when selling a tower
    // The start has to be playable before you have built anything, so the run
    // opens with a depot by the vault and rounds already in it.
    startingStock: { ore: 0, power: 0, ammo: 140, shells: 0 },
    startingDepot: [252, 470],   // world coords, near the vault and off the path
    oreSnap: 24,                 // how close a miner must sit to a node's centre
    buildingRadius: 20,          // footprint, as towers have towerRadius
  },

  vault: {
    maxHp: 20,
    regenPerWave: 1,     // hp healed after every cleared wave
  },

  waves: {
    prepTime: 3,         // seconds between waves
    spawnInterval: 0.9,  // seconds between spawns inside a wave
    baseCount: 5,        // enemies in wave 1
    countPerWave: 0.6,   // extra enemies per wave (floored)
    maxCount: 45,
    hpBase: 14,
    hpGrowth: 1.155,     // hp = hpBase * hpGrowth^(wave-1)
    speedBase: 26,       // logical px/second
    speedGrowth: 1.008,
    speedMax: 78,
    bountyBase: 5,
    bountyGrowth: 1.115,
    bossEvery: 5,
    bossEscortRatio: 0.4, // boss waves also spawn this share of a normal wave
    leakDamage: 1,       // vault damage when a normal enemy reaches the vault
  },

  // Multipliers applied on top of the wave curve above.
  enemies: {
    grunt: { name: 'Grunt', hp: 1,    speed: 1,    bounty: 1,   sides: 6,  radius: 8,  color: '#ff7a59', minWave: 1, weight: 10 },
    swift: { name: 'Swift', hp: 0.55, speed: 1.7,  bounty: 0.9, sides: 3,  radius: 7,  color: '#ffd166', minWave: 4, weight: 5 },
    hulk:  { name: 'Hulk',  hp: 3.2,  speed: 0.62, bounty: 2.6, sides: 8,  radius: 11, color: '#c084fc', minWave: 8, weight: 4 },
    boss:  { name: 'Boss',  hp: 18,   speed: 0.5,  bounty: 15,  sides: 12, radius: 16, color: '#f43f5e', minWave: 1, weight: 0, leakDamage: 6 },
  },

  towers: {
    turret: {
      name: 'Turret', blurb: 'Steady single-target fire.',
      cost: 30, costGrowth: 1.5,
      damage: 6, range: 80, fireRate: 1.5, projectileSpeed: 260,
      ammoType: 'ammo', ammoPerShot: 1,
      color: '#38bdf8',
    },
    laser: {
      name: 'Laser', blurb: 'Fast beam, short range.',
      cost: 110, costGrowth: 1.55,
      damage: 2.6, range: 66, fireRate: 7, beam: true,
      ammoType: 'power', ammoPerShot: 0.22,
      color: '#a3e635',
    },
    mortar: {
      name: 'Mortar', blurb: 'Slow shells, splash damage.',
      cost: 260, costGrowth: 1.6,
      damage: 26, range: 120, fireRate: 0.55, projectileSpeed: 150,
      splashRadius: 34, splashFalloff: 0.5,
      ammoType: 'shells', ammoPerShot: 1,
      color: '#fb923c',
    },
  },

  // What towers burn. Stock is global; the map decides who may draw on it.
  resources: {
    ore:    { name: 'Ore',    blurb: 'dug out of a node',     color: '#a8a29e', cap: 400 },
    power:  { name: 'Power',  blurb: 'runs the lasers',       color: '#facc15', cap: 400 },
    ammo:   { name: 'Ammo',   blurb: 'turret rounds',         color: '#38bdf8', cap: 400 },
    shells: { name: 'Shells', blurb: 'mortar shells',         color: '#fb923c', cap: 150 },
  },

  // Buildings produce, convert and distribute. `supplies` is the reach part:
  // a tower only fires if some building that supplies its resource has it
  // inside `radius`. Producing and distributing are separate jobs on purpose —
  // that is what makes where you put a thing matter.
  buildings: {
    depot: {
      name: 'Depot', blurb: 'Relays every resource to whatever is in range.',
      cost: 45, costGrowth: 1.35, radius: 115,
      supplies: ['ore', 'power', 'ammo', 'shells'],
      color: '#94a3b8',
    },
    miner: {
      name: 'Miner', blurb: 'Must stand on an ore node.',
      cost: 70, costGrowth: 1.4, radius: 80,
      needsOre: true,
      produces: { ore: 0.9 },
      supplies: ['ore'],
      color: '#a8a29e',
    },
    plant: {
      name: 'Power plant', blurb: 'Needs no input. Runs lasers and factories.',
      cost: 140, costGrowth: 1.45, radius: 105,
      produces: { power: 2.2 },
      supplies: ['power'],
      color: '#facc15',
    },
    // Both fabs burn power as well as ore, so plants are not a laser-only
    // building and the four resources form one chain rather than four straight
    // lines. Lasers draw on the same pool, which is where the interesting
    // failure lives: overbuild them and the ammo line browns out.
    ammofab: {
      name: 'Ammo factory', blurb: 'Ore and power into turret rounds.',
      cost: 120, costGrowth: 1.42, radius: 105,
      consumes: { ore: 0.7, power: 0.5 }, produces: { ammo: 1.7 },
      supplies: ['ammo'],
      color: '#38bdf8',
    },
    shellfab: {
      name: 'Shell fab', blurb: 'Ore and power into mortar shells.',
      cost: 300, costGrowth: 1.5, radius: 105,
      consumes: { ore: 1.2, power: 0.9 }, produces: { shells: 0.55 },
      supplies: ['shells'],
      color: '#fb923c',
    },
  },

  // Run-scoped upgrades. Effect is additive per level: mult = 1 + level * effect.
  upgrades: {
    damage: { name: 'Damage',    icon: 'damage', cost: 35, growth: 1.32, effect: 0.16, blurb: '+16% tower damage' },
    rate:   { name: 'Fire rate', icon: 'rate',   cost: 40, growth: 1.34, effect: 0.09, blurb: '+9% fire rate' },
    range:  { name: 'Range',     icon: 'range',  cost: 45, growth: 1.36, effect: 0.05, blurb: '+5% tower range' },
    // Without this the economy is flat while the waves grow exponentially, so
    // the ore nodes become a hard ceiling on how many towers can ever fire.
    output: { name: 'Throughput', icon: 'base', cost: 50, growth: 1.30, effect: 0.20, blurb: '+20% from every building' },
  },

  // Free placement rules. All distances are logical px, centre to centre
  // unless stated otherwise.
  build: {
    towerRadius: 12,      // footprint used for every placement check
    pathClearance: 4,     // extra gap between the tower edge and the path edge
    // Two things may not stand closer than the sum of their footprints plus
    // this gap. Tower to tower still works out at 26 (12 + 12 + 2), which is
    // what it has always been.
    spacingGap: 2,
    vaultClearance: 36,   // keep the vault readable
    edgeMargin: 14,       // keep towers fully inside the logical world
    dragGrabOffset: -30,  // screen px the ghost floats above the finger
    dragHoldMs: 180,      // hold this long on a card before it becomes a drag
    dragSlop: 10,         // px of finger travel that means "I am scrolling"
  },

  prestige: {
    divisor: 1500,
    exponent: 0.5,       // cores = floor((runEarned / divisor) ^ exponent)
    bonusPerCore: 0.06,  // multiplier = 1 + cores * bonusPerCore
    minCoresToPrestige: 1,
  },

  offline: {
    capHours: 8,
    efficiency: 0.5,
    minSeconds: 120,     // shorter absences are ignored
    rateWindow: 6,       // seconds per income sample used for the earnings rate
    rateSmoothing: 0.35, // EMA weight for a new sample
  },

  // Everything is synthesised at runtime; no audio file is ever loaded.
  audio: {
    master: 0.55,
    sfx: 0.5,
    music: 0.3,
    bpm: 84,
    stepsPerBar: 8,       // eighth notes
    lookahead: 0.12,      // seconds of music scheduled ahead of the clock
    tickInterval: 40,     // ms between scheduler ticks
    maxVoices: 16,        // hard cap on simultaneous sfx voices
    shotsPerSecond: 12,   // firing sounds are rate limited, not one per shot
    intensityWaves: 30,   // wave at which the music reaches full intensity
    bossIntensity: 0.35,  // added on a boss wave
    fadeSeconds: 0.5,   // music fading back in
    muteFadeSeconds: 0.08, // muting should feel instant, not like a dip
  },

  save: {
    autosaveInterval: 8, // seconds
  },

  fx: {
    maxParticles: 180,
    floatLife: 0.9,
    particleLife: 0.5,
    recoilSeconds: 0.13,  // how long a barrel stays kicked back after firing
    hitRingSeconds: 0.18,
  },

  controls: {
    speeds: [1, 2, 4],   // the speed button cycles through these
  },

  // Simulation timestep. Fixed so a fast-forward is deterministic.
  sim: {
    step: 1 / 30,
    maxCatchUpSeconds: 1.5, // real-time frames never simulate more than this
  },
};
