// Bot model: holds spec, runtime state, and rendering.
// Controllers (player input / AI) live separately and just set bot.input.

class Bot {
  constructor(spec, isPlayer = false) {
    this.spec = spec;
    this.isPlayer = isPlayer;

    const chassis = CONFIG.chassis.find(c => c.id === spec.chassis) || CONFIG.chassis[0];
    const weapon = CONFIG.weapons.find(w => w.id === spec.weapon) || CONFIG.weapons[0];
    const mods = (spec.mods || [])
      .map(id => CONFIG.mods.find(m => m.id === id))
      .filter(Boolean);
    this.chassis = chassis;
    this.weapon = weapon;
    this.mods = mods;

    const sources = [chassis, ...mods];
    const s = spec.stats;

    let hp = CONFIG.hpFromArmor(s.armor) + sumBonus(sources, 'hp');
    this.maxHp = Math.max(20, hp);
    this.hp = this.maxHp;

    const speedMul = 1 + sumBonus(sources, 'speed');
    this.accel = CONFIG.speedFromSpd(s.speed) * 110 * speedMul;
    this.maxSpeed = (90 + s.speed * 35) * speedMul;
    this.turnSpeed = CONFIG.turnFromSpd(s.speed) + sumBonus(sources, 'turn');

    this.dmgMul = CONFIG.dmgFromPower(s.power) + sumBonus(sources, 'dmgMul');

    const massMul = 1 + sumBonus(sources, 'mass');
    this.mass = Math.max(0.4, CONFIG.massFromWeight(s.weight) * massMul);

    this.deflect = sumBonus(sources, 'deflect');
    this.frontDeflect = sumBonus(sources, 'frontDeflect');
    this.knockResist = Math.min(0.85, sumBonus(sources, 'knockResist'));
    this.hover = anyBonus(sources, 'hover');
    this.regen = sumBonus(sources, 'regen');
    this.magnetRange = sumBonus(sources, 'magnet');
    this.ramDmg = sumBonus(sources, 'ramDmg');
    this.antiHazardDmg = sumBonus(sources, 'antiHazardDmg');
    this.hasBoost = anyBonus(sources, 'boost');

    // Runtime
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.radius = chassis.radius;

    this.input = { throttle: 0, turn: 0, fire: false };

    this.weaponCd = 0;
    this.weaponPhase = 'idle'; // idle | windup | active
    this.weaponPhaseT = 0;
    this.weaponDmgT = 0;
    this.lastHitMap = new Map();
    this.weaponSpinT = 0;

    this.boostT = 0;
    this.boostCd = 1.5;
    this.boostFx = 0;

    this.flashT = 0;
    this.dead = false;
    this.deathReason = null;
  }

  // -------------------------------------------------------------------------
  update(dt, world) {
    if (this.dead) return;

    const turn = clamp(this.input.turn, -1, 1);
    this.angle += turn * this.turnSpeed * dt;

    const throttle = clamp(this.input.throttle, -1, 1);

    // Booster mod
    if (this.hasBoost) {
      if (this.boostT > 0) {
        this.boostT -= dt;
        this.boostFx = 0.4;
        const boostA = this.accel * 1.2;
        this.vx += Math.cos(this.angle) * boostA * dt;
        this.vy += Math.sin(this.angle) * boostA * dt;
      } else if (this.boostCd > 0) {
        this.boostCd -= dt;
      } else if (throttle > 0.3) {
        this.boostT = 0.5;
        this.boostCd = 4.0;
      }
      if (this.boostFx > 0) this.boostFx -= dt;
    }

    const ax = Math.cos(this.angle) * this.accel * throttle;
    const ay = Math.sin(this.angle) * this.accel * throttle;
    this.vx += ax * dt;
    this.vy += ay * dt;

    const speed = Math.hypot(this.vx, this.vy);
    const maxS = this.maxSpeed * (throttle === 0 ? 0.6 : (this.boostT > 0 ? 1.6 : 1));
    if (speed > maxS) {
      this.vx *= maxS / speed;
      this.vy *= maxS / speed;
    }
    const drag = throttle === 0 ? 2.6 : 0.6;
    this.vx -= this.vx * drag * dt;
    this.vy -= this.vy * drag * dt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Regen / overload drain
    if (this.regen !== 0) {
      this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
      if (this.hp <= 0 && !this.dead) {
        this.hp = 0;
        this.dead = true;
        this.deathReason = 'overload';
      }
    }

    // Magnet (pull other bots toward us)
    if (this.magnetRange > 0 && world && world.bots) {
      for (const o of world.bots) {
        if (o === this || o.dead) continue;
        const dx = this.x - o.x, dy = this.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d < this.magnetRange && d > 4) {
          const k = 220 * (1 - d / this.magnetRange);
          o.vx += (dx / d) * k * dt;
          o.vy += (dy / d) * k * dt;
        }
      }
    }

    // Visual spin
    if (this.weapon.type === 'passive') {
      this.weaponSpinT += (this.weapon.drawSpin || 24) * dt;
    }

    // Active weapon state machine
    if (this.weapon.type === 'active') {
      if (this.weaponCd > 0) this.weaponCd -= dt;
      if (this.weaponPhase === 'idle' && this.input.fire && this.weaponCd <= 0) {
        this.weaponPhase = 'windup';
        this.weaponPhaseT = this.weapon.windup;
      } else if (this.weaponPhase === 'windup') {
        this.weaponPhaseT -= dt;
        if (this.weaponPhaseT <= 0) {
          this.weaponPhase = 'active';
          this.weaponPhaseT = this.weapon.active;
          this.weaponDmgT = 0;
          if (!this.weapon.dmgTickInterval) {
            this._applyActiveHit(world);
          }
        }
      } else if (this.weaponPhase === 'active') {
        this.weaponPhaseT -= dt;
        if (this.weapon.dmgTickInterval) {
          this.weaponDmgT -= dt;
          if (this.weaponDmgT <= 0) {
            this.weaponDmgT = this.weapon.dmgTickInterval;
            this._applyActiveHit(world);
          }
        }
        if (this.weaponPhaseT <= 0) {
          this.weaponPhase = 'idle';
          this.weaponCd = this.weapon.cooldown;
        }
      }
    }

    if (this.flashT > 0) this.flashT -= dt;
  }

  // -------------------------------------------------------------------------
  takeHit(amount, fromAngle, source = 'weapon') {
    if (source === 'hazard' && this.antiHazardDmg) {
      amount *= Math.max(0, 1 - this.antiHazardDmg);
    }
    const totalDeflect = this.deflect + this.frontDeflect;
    if (totalDeflect > 0 && fromAngle != null) {
      const delta = Math.abs(angDiff(this.angle, fromAngle + Math.PI));
      if (delta < Math.PI * 0.55) amount *= 1 - Math.min(0.85, totalDeflect);
    }
    this.hp -= amount;
    this.flashT = 0.12;
    if (this.hp <= 0 && !this.dead) {
      this.hp = 0;
      this.dead = true;
      this.deathReason = source;
    }
  }

  applyImpulse(fx, fy) {
    const k = 1 - this.knockResist;
    this.vx += fx * k / this.mass;
    this.vy += fy * k / this.mass;
  }

  // -------------------------------------------------------------------------
  // Passive contact damage — called from arena collision pass.
  // Side-mounted weapons (twinsaws) check both lateral offsets.
  tryPassiveHit(target, now) {
    if (this.weapon.type !== 'passive') return;
    const reach = this.radius + this.weapon.reach;
    const offsets = this.weapon.side
      ? [this.angle + Math.PI / 2, this.angle - Math.PI / 2]
      : [this.angle];
    for (const oAng of offsets) {
      const wx = this.x + Math.cos(oAng) * reach;
      const wy = this.y + Math.sin(oAng) * reach;
      const dx = target.x - wx, dy = target.y - wy;
      const dist = Math.hypot(dx, dy);
      if (dist > target.radius + 6) continue;
      const ang = Math.atan2(target.y - this.y, target.x - this.x);
      if (Math.abs(angDiff(ang, oAng)) > this.weapon.arc / 2) continue;
      const last = this.lastHitMap.get(target) || -999;
      if (now - last < this.weapon.tickInterval) return;
      this.lastHitMap.set(target, now);
      const dmg = this.weapon.damage * this.dmgMul;
      target.takeHit(dmg, oAng, 'weapon');
      const k = this.weapon.knockback;
      target.applyImpulse(Math.cos(oAng) * k, Math.sin(oAng) * k);
      const sk = this.weapon.selfKnockback;
      this.applyImpulse(-Math.cos(oAng) * sk, -Math.sin(oAng) * sk);
      return;
    }
  }

  _applyActiveHit(world) {
    const reach = this.radius + this.weapon.reach;
    for (const t of world.bots) {
      if (t === this || t.dead) continue;
      const distFromSelf = Math.hypot(t.x - this.x, t.y - this.y);
      if (distFromSelf > reach + t.radius + 12) continue;
      const ang = Math.atan2(t.y - this.y, t.x - this.x);
      if (Math.abs(angDiff(ang, this.angle)) > this.weapon.arc / 2) continue;
      const dmg = this.weapon.damage * this.dmgMul;
      t.takeHit(dmg, this.angle, 'weapon');
      const k = this.weapon.knockback;
      t.applyImpulse(Math.cos(this.angle) * k, Math.sin(this.angle) * k);
    }
    const wx = this.x + Math.cos(this.angle) * reach;
    const wy = this.y + Math.sin(this.angle) * reach;
    world.spawnImpact(wx, wy, this.weapon.id === 'flame' ? 'flame' : 'spark');
  }

  // -------------------------------------------------------------------------
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Boost flame trail (under chassis)
    if (this.boostFx > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255,170,40,${this.boostFx * 1.6})`;
      ctx.beginPath();
      ctx.moveTo(-this.radius, -3);
      ctx.lineTo(-this.radius - 22 * this.boostFx, 0);
      ctx.lineTo(-this.radius, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(2, 4, this.radius + 2, this.radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Chassis body
    const flash = this.flashT > 0 ? Math.max(0, this.flashT / 0.12) : 0;
    const body = lerpColor(this.spec.color, '#ffffff', flash * 0.65);
    drawChassis(ctx, this.chassis, body, this.radius);

    // Pattern overlay
    if (this.spec.pattern && this.spec.pattern !== 'solid') {
      drawPattern(ctx, this.spec.pattern, this.spec.accent || '#000', this.chassis, this.radius);
    }

    // Accent trim
    drawAccent(ctx, this.chassis, this.spec.accent || '#000', this.radius);

    // Weapon overlay
    drawWeapon(ctx, this);

    // Magnet field aura
    if (this.magnetRange > 0) {
      ctx.save();
      ctx.rotate(-this.angle);
      ctx.strokeStyle = 'rgba(76,194,255,0.18)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, this.magnetRange, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.restore();
  }
}

// ===========================================================================
// Chassis drawing
// ===========================================================================
function chassisPath(ctx, chassis, r) {
  switch (chassis.shape) {
    case 'box':       roundRect(ctx, -r * 0.9, -r * 0.85, r * 1.8, r * 1.7, 6); return;
    case 'tank':      roundRect(ctx, -r,       -r * 0.85, r * 2,   r * 1.7, 4); return;
    case 'tracked':   roundRect(ctx, -r * 0.85, -r * 0.6, r * 1.7, r * 1.2, 5); return;
    case 'invertible':roundRect(ctx, -r * 0.95, -r * 0.85, r * 1.9, r * 1.7, 12); return;
  }
  ctx.beginPath();
  switch (chassis.shape) {
    case 'wedge':
      ctx.moveTo(r + 4, 0);
      ctx.lineTo(-r * 0.8, -r * 0.85);
      ctx.lineTo(-r * 0.8, r * 0.85);
      ctx.closePath();
      break;
    case 'hover':
      ctx.ellipse(0, 0, r, r * 0.85, 0, 0, Math.PI * 2);
      break;
    case 'speeder':
      ctx.moveTo(r + 6, 0);
      ctx.lineTo(r * 0.5, -r * 0.7);
      ctx.lineTo(-r * 0.7, -r * 0.65);
      ctx.lineTo(-r * 0.95, 0);
      ctx.lineTo(-r * 0.7, r * 0.65);
      ctx.lineTo(r * 0.5, r * 0.7);
      ctx.closePath();
      break;
    case 'walker':
      ctx.moveTo(r * 0.85, -r * 0.45);
      ctx.lineTo(r * 0.4, -r * 0.85);
      ctx.lineTo(-r * 0.4, -r * 0.85);
      ctx.lineTo(-r * 0.85, -r * 0.45);
      ctx.lineTo(-r * 0.85, r * 0.45);
      ctx.lineTo(-r * 0.4, r * 0.85);
      ctx.lineTo(r * 0.4, r * 0.85);
      ctx.lineTo(r * 0.85, r * 0.45);
      ctx.closePath();
      break;
    case 'pyramid':
      ctx.moveTo(r * 1.05, 0);
      ctx.lineTo(0, -r * 0.95);
      ctx.lineTo(-r * 1.05, 0);
      ctx.lineTo(0, r * 0.95);
      ctx.closePath();
      break;
    case 'saucer':
      ctx.ellipse(0, 0, r * 1.1, r * 0.7, 0, 0, Math.PI * 2);
      break;
  }
}

function drawChassis(ctx, chassis, color, r) {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#0a0d13';
  ctx.lineWidth = 2;
  chassisPath(ctx, chassis, r);
  ctx.fill(); ctx.stroke();

  switch (chassis.shape) {
    case 'wedge':
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-r * 0.7, -r * 0.95, r * 0.4, r * 0.18);
      ctx.fillRect(-r * 0.7, r * 0.77, r * 0.4, r * 0.18);
      break;
    case 'box':
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-r * 0.95, -r * 0.95, r * 0.4, r * 0.2);
      ctx.fillRect(-r * 0.95, r * 0.77, r * 0.4, r * 0.2);
      ctx.fillRect(r * 0.55, -r * 0.95, r * 0.4, r * 0.2);
      ctx.fillRect(r * 0.55, r * 0.77, r * 0.4, r * 0.2);
      break;
    case 'tank':
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-r, -r, r * 2, r * 0.2);
      ctx.fillRect(-r, r * 0.8, r * 2, r * 0.2);
      break;
    case 'hover':
      ctx.fillStyle = 'rgba(76,194,255,0.18)';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.8, r * 1.1, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'speeder':
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(r * 0.1, 0, r * 0.35, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'tracked':
      ctx.fillStyle = '#1f242e';
      ctx.fillRect(-r, -r * 0.95, r * 2, r * 0.3);
      ctx.fillRect(-r, r * 0.65, r * 2, r * 0.3);
      // Re-draw body on top of tread housings to keep it crisp
      ctx.fillStyle = color;
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 2;
      chassisPath(ctx, chassis, r);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) {
        const yT = i * (r * 0.28);
        ctx.beginPath();
        ctx.moveTo(-r, yT); ctx.lineTo(-r * 0.85, yT);
        ctx.moveTo(r * 0.85, yT); ctx.lineTo(r, yT);
        ctx.stroke();
      }
      ctx.lineWidth = 2;
      break;
    case 'walker': {
      ctx.fillStyle = '#0a0d13';
      const legs = [
        [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7],
        [r * 0.85, 0], [-r * 0.85, 0],
        [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7],
      ];
      for (const [lx, ly] of legs) {
        ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'invertible':
      ctx.fillStyle = '#0a0d13';
      ctx.fillRect(-r * 0.6, -r * 0.95, r * 1.2, 4);
      ctx.fillRect(-r * 0.6, r * 0.83, r * 1.2, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(-r * 0.85, -2, r * 1.7, 4);
      break;
    case 'pyramid':
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 1.05, 0);
      ctx.lineTo(0, r * 0.95);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r * 0.95);
      ctx.lineTo(-r * 1.05, 0);
      ctx.closePath(); ctx.fill();
      break;
    case 'saucer':
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.1, r * 0.55, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.55, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
  }

  // Direction marker
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(r * 0.35, 0, 2, 0, Math.PI * 2);
  ctx.fill();
}

// ===========================================================================
// Pattern overlay (clipped to chassis silhouette)
// ===========================================================================
function drawPattern(ctx, pattern, accent, chassis, r) {
  ctx.save();
  chassisPath(ctx, chassis, r);
  ctx.clip();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = accent;
  switch (pattern) {
    case 'stripes':
      for (let x = -r * 1.2; x < r * 1.2; x += 8) {
        if (Math.floor((x + r * 1.2) / 8) % 2 === 0) {
          ctx.fillRect(x, -r * 1.2, 4, r * 2.4);
        }
      }
      break;
    case 'racing':
      ctx.fillRect(-r * 1.2, -3, r * 2.4, 6);
      ctx.globalAlpha = 0.45;
      ctx.fillRect(-r * 1.2, -7, r * 2.4, 2);
      ctx.fillRect(-r * 1.2, 5, r * 2.4, 2);
      break;
    case 'checker': {
      const sz = 5;
      for (let y = -r * 1.2; y < r * 1.2; y += sz) {
        for (let x = -r * 1.2; x < r * 1.2; x += sz) {
          if ((Math.floor((x + r * 1.2) / sz) + Math.floor((y + r * 1.2) / sz)) % 2 === 0) {
            ctx.fillRect(x, y, sz, sz);
          }
        }
      }
      break;
    }
    case 'flames': {
      ctx.beginPath();
      const points = 12;
      for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2;
        const flicker = (i % 2 === 0) ? r * 1.0 : r * 0.55;
        const x = Math.cos(a) * flicker;
        const y = Math.sin(a) * flicker;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'splatter': {
      const seed = [
        [-0.4, -0.5, 4], [0.3, -0.3, 3], [-0.2, 0.4, 5],
        [0.5, 0.1, 3], [0.1, 0.5, 4], [-0.6, 0.0, 2],
        [0.45, -0.55, 2.5], [-0.05, -0.7, 3],
      ];
      for (const [px, py, sz] of seed) {
        ctx.beginPath();
        ctx.arc(px * r, py * r, sz, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'carbon': {
      ctx.globalAlpha = 0.55;
      const sz = 4;
      for (let y = -r * 1.2; y < r * 1.2; y += sz) {
        for (let x = -r * 1.2; x < r * 1.2; x += sz) {
          const k = (Math.floor((x + r * 1.2) / sz) + Math.floor((y + r * 1.2) / sz)) % 2;
          if (k === 0) ctx.fillRect(x, y, sz - 1, sz / 2);
          else ctx.fillRect(x + sz / 2, y + sz / 2, sz / 2, sz - 1);
        }
      }
      break;
    }
    case 'lightning': {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(-r * 1.0, -r * 0.2);
      ctx.lineTo(-r * 0.3,  r * 0.0);
      ctx.lineTo(-r * 0.5,  r * 0.4);
      ctx.lineTo( r * 0.2, -r * 0.1);
      ctx.lineTo( r * 0.0,  r * 0.3);
      ctx.lineTo( r * 0.9, -r * 0.4);
      ctx.stroke();
      break;
    }
    case 'tiger': {
      ctx.globalAlpha = 0.7;
      const stripes = [
        [-0.95, -0.4, 0.4, 0.18, -0.2],
        [-0.55, -0.6, 0.5, 0.16,  0.15],
        [-0.10, -0.5, 0.45, 0.20, -0.1],
        [ 0.35, -0.35, 0.55, 0.18, 0.1],
        [-0.85,  0.25, 0.5, 0.18, 0.18],
        [-0.2,   0.45, 0.5, 0.16, -0.12],
        [ 0.3,   0.3,  0.55, 0.20, 0.08],
      ];
      for (const [x, y, w, h, rot] of stripes) {
        ctx.save();
        ctx.translate(x * r, y * r);
        ctx.rotate(rot);
        ctx.fillRect(0, 0, w * r, h * r);
        ctx.restore();
      }
      break;
    }
  }
  ctx.restore();
}

// ===========================================================================
// Accent trim (small highlight stripes)
// ===========================================================================
function drawAccent(ctx, chassis, accent, r) {
  ctx.save();
  ctx.fillStyle = accent;
  // Forward bumper dot
  ctx.fillRect(r * 0.55, -2, 4, 4);
  if (['box', 'tank', 'tracked', 'invertible'].includes(chassis.shape)) {
    ctx.fillRect(-r * 0.85, -r * 0.85, 2, r * 1.7);
    ctx.fillRect(r * 0.83, -r * 0.85, 2, r * 1.7);
  } else if (chassis.shape === 'pyramid') {
    ctx.fillRect(-1, -r * 0.95, 2, r * 1.9);
  } else if (chassis.shape === 'saucer' || chassis.shape === 'hover') {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();
  } else if (chassis.shape === 'wedge' || chassis.shape === 'speeder') {
    ctx.fillRect(-r * 0.4, -1, r * 0.6, 2);
  }
  ctx.restore();
}

// ===========================================================================
// Weapons
// ===========================================================================
function drawWeapon(ctx, bot) {
  const w = bot.weapon;
  const r = bot.radius;
  ctx.save();
  switch (w.id) {
    case 'spinner': {
      const reach = r + w.reach;
      ctx.translate(reach - 6, 0);
      ctx.rotate(bot.weaponSpinT);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      const blade = 22;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * blade, Math.sin(a) * blade);
        ctx.lineTo(Math.cos(a + 0.4) * blade * 0.4, Math.sin(a + 0.4) * blade * 0.4);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#0a0d13';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'drum': {
      ctx.translate(r * 0.85, 0);
      ctx.rotate(bot.weaponSpinT);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      roundRect(ctx, -4, -r * 0.7, 12, r * 1.4, 3);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#0a0d13';
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(2, i * 6 - 1, 6, 2);
      }
      break;
    }
    case 'vertspin': {
      ctx.translate(r + 4, 0);
      ctx.fillStyle = '#1f242e';
      ctx.fillRect(-2, -r * 0.5, 4, r);
      ctx.rotate(bot.weaponSpinT);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#0a0d13';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        ctx.fillRect(Math.cos(a) * 11 - 1.5, Math.sin(a) * (r * 0.5) - 1, 3, 2);
      }
      break;
    }
    case 'spinbar': {
      ctx.rotate(bot.weaponSpinT);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      const barLen = r + w.reach - 4;
      ctx.fillRect(-barLen, -3.5, barLen * 2, 7);
      ctx.strokeRect(-barLen, -3.5, barLen * 2, 7);
      ctx.fillStyle = '#0a0d13';
      ctx.fillRect(barLen - 4, -5, 4, 10);
      ctx.fillRect(-barLen, -5, 4, 10);
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'twinsaws': {
      for (const sign of [-1, 1]) {
        ctx.save();
        ctx.translate(0, sign * (r + 4));
        ctx.rotate(bot.weaponSpinT * sign);
        ctx.fillStyle = '#cfd6e2';
        ctx.strokeStyle = '#0a0d13';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#0a0d13';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9);
          ctx.lineTo(Math.cos(a + 0.18) * 12, Math.sin(a + 0.18) * 12);
          ctx.lineTo(Math.cos(a + 0.36) * 9, Math.sin(a + 0.36) * 9);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      break;
    }
    case 'hammer': {
      const phase = bot.weaponPhase;
      let armAng = -Math.PI / 2;
      if (phase === 'windup') armAng = -Math.PI / 2 - 0.6;
      else if (phase === 'active') armAng = 0.4;
      ctx.translate(-r * 0.4, 0);
      ctx.rotate(armAng);
      ctx.fillStyle = '#3a4258';
      ctx.fillRect(0, -3, r * 1.6, 6);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      roundRect(ctx, r * 1.4, -10, 18, 20, 3);
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'axe': {
      const phase = bot.weaponPhase;
      let armAng = -Math.PI / 2 - 0.4;
      if (phase === 'windup') armAng = -Math.PI / 2 - 1.2;
      else if (phase === 'active') armAng = 0.5;
      ctx.translate(-r * 0.45, 0);
      ctx.rotate(armAng);
      ctx.fillStyle = '#2a3142';
      ctx.fillRect(0, -3, r * 1.7, 6);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(r * 1.5, -4);
      ctx.lineTo(r * 1.85, -16);
      ctx.lineTo(r * 2.05, -8);
      ctx.lineTo(r * 2.05, 8);
      ctx.lineTo(r * 1.85, 16);
      ctx.lineTo(r * 1.5, 4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'spear': {
      const phase = bot.weaponPhase;
      let extend = 0;
      if (phase === 'windup') extend = -3;
      else if (phase === 'active') extend = 16;
      ctx.translate(r * 0.4, 0);
      ctx.fillStyle = '#3a4258';
      ctx.fillRect(0, -2, r * 0.7 + extend, 4);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(r * 0.7 + extend, -4);
      ctx.lineTo(r * 0.7 + extend + 8, 0);
      ctx.lineTo(r * 0.7 + extend, 4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'flipper': {
      const phase = bot.weaponPhase;
      let lift = 0;
      if (phase === 'windup') lift = -2;
      else if (phase === 'active') lift = -10;
      ctx.translate(r * 0.6, 0);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.7);
      ctx.lineTo(r * 0.9 + lift, -r * 0.4 + lift);
      ctx.lineTo(r * 0.9 + lift, r * 0.4 + lift);
      ctx.lineTo(0, r * 0.7);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'lifter': {
      const phase = bot.weaponPhase;
      let lift = 0;
      if (phase === 'windup') lift = -1;
      else if (phase === 'active') lift = -6;
      ctx.translate(r * 0.7, 0);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5);
      ctx.lineTo(r * 0.6 + lift, -r * 0.25 + lift);
      ctx.lineTo(r * 0.6 + lift, r * 0.25 + lift);
      ctx.lineTo(0, r * 0.5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'crusher': {
      const phase = bot.weaponPhase;
      let bite = 0.7;
      if (phase === 'windup') bite = 1.0;
      else if (phase === 'active') bite = 0.2;
      ctx.translate(r * 0.6, 0);
      ctx.fillStyle = '#cfd6e2';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.3);
      ctx.lineTo(r * 0.7, -r * 0.5 * bite);
      ctx.lineTo(r * 0.95, -r * 0.18 * bite);
      ctx.lineTo(r * 0.3, -r * 0.05);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, r * 0.3);
      ctx.lineTo(r * 0.7, r * 0.5 * bite);
      ctx.lineTo(r * 0.95, r * 0.18 * bite);
      ctx.lineTo(r * 0.3, r * 0.05);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'plasma': {
      const phase = bot.weaponPhase;
      // Barrel
      ctx.fillStyle = '#2a3142';
      ctx.fillRect(r * 0.4, -5, r * 0.85, 10);
      ctx.fillStyle = '#cfd6e2';
      ctx.fillRect(r * 0.4 + r * 0.78, -6, 6, 12);
      // Charging glow during windup
      if (phase === 'windup') {
        const t = 1 - (bot.weaponPhaseT / bot.weapon.windup);
        ctx.fillStyle = `rgba(76,194,255,${0.55 * t})`;
        ctx.beginPath();
        ctx.arc(r * 0.4 + r * 0.85, 0, 6 + t * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      // Plasma orb during active phase
      if (phase === 'active') {
        const a = bot.weaponPhaseT / bot.weapon.active;
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i === 0 ? '#ffffff' : (i === 1 ? '#9be4ff' : '#4cc2ff');
          ctx.globalAlpha = 0.85 * a;
          ctx.beginPath();
          ctx.arc(r * 0.4 + r * 0.85 + 6, 0, 10 - i * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'vortex': {
      const reach = r + w.reach;
      ctx.translate(reach - 8, 0);
      ctx.rotate(bot.weaponSpinT);
      ctx.fillStyle = '#4cc2ff';
      ctx.strokeStyle = '#0a0d13';
      ctx.lineWidth = 1.5;
      const blade = 26;
      // Twin opposing blades
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(blade, -3);
      ctx.lineTo(blade * 0.4, 0);
      ctx.lineTo(blade, 3);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-blade, -3);
      ctx.lineTo(-blade * 0.4, 0);
      ctx.lineTo(-blade, 3);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // Hub with pro glow
      ctx.fillStyle = '#0a0d13';
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'flame': {
      const phase = bot.weaponPhase;
      ctx.fillStyle = '#3a4258';
      ctx.fillRect(r * 0.7, -3, 8, 6);
      if (phase === 'active') {
        const seed = (bot.weaponSpinT + bot.weaponPhaseT * 30);
        for (let i = 0; i < 12; i++) {
          const t = i / 12;
          const dist = r * 0.78 + 8 + t * (w.reach - 8);
          const offY = Math.sin(seed * 7 + i * 1.4) * dist * 0.18;
          ctx.fillStyle = i < 4 ? '#ffffff' : (i < 8 ? '#ffd23f' : '#ff6a00');
          ctx.globalAlpha = 0.85 - t * 0.6;
          ctx.beginPath();
          ctx.arc(dist, offY, 7 - i * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
  }
  ctx.restore();
}

// ===========================================================================
// Controllers
// ===========================================================================
class PlayerController {
  constructor(input) { this.input = input; }
  update(bot) {
    const k = this.input.keys;
    let throttle = 0, turn = 0;
    if (k['w'] || k['arrowup']) throttle += 1;
    if (k['s'] || k['arrowdown']) throttle -= 1;
    if (k['a'] || k['arrowleft']) turn -= 1;
    if (k['d'] || k['arrowright']) turn += 1;
    bot.input.throttle = throttle;
    bot.input.turn = turn;
    bot.input.fire = !!k[' '];
  }
}

class AIController {
  constructor(target) { this.target = target; this.jitter = 0; this.jitterT = 0; }
  update(bot, dt, world) {
    const t = this.target;
    if (!t || t.dead) { bot.input.throttle = 0; bot.input.turn = 0; bot.input.fire = false; return; }

    const tdx = t.x - bot.x, tdy = t.y - bot.y;
    const dist = Math.hypot(tdx, tdy) || 1;
    let ax = tdx / dist;
    let ay = tdy / dist;

    const H = world && world.hazards;
    if (H) {
      if (!bot.hover) {
        const pdx = bot.x - H.pit.x;
        const pdy = bot.y - H.pit.y;
        const pd = Math.hypot(pdx, pdy) || 1;
        const safe = Math.max(H.pit.w, H.pit.h) / 2 + bot.radius + 60;
        if (pd < safe) {
          const k = (safe - pd) / safe;
          ax += (pdx / pd) * k * 3.4;
          ay += (pdy / pd) * k * 3.4;
        }
      }
      for (const s of H.saws) {
        const sdx = bot.x - s.x;
        const sdy = bot.y - s.y;
        const sd = Math.hypot(sdx, sdy) || 1;
        const safe = s.r + bot.radius + 36;
        if (sd < safe) {
          const k = (safe - sd) / safe;
          ax += (sdx / sd) * k * 2.4;
          ay += (sdy / sd) * k * 2.4;
        }
      }
      if (!bot.hover) {
        const sp = H.spikes;
        const dangerX = sp.x + sp.w + bot.radius + 50;
        if (bot.x < dangerX && bot.y > sp.y - 30 && bot.y < sp.y + sp.h + 30) {
          const k = clamp((dangerX - bot.x) / 80, 0, 1);
          ax += k * 2.2;
        }
      }
    }

    const desired = Math.atan2(ay, ax);
    let diff = angDiff(desired, bot.angle);

    this.jitterT -= dt;
    if (this.jitterT <= 0) {
      this.jitter = (Math.random() - 0.5) * 0.5;
      this.jitterT = 0.6 + Math.random() * 0.8;
    }
    diff += this.jitter * 0.2;

    bot.input.turn = clamp(diff * 2.4, -1, 1);

    let imminentPit = false;
    if (H && !bot.hover) {
      const look = 0.55;
      const fx = bot.x + bot.vx * look;
      const fy = bot.y + bot.vy * look;
      const p = H.pit;
      const pad = bot.radius * 0.4;
      if (fx > p.x - p.w / 2 - pad && fx < p.x + p.w / 2 + pad &&
          fy > p.y - p.h / 2 - pad && fy < p.y + p.h / 2 + pad) {
        imminentPit = true;
      }
    }

    const facing = Math.abs(diff) < 0.4;
    if (imminentPit) {
      bot.input.throttle = -1;
    } else if (facing) {
      bot.input.throttle = 1;
    } else if (Math.abs(diff) > 2.4 && dist < 80) {
      bot.input.throttle = -0.6;
    } else {
      bot.input.throttle = 0.4;
    }

    if (bot.weapon.type === 'active') {
      const fireRange = bot.radius + t.radius + bot.weapon.reach + 18;
      bot.input.fire = (dist < fireRange) && Math.abs(diff) < 0.5;
    } else {
      bot.input.fire = false;
    }
  }
}

// ===========================================================================
// Math helpers
// ===========================================================================
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function lerpColor(hex, hex2, t) {
  const a = hexToRgb(hex), b = hexToRgb(hex2);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
