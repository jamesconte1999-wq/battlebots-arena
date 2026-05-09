# ArenaBots.io

A premium combat-robot browser game. Build your bot in a deep workshop, then
drive it into a hazard-filled arena and wreck the AI opponents in a 5-round
tournament.

## Run it

Just open `index.html` in a modern browser, or serve the folder:

```pwsh
python -m http.server 8765
# then visit http://localhost:8765
```

No build step. Pure HTML/CSS/JS.

## Controls

- **W / A / S / D** (or arrow keys) — drive the bot.
- **Space** — fire the active weapon (Hammer or Flipper). Spinners and Drums damage on contact passively.
- **P** — pause.

## Bot building

Pick a chassis, weapon, and allocate **10 stat points** across:

- **Armor** — total HP.
- **Speed** — acceleration and turn rate.
- **Power** — weapon damage multiplier.
- **Weight** — mass; resists knockback and pushes opponents harder.

### Chassis

- **Wedge** — fast, deflects 30% of frontal hits.
- **Brick** — balanced.
- **Heavy Tank** — bonus HP and mass, slow turn.
- **Hovercraft** — floats over the pit and ignores spike strip, but fragile.

### Weapons

- **Horizontal Spinner** — passive, big damage, knocks you both around.
- **Front Drum** — passive, smaller but more controllable.
- **Pneumatic Hammer** — active, big burst when you press Space.
- **Flipper** — active, low damage but huge launch impulse.

## Arena hazards

- **Pit** (center) — instant KO unless your bot hovers.
- **Saw blades** (top-left, bottom-right) — heavy contact damage.
- **Spike strip** (left wall) — damage over time.
- **Yellow walls** — bounce off, no out-of-bounds.

## Project layout

```
battlebots-arena/
  index.html          # screens: title / builder / arena / result
  styles.css
  js/
    config.js         # chassis, weapons, opponents, tuning
    bot.js            # Bot class, drawing, controllers (player + AI)
    builder.js        # build screen UI + live preview
    arena.js          # match physics, hazards, render loop
    main.js           # screen routing + tournament progression
```

## Extending

- **New chassis or weapon**: add an entry to `CONFIG.chassis` / `CONFIG.weapons`
  in `js/config.js`. Add a render branch to `drawChassis` / `drawWeapon` in
  `js/bot.js` for visuals.
- **New opponent**: append to `CONFIG.opponents`.
- **New hazard**: add to `HAZARDS` and a collision/render branch in
  `js/arena.js`.
- **Tuning**: stat curves live at the top of `js/config.js`.
