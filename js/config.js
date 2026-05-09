// Static data: chassis, weapons, mods, paint, opponents.
const CONFIG = {
  // Stat tuning ---------------------------------------------------------------
  STAT_POINTS: 14,        // points to allocate beyond baseline
  STAT_MIN: 1,
  STAT_MAX: 8,
  MAX_MODS: 2,            // up to 2 mods per bot

  // base stat values (1..8) → derived numbers
  hpFromArmor:    a => 60 + a * 30,
  speedFromSpd:   s => 1.6 + s * 0.55,
  turnFromSpd:    s => 2.6 + s * 0.45,
  dmgFromPower:   p => 0.5 + p * 0.18,
  massFromWeight: w => 1.0 + w * 0.45,

  // ===========================================================================
  // CHASSIS  (10)
  // ===========================================================================
  chassis: [
    { id: 'wedge', name: 'Wedge', tag: 'Aggressive',
      desc: 'Low profile. Deflects 30% of frontal hits. Slightly faster.',
      bonus: { frontDeflect: 0.30, speed: 0.06 },
      shape: 'wedge', radius: 22 },

    { id: 'brick', name: 'Brick', tag: 'Balanced',
      desc: 'Reliable, no penalties. Solid chassis for any loadout.',
      bonus: {},
      shape: 'box', radius: 24 },

    { id: 'tank', name: 'Heavy Tank', tag: 'Tanky',
      desc: '+50 HP, +20% mass, slower turn rate.',
      bonus: { hp: 50, mass: 0.2, turn: -0.6 },
      shape: 'tank', radius: 28 },

    { id: 'hover', name: 'Hovercraft', tag: 'Hazard-proof',
      desc: 'Floats over the pit and ignores spike strips. Fragile (-30 HP).',
      bonus: { hp: -30, hover: true },
      shape: 'hover', radius: 24 },

    { id: 'speeder', name: 'Speeder', tag: 'Lightweight',
      desc: 'Carbon-fiber rocket. +30% speed, -25 HP, sharper turn.',
      bonus: { speed: 0.30, hp: -25, turn: 0.4, mass: -0.2 },
      shape: 'speeder', radius: 20 },

    { id: 'tracked', name: 'Tracked', tag: 'Grip',
      desc: 'Heavy steel treads. +20 HP, +10% mass, marginally slower.',
      bonus: { hp: 20, mass: 0.1, speed: -0.05 },
      shape: 'tracked', radius: 26 },

    { id: 'walker', name: 'Walker', tag: 'Stable',
      desc: 'Articulated legs. Razor turning, -40% incoming knockback.',
      bonus: { turn: 0.7, hp: 10, knockResist: 0.4 },
      shape: 'walker', radius: 24 },

    { id: 'invertible', name: 'Invertible', tag: 'Resilient',
      desc: 'Symmetrical body. +25 HP and slight turn boost.',
      bonus: { hp: 25, turn: 0.2 },
      shape: 'invertible', radius: 24 },

    { id: 'pyramid', name: 'Pyramid', tag: 'Defensive',
      desc: 'Sloped armor on every face. 40% deflect, slow & clumsy.',
      bonus: { deflect: 0.40, speed: -0.15, turn: -0.4 },
      shape: 'pyramid', radius: 26 },

    { id: 'saucer', name: 'Saucer', tag: 'Agile',
      desc: 'UFO disc frame. Excellent agility but fragile (-15 HP).',
      bonus: { hp: -15, turn: 0.6, speed: 0.10, mass: -0.1 },
      shape: 'saucer', radius: 23 },

    // ----- PRO Chassis -----
    { id: 'titan', name: 'Titan', tag: 'PRO · Juggernaut',
      desc: 'Industrial-class superheavy. +90 HP, +30% mass, slower.',
      bonus: { hp: 90, mass: 0.3, speed: -0.18, turn: -0.5, knockResist: 0.25 },
      shape: 'tank', radius: 30,
      pro: true, priceBolts: 1200, priceCrowns: 80 },
    { id: 'phantom', name: 'Phantom', tag: 'PRO · Stealth',
      desc: 'Cloaked phantom chassis. +25% speed, +30 HP, +50% knock-resist.',
      bonus: { hp: 30, speed: 0.25, knockResist: 0.50, frontDeflect: 0.20 },
      shape: 'speeder', radius: 22,
      pro: true, priceBolts: 1100, priceCrowns: 75 },
  ],

  // ===========================================================================
  // WEAPONS  (12)
  // ===========================================================================
  weapons: [
    { id: 'spinner', name: 'Horizontal Spinner', tag: 'Passive · Beast',
      desc: 'Massive 3-blade disc. Devastating contact damage and knockback.',
      type: 'passive', damage: 6, tickInterval: 0.18,
      knockback: 280, selfKnockback: 110, reach: 16, arc: Math.PI * 1.0, drawSpin: 28 },

    { id: 'drum', name: 'Front Drum', tag: 'Passive · Control',
      desc: 'Compact drum. Smaller damage but very controllable.',
      type: 'passive', damage: 3.4, tickInterval: 0.12,
      knockback: 140, selfKnockback: 30, reach: 10, arc: Math.PI * 0.55, drawSpin: 36 },

    { id: 'vertspin', name: 'Vertical Spinner', tag: 'Passive · Launcher',
      desc: 'Front vertical disc. Big damage in narrow zone, launches enemies.',
      type: 'passive', damage: 7.5, tickInterval: 0.22,
      knockback: 380, selfKnockback: 70, reach: 14, arc: Math.PI * 0.40, drawSpin: 32 },

    { id: 'spinbar', name: 'Spinning Bar', tag: 'Passive · Sweep',
      desc: 'Long bar sweeps a wide arc. Hits multiple sides.',
      type: 'passive', damage: 5, tickInterval: 0.20,
      knockback: 240, selfKnockback: 90, reach: 24, arc: Math.PI * 1.4, drawSpin: 22 },

    { id: 'twinsaws', name: 'Twin Side Saws', tag: 'Passive · Side',
      desc: 'Two side-mounted blades. Damage on side contact.',
      type: 'passive', damage: 3.0, tickInterval: 0.15,
      knockback: 120, selfKnockback: 10, reach: 8, arc: Math.PI * 1.6, drawSpin: 30, side: true },

    { id: 'hammer', name: 'Pneumatic Hammer', tag: 'Active · Burst',
      desc: 'SPACE to slam. 30 dmg in front cone, 1.4s cooldown.',
      type: 'active', damage: 30, cooldown: 1.4, windup: 0.12, active: 0.18,
      knockback: 360, reach: 22, arc: Math.PI * 0.55 },

    { id: 'axe', name: 'Battle Axe', tag: 'Active · Heavy',
      desc: 'SPACE for an overhead chop. 42 dmg, 2.0s cooldown.',
      type: 'active', damage: 42, cooldown: 2.0, windup: 0.22, active: 0.16,
      knockback: 300, reach: 24, arc: Math.PI * 0.45 },

    { id: 'spear', name: 'Spear', tag: 'Active · Quick',
      desc: 'SPACE for a quick stab. 14 dmg, 0.7s cooldown.',
      type: 'active', damage: 14, cooldown: 0.7, windup: 0.05, active: 0.12,
      knockback: 180, reach: 30, arc: Math.PI * 0.18 },

    { id: 'flipper', name: 'Flipper', tag: 'Active · Launch',
      desc: 'SPACE to flip. Light damage, huge launch impulse.',
      type: 'active', damage: 12, cooldown: 1.6, windup: 0.06, active: 0.18,
      knockback: 620, reach: 18, arc: Math.PI * 0.45 },

    { id: 'lifter', name: 'Lifter', tag: 'Active · Control',
      desc: 'SPACE to lift. Steady control flips, low cooldown.',
      type: 'active', damage: 8, cooldown: 1.0, windup: 0.05, active: 0.15,
      knockback: 380, reach: 16, arc: Math.PI * 0.40 },

    { id: 'crusher', name: 'Crusher Jaws', tag: 'Active · Grab',
      desc: 'SPACE to crush. Massive point-blank damage, slow cooldown.',
      type: 'active', damage: 55, cooldown: 2.4, windup: 0.18, active: 0.20,
      knockback: 80, reach: 14, arc: Math.PI * 0.35 },

    { id: 'flame', name: 'Flamethrower', tag: 'Active · Spray',
      desc: 'SPACE to spray fire. Sustained ranged damage cone.',
      type: 'active', damage: 5, dmgTickInterval: 0.10, cooldown: 0.9, windup: 0.05, active: 0.5,
      knockback: 30, reach: 60, arc: Math.PI * 0.30 },

    // ----- PRO Weapons -----
    { id: 'plasma', name: 'Plasma Cannon', tag: 'PRO · Active Ranged',
      desc: 'Charged plasma blast. Long-range single shot, devastating burst.',
      type: 'active', damage: 38, cooldown: 1.6, windup: 0.30, active: 0.18,
      knockback: 420, reach: 80, arc: Math.PI * 0.20,
      pro: true, priceBolts: 900, priceCrowns: 60 },
    { id: 'vortex', name: 'Vortex Disc', tag: 'PRO · Passive Apex',
      desc: 'Twin-blade vortex. Wider arc, longer reach, brutal damage.',
      type: 'passive', damage: 8, tickInterval: 0.20,
      knockback: 340, selfKnockback: 130, reach: 22, arc: Math.PI * 1.2, drawSpin: 32,
      pro: true, priceBolts: 950, priceCrowns: 65 },
  ],

  // ===========================================================================
  // MODS  (12) — choose up to MAX_MODS
  // ===========================================================================
  mods: [
    { id: 'plow', name: 'Front Plow', tag: 'Defense',
      desc: 'Heavy steel plow. +20 HP and +30% frontal deflect.',
      bonus: { hp: 20, frontDeflect: 0.30 } },

    { id: 'skirts', name: 'Anti-Spinner Skirts', tag: 'Defense',
      desc: 'Drag skirts deflect 25% of frontal hits. +10 HP.',
      bonus: { hp: 10, deflect: 0.25 } },

    { id: 'frame', name: 'Reinforced Frame', tag: 'Defense',
      desc: '+35 HP and +10% mass, but -10% top speed.',
      bonus: { hp: 35, mass: 0.1, speed: -0.10 } },

    { id: 'lightweight', name: 'Lightweight Alloys', tag: 'Mobility',
      desc: '-25 HP, +18% speed, -15% mass.',
      bonus: { hp: -25, speed: 0.18, mass: -0.15 } },

    { id: 'srimech', name: 'Srimech', tag: 'Utility',
      desc: 'Self-righting bar. +0.4 turn rate and +10 HP.',
      bonus: { hp: 10, turn: 0.4 } },

    { id: 'ramspikes', name: 'Ram Spikes', tag: 'Offense',
      desc: 'Spikes deal +10 damage on hard collisions.',
      bonus: { ramDmg: 10 } },

    { id: 'repair', name: 'Repair System', tag: 'Utility',
      desc: 'Auto-regenerate 0.6 HP per second.',
      bonus: { regen: 0.6 } },

    { id: 'wheelguards', name: 'Wheel Guards', tag: 'Defense',
      desc: '+10 HP, -50% damage from saws and spikes.',
      bonus: { hp: 10, antiHazardDmg: 0.5 } },

    { id: 'magnet', name: 'Electromagnet', tag: 'Utility',
      desc: 'Pulls enemies in within 90 px range.',
      bonus: { magnet: 90 } },

    { id: 'booster', name: 'Boosters', tag: 'Mobility',
      desc: 'Periodic forward thrust burst when driving.',
      bonus: { boost: 1 } },

    { id: 'gyro', name: 'Gyro Stabilizer', tag: 'Utility',
      desc: '+0.6 turn rate and +5% mass.',
      bonus: { turn: 0.6, mass: 0.05 } },

    { id: 'powercell', name: 'Overclocked Power Cell', tag: 'Offense',
      desc: '+15% weapon damage, but -0.2 HP/sec from overload.',
      bonus: { dmgMul: 0.15, regen: -0.2 } },

    // ----- PRO Mods -----
    { id: 'eshield', name: 'Energy Shield', tag: 'PRO · Defense',
      desc: '+45% deflect, +35 HP. Premium reactive plating.',
      bonus: { hp: 35, deflect: 0.45 },
      pro: true, priceBolts: 800, priceCrowns: 55 },
    { id: 'phasecore', name: 'Phase Core', tag: 'PRO · Hybrid',
      desc: '+12% speed, +0.5 turn, +0.6 HP/s, +10% weapon damage.',
      bonus: { speed: 0.12, turn: 0.5, regen: 0.6, dmgMul: 0.10 },
      pro: true, priceBolts: 850, priceCrowns: 58 },
  ],

  // ===========================================================================
  // PAINT
  // ===========================================================================
  colors: [
    '#ff6a00', '#ffd23f', '#3ddc97', '#4cc2ff', '#b06bff', '#ff4d6d',
    '#e6ecf5', '#8a93a6', '#ff2e63', '#08d9d6', '#f9ed69', '#a8e10c',
    '#ff9f1c', '#7400b8', '#ff006e', '#3a86ff',
  ],
  proColors: [
    { id: 'chrome',    hex: '#e8eaf0', name: 'Chrome',     pro: true, priceBolts: 200, priceCrowns: 15 },
    { id: 'gold',      hex: '#ffd700', name: 'Gold',       pro: true, priceBolts: 250, priceCrowns: 18 },
    { id: 'neonpink',  hex: '#ff10f0', name: 'Neon Pink',  pro: true, priceBolts: 200, priceCrowns: 15 },
    { id: 'acidgreen', hex: '#39ff14', name: 'Acid Green', pro: true, priceBolts: 220, priceCrowns: 16 },
    { id: 'voidblack', hex: '#0d0f15', name: 'Void Black', pro: true, priceBolts: 220, priceCrowns: 16 },
    { id: 'crimson',   hex: '#a4001a', name: 'Crimson',    pro: true, priceBolts: 240, priceCrowns: 17 },
  ],
  accents: [
    '#ffffff', '#000000', '#ffd23f', '#ff6a00',
    '#3ddc97', '#4cc2ff', '#b06bff', '#ff2e63',
  ],
  patterns: [
    { id: 'solid',     name: 'Solid' },
    { id: 'stripes',   name: 'Stripes' },
    { id: 'racing',    name: 'Racing' },
    { id: 'checker',   name: 'Checker' },
    { id: 'flames',    name: 'Flames' },
    { id: 'splatter',  name: 'Splatter' },
    { id: 'carbon',    name: 'Carbon Fiber', pro: true, priceBolts: 300, priceCrowns: 20 },
    { id: 'lightning', name: 'Lightning',    pro: true, priceBolts: 320, priceCrowns: 22 },
    { id: 'tiger',     name: 'Tiger',        pro: true, priceBolts: 280, priceCrowns: 19 },
  ],

  // ===========================================================================
  // OPPONENTS  (5-round tournament)
  // ===========================================================================
  opponents: [
    { name: 'RUSTBUCKET', color: '#8a93a6', accent: '#ffd23f', pattern: 'solid',
      chassis: 'brick', weapon: 'drum', mods: [],
      stats: { armor: 4, speed: 4, power: 3, weight: 5 } }, // sum 16 ⇒ 12 used
    { name: 'SAWBLADE', color: '#ff4d6d', accent: '#000000', pattern: 'racing',
      chassis: 'wedge', weapon: 'spinner', mods: ['ramspikes'],
      stats: { armor: 3, speed: 4, power: 6, weight: 3 } }, // sum 16 ⇒ 12 used
    { name: 'JUDGE-MENT', color: '#b06bff', accent: '#ffd23f', pattern: 'checker',
      chassis: 'tank', weapon: 'hammer', mods: ['plow', 'frame'],
      stats: { armor: 6, speed: 2, power: 5, weight: 3 } },
    { name: 'MAG-NEATO', color: '#08d9d6', accent: '#000000', pattern: 'splatter',
      chassis: 'invertible', weapon: 'crusher', mods: ['magnet', 'srimech'],
      stats: { armor: 4, speed: 4, power: 4, weight: 4 } },
    { name: 'INFERNO', color: '#ff6a00', accent: '#ffd23f', pattern: 'flames',
      chassis: 'pyramid', weapon: 'flame', mods: ['skirts', 'wheelguards'],
      stats: { armor: 5, speed: 3, power: 5, weight: 3 } },
  ],
};

// ---------------------------------------------------------------------------
// Helpers (used by Bot)
// ---------------------------------------------------------------------------
function sumBonus(sources, key) {
  let s = 0;
  for (const src of sources) {
    const b = src && src.bonus;
    if (b && typeof b[key] === 'number') s += b[key];
  }
  return s;
}
function anyBonus(sources, key) {
  for (const src of sources) {
    const b = src && src.bonus;
    if (b && b[key]) return true;
  }
  return false;
}
