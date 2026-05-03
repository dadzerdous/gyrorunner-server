// server.js — Spire Online
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

const players = {};
let enemies = [];
let portal = null;
let gamePhase = 'WAVE';
let waveNum = 1;
const arenaSize = 450;

// ============================================================
//  ELEMENT DATA (duplicated server-side for validation)
//  Keep in sync with client elements.js
// ============================================================
const ENEMY_ELEMENTS = {
    goblin:   { element: 'poison',   weakTo: ['fire', 'holy'],      resistTo: ['water', 'dark'] },
    skeleton: { element: 'necrotic', weakTo: ['holy', 'light'],     resistTo: ['poison', 'dark'] },
    troll:    { element: 'earth',    weakTo: ['lightning', 'water'], resistTo: ['fire', 'earth'] },
    wraith:   { element: 'dark',     weakTo: ['holy', 'light'],     resistTo: ['necrotic', 'void'] },
    miniboss: { element: 'void',     weakTo: [],                    resistTo: [] },
    boss:     { element: 'chaos',    weakTo: [],                    resistTo: [] },
};

const DAMAGE_CHART = {
    fire:      { fire:1.0, water:0.5, ice:2.0,  light:1.0, necrotic:1.5, dark:1.0, holy:0.5, void:1.0, wind:0.5, earth:1.0, poison:1.5, lightning:1.0 },
    water:     { fire:2.0, water:1.0, ice:0.5,  light:1.0, necrotic:1.0, dark:1.0, holy:0.5, void:1.0, wind:1.5, earth:1.5, poison:0.5, lightning:0.5 },
    ice:       { fire:0.5, water:1.5, ice:1.0,  light:1.0, necrotic:1.5, dark:0.5, holy:1.0, void:1.0, wind:0.5, earth:0.5, poison:1.0, lightning:1.0 },
    lightning: { fire:1.0, water:2.0, ice:1.5,  light:1.5, necrotic:0.5, dark:1.0, holy:1.0, void:0.5, wind:1.5, earth:0.5, poison:1.0, lightning:1.0 },
    poison:    { fire:0.5, water:1.5, ice:1.0,  light:0.5, necrotic:0.5, dark:1.5, holy:0.5, void:1.0, wind:1.0, earth:2.0, poison:1.0, lightning:1.0 },
    earth:     { fire:1.0, water:0.5, ice:0.5,  light:1.0, necrotic:1.0, dark:1.0, holy:1.0, void:0.5, wind:2.0, earth:1.0, poison:0.5, lightning:2.0 },
    dark:      { fire:1.0, water:1.0, ice:1.0,  light:0.5, necrotic:0.5, dark:1.0, holy:0.2, void:1.5, wind:1.0, earth:1.0, poison:1.5, lightning:1.0 },
    light:     { fire:1.0, water:1.0, ice:1.0,  light:1.0, necrotic:2.0, dark:2.0, holy:0.5, void:1.5, wind:1.0, earth:1.0, poison:1.0, lightning:1.0 },
    holy:      { fire:0.5, water:1.0, ice:1.0,  light:1.0, necrotic:2.0, dark:2.0, holy:1.0, void:1.5, wind:1.0, earth:1.0, poison:0.5, lightning:1.0 },
    necrotic:  { fire:0.5, water:1.0, ice:1.5,  light:0.5, necrotic:1.0, dark:1.5, holy:0.2, void:2.0, wind:1.0, earth:1.0, poison:2.0, lightning:0.5 },
    void:      { fire:1.0, water:1.0, ice:1.0,  light:1.5, necrotic:1.5, dark:1.5, holy:1.5, void:1.0, wind:1.0, earth:1.0, poison:1.0, lightning:1.0 },
    wind:      { fire:0.5, water:0.5, ice:1.0,  light:1.0, necrotic:1.0, dark:1.0, holy:1.0, void:0.5, wind:1.0, earth:2.0, poison:1.5, lightning:0.5 },
};

// Cross-combo table (status → attacker element → result)
const CROSS_COMBOS = {
    frozen:      { fire: { name:'Shatter', dmgMult:3.0, aoe:true, aoeRadius:100 }, lightning:{ name:'Cryostrike', dmgMult:2.0 }, earth:{ name:'Avalanche', dmgMult:2.5, aoe:true } },
    soaked:      { lightning:{ name:'Conductance', dmgMult:2.0, chainAll:true }, ice:{ name:'Flash Freeze', dmgMult:1.5, instantFreeze:true } },
    burn:        { water:{ name:'Steam Burst', dmgMult:1.5 }, poison:{ name:'Venom Flare', dmgMult:2.0 } },
    shocked:     { earth:{ name:'Grounded', dmgMult:2.0, stun:180 }, water:{ name:'Electrolysis', dmgMult:1.5 } },
    poisoned:    { fire:{ name:'Venom Flare', dmgMult:2.5, aoe:true }, holy:{ name:'Purge', dmgMult:2.0 } },
    cursed:      { holy:{ name:'Exorcism', dmgMult:4.0 }, light:{ name:'Revelation', dmgMult:2.5 } },
    decay:       { light:{ name:'Purge', dmgMult:3.0 }, fire:{ name:'Cremation', dmgMult:2.0 } },
    nulled:      { _any:{ name:'Amplified', dmgMult:2.0 } },
    staggered:   { wind:{ name:'Rockslide', dmgMult:2.0 }, lightning:{ name:'Shockwave', dmgMult:2.0 } },
    illuminated: { dark:{ name:'Eclipse', dmgMult:2.0 }, holy:{ name:'Judgement', dmgMult:3.0, aoe:true } },
};

// Status tick intervals (frames at 20fps = 50ms tick)
const STATUS_TICKS = {
    burn:     { interval: 30, dmg: (s) => s * 0.5 },
    poisoned: { interval: 40, dmg: (s) => s * 0.3 },
    seared:   { interval: 45, dmg: (s) => s * 0.8 },
};

// ============================================================
//  SWARM CONFIG
// ============================================================
const SWARM_CONFIG = {
    getSpawnInterval(tier) {
        // Faster spawns at higher tiers (min 1.5s)
        return Math.max(1500, 5000 - tier * 300);
    },
    getEnemyPool(tier) {
        const pool = ['goblin'];
        if (tier >= 2)  pool.push('skeleton');
        if (tier >= 4)  pool.push('wraith');
        if (tier >= 6)  pool.push('troll');
        if (tier >= 8)  pool.push('skeleton', 'wraith');
        return pool;
    },
    getSpawnCount(tier) {
        return Math.min(2 + Math.floor(tier / 2), 6);
    },
    isBossTier(tier) { return tier > 0 && tier % 10 === 0; },
    isMiniBossTier(tier) { return tier > 0 && tier % 5 === 0 && tier % 10 !== 0; },
};

let swarmTier = 1;
let swarmTimer = null;
let tierTimer = null;
let runStartTime = null;

// ============================================================
//  SPAWN HELPERS
// ============================================================
function spawnEnemy(type, count = 1) {
    for (let i = 0; i < count; i++) {
        const side = Math.floor(Math.random() * 4);
        const m = 30;
        let x, y;
        if      (side === 0) { x = -arenaSize + m; y = (Math.random()*2-1)*arenaSize; }
        else if (side === 1) { x =  arenaSize - m; y = (Math.random()*2-1)*arenaSize; }
        else if (side === 2) { y = -arenaSize + m; x = (Math.random()*2-1)*arenaSize; }
        else                 { y =  arenaSize - m; x = (Math.random()*2-1)*arenaSize; }

        const configs = {
            goblin:   { emoji:'👺', hp:3,  speed:1.8, radius:15 },
            skeleton: { emoji:'💀', hp:2,  speed:1.0, radius:15 },
            troll:    { emoji:'👾', hp:6,  speed:1.2, radius:20 },
            wraith:   { emoji:'👻', hp:4,  speed:2.2, radius:15 },
            miniboss: { emoji:'🐲', hp:30, speed:1.0, radius:25 },
            boss:     { emoji:'👹', hp:80, speed:0.7, radius:35 },
        };
        const cfg = configs[type] || configs.goblin;
        const elDef = ENEMY_ELEMENTS[type] || { element:'earth', weakTo:[], resistTo:[] };

        const scaledHp = cfg.hp * (1 + swarmTier * 0.15);
        enemies.push({
            id: Math.random().toString(36).slice(2),
            type, x, y,
            emoji: cfg.emoji,
            hp: scaledHp,
            maxHp: scaledHp,
            speed: cfg.speed * (1 + swarmTier * 0.03),
            radius: cfg.radius,
            element: elDef.element,
            weakTo: elDef.weakTo,
            resistTo: elDef.resistTo,
            statuses: {},     // elemental statuses keyed by status name
            lastShot: 0,
        });
    }
}

function startSwarm() {
    stopSwarm();
    runStartTime = Date.now();
    gamePhase = 'WAVE';
    portal = null;

    // Initial spawn burst
    const pool = SWARM_CONFIG.getEnemyPool(swarmTier);
    const count = SWARM_CONFIG.getSpawnCount(swarmTier) * 2;
    for (let i = 0; i < count; i++) {
        spawnEnemy(pool[Math.floor(Math.random() * pool.length)]);
    }

    // Boss / miniboss wave injection
    if (SWARM_CONFIG.isBossTier(swarmTier)) {
        spawnEnemy('boss', 1);
        spawnEnemy('goblin', 3);
        console.log(`[Server] BOSS WAVE — Tier ${swarmTier}`);
    } else if (SWARM_CONFIG.isMiniBossTier(swarmTier)) {
        spawnEnemy('miniboss', 1);
        console.log(`[Server] MINI-BOSS — Tier ${swarmTier}`);
    }

    // Continuous spawn timer
    swarmTimer = setInterval(() => {
        if (gamePhase !== 'WAVE') return;
        const pool2 = SWARM_CONFIG.getEnemyPool(swarmTier);
        const n = SWARM_CONFIG.getSpawnCount(swarmTier);
        for (let i = 0; i < n; i++) {
            spawnEnemy(pool2[Math.floor(Math.random() * pool2.length)]);
        }
    }, SWARM_CONFIG.getSpawnInterval(swarmTier));

    // Tier escalation every 45 seconds
    tierTimer = setInterval(() => {
        swarmTier++;
        console.log(`[Server] Swarm escalated to Tier ${swarmTier}`);
        broadcastEvent('tierUp', { tier: swarmTier });

        if (SWARM_CONFIG.isBossTier(swarmTier)) {
            spawnEnemy('boss', 1);
            broadcastEvent('bossIncoming', { tier: swarmTier });
        } else if (SWARM_CONFIG.isMiniBossTier(swarmTier)) {
            spawnEnemy('miniboss', 1);
            broadcastEvent('miniBossIncoming', { tier: swarmTier });
        }

        // Restart spawn timer with new interval
        clearInterval(swarmTimer);
        swarmTimer = setInterval(() => {
            if (gamePhase !== 'WAVE') return;
            const p = SWARM_CONFIG.getEnemyPool(swarmTier);
            const n2 = SWARM_CONFIG.getSpawnCount(swarmTier);
            for (let i = 0; i < n2; i++) spawnEnemy(p[Math.floor(Math.random() * p.length)]);
        }, SWARM_CONFIG.getSpawnInterval(swarmTier));
    }, 45000);

    broadcastState();
}

function stopSwarm() {
    if (swarmTimer) { clearInterval(swarmTimer); swarmTimer = null; }
    if (tierTimer)  { clearInterval(tierTimer);  tierTimer  = null; }
}

// ============================================================
//  ELEMENTAL DAMAGE CALCULATION (server-authoritative)
// ============================================================
function calcElementalDamage(baseDmg, attackElement, enemy) {
    let dmg = baseDmg;
    if (attackElement && enemy.element && DAMAGE_CHART[attackElement]) {
        dmg *= DAMAGE_CHART[attackElement][enemy.element] ?? 1.0;
    }
    // Nulled ignores resistances
    if (enemy.statuses?.nulled?.stacks > 0) {
        const raw = DAMAGE_CHART[attackElement]?.[enemy.element] ?? 1.0;
        if (raw < 1.0) dmg = baseDmg;
    }
    // Soaked amplifier
    if (enemy.statuses?.soaked?.stacks > 0) {
        dmg *= 1.5;
        enemy.statuses.soaked.stacks = 0;
    }
    // Cursed amplifier
    if (enemy.statuses?.cursed?.stacks > 0) {
        dmg *= 1 + (enemy.statuses.cursed.stacks * 0.15);
    }
    return Math.round(dmg * 10) / 10;
}

// ============================================================
//  APPLY STATUS (server-side)
// ============================================================
function applyStatus(enemy, element, playerId, stacks = 1) {
    const statusMap = {
        fire: 'burn', water: 'soaked', ice: 'frozen', lightning: 'shocked',
        poison: 'poisoned', earth: 'staggered', dark: 'cursed', light: 'illuminated',
        holy: 'seared', necrotic: 'decay', void: 'nulled', wind: 'swept',
    };
    const key = statusMap[element];
    if (!key) return;

    const durations = {
        burn:180, soaked:240, frozen:150, shocked:120, poisoned:300,
        staggered:90, cursed:240, illuminated:200, seared:180, decay:360, nulled:180, swept:120,
    };
    const maxStacks = {
        burn:5, soaked:1, frozen:1, shocked:1, poisoned:8,
        staggered:1, cursed:5, illuminated:1, seared:3, decay:4, nulled:1, swept:1,
    };

    if (!enemy.statuses[key]) {
        enemy.statuses[key] = { stacks: 0, duration: 0, tickTimer: 0, element, appliedBy: playerId };
    }
    const s = enemy.statuses[key];
    s.stacks = Math.min(s.stacks + stacks, maxStacks[key] || 1);
    s.duration = Math.max(s.duration, durations[key] || 120);
    s.appliedBy = playerId; // last player to apply owns it for cross-combo credit
}

// ============================================================
//  CHECK CROSS-COMBO (server-authoritative)
// ============================================================
function checkCrossCombo(enemy, attackElement, attackPlayerId) {
    if (!enemy.statuses) return null;
    for (const [statusKey, statusData] of Object.entries(enemy.statuses)) {
        if (!statusData || statusData.stacks <= 0) continue;
        if (statusData.appliedBy === attackPlayerId) continue; // no self-combo
        const table = CROSS_COMBOS[statusKey];
        if (!table) continue;
        const combo = table[attackElement] || table['_any'];
        if (combo) {
            return { ...combo, statusKey, attackElement,
                     triggeredBy: attackPlayerId, statusAppliedBy: statusData.appliedBy };
        }
    }
    return null;
}

// ============================================================
//  TICK STATUSES (called in game loop)
// ============================================================
function tickAllStatuses() {
    enemies.forEach(en => {
        if (!en.statuses) return;
        for (const [key, s] of Object.entries(en.statuses)) {
            if (!s || s.stacks <= 0) continue;
            s.duration--;
            if (s.duration <= 0) { delete en.statuses[key]; continue; }

            const tickDef = STATUS_TICKS[key];
            if (tickDef) {
                s.tickTimer = (s.tickTimer || 0) + 1;
                if (s.tickTimer >= tickDef.interval) {
                    s.tickTimer = 0;
                    const dmg = tickDef.dmg(s.stacks);
                    en.hp -= dmg;
                    if (en.hp <= 0) {
                        enemies = enemies.filter(e => e.id !== en.id);
                    }
                }
            }

            // Ice slow
            if (key === 'frozen' && !en._frozenApplied) {
                en._frozenApplied = true;
                en._baseSpeed = en.speed;
                en.speed *= 0.15;
            }
        }
        // Restore speed when frozen expires
        if (!en.statuses.frozen && en._frozenApplied) {
            en._frozenApplied = false;
            if (en._baseSpeed) { en.speed = en._baseSpeed; delete en._baseSpeed; }
        }
    });
}

// ============================================================
//  BROADCAST HELPERS
// ============================================================
function broadcastState() {
    const snapshot = JSON.stringify({
        type: "state",
        players,
        enemies,
        portal,
        phase: gamePhase,
        wave: waveNum,
        swarmTier,
    });
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(snapshot); });
}

function broadcastEvent(eventType, data = {}) {
    const msg = JSON.stringify({ type: 'event', event: eventType, ...data });
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

function broadcastCombo(combo, enemyId, triggeredBy, statusAppliedBy) {
    const msg = JSON.stringify({
        type: 'crossCombo',
        comboName: combo.name,
        color: combo.color,
        enemyId,
        triggeredBy,
        statusAppliedBy,
        dmgMult: combo.dmgMult,
    });
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// ============================================================
//  CONNECTION HANDLING
// ============================================================
wss.on("connection", (ws) => {
    const id = Math.random().toString(36).slice(2);
    players[id] = {
        x: 0, y: 0, hp: 10, ready: false,
        avatar: '❓', className: '', heroName: '',
        activeElements: ['fire'],
    };

    console.log(`[Server] Player ${id} connected`);
    ws.send(JSON.stringify({ type: "welcome", id }));

    if (Object.keys(players).length === 1) {
        swarmTier = 1;
        startSwarm();
    } else {
        ws.send(JSON.stringify({
            type: "state", players, enemies, portal, phase: gamePhase, wave: waveNum, swarmTier
        }));
    }

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        // --- MOVE ---
        if (msg.type === "move" && players[id]) {
            players[id].x = msg.x;
            players[id].y = msg.y;
        }

        // --- PROFILE ---
        if (msg.type === "profile" && players[id]) {
            players[id].avatar         = msg.avatar        || '🧙';
            players[id].className      = msg.className     || 'HERO';
            players[id].heroName       = msg.heroName      || 'HERO';
            players[id].activeElements = msg.activeElements || ['fire'];
        }

        // --- HIT (with elemental damage + status application) ---
        if (msg.type === "hit") {
            const target = enemies.find(en => en.id === msg.enemyId);
            if (!target) return;

            const attackEl = msg.element || null;

            // 1. Check for cross-combo BEFORE applying damage
            const combo = checkCrossCombo(target, attackEl, id);

            // 2. Calculate elemental damage
            let dmg = calcElementalDamage(msg.damage || 1, attackEl, target);

            // 3. Apply combo multiplier
            if (combo) {
                dmg *= combo.dmgMult;
                broadcastCombo(combo, target.id, id, combo.statusAppliedBy);
                // Remove the triggering status
                if (target.statuses[combo.statusKey]) {
                    delete target.statuses[combo.statusKey];
                }
            }

            // 4. Apply damage
            target.hp -= dmg;

            // 5. Apply elemental status from this hit
            if (attackEl) {
                applyStatus(target, attackEl, id);
            }

            // 6. Broadcast multiplier info back to attacker (for bestiary)
            const mult = (attackEl && target.element && DAMAGE_CHART[attackEl])
                ? (DAMAGE_CHART[attackEl][target.element] ?? 1.0) : 1.0;
            ws.send(JSON.stringify({
                type: 'hitResult',
                enemyId: target.id,
                enemyElement: target.element,
                attackElement: attackEl,
                multiplier: mult,
                comboTriggered: combo ? combo.name : null,
            }));

            // 7. Remove dead enemy
            if (target.hp <= 0) {
                enemies = enemies.filter(en => en.id !== target.id);
                // Award kill XP to hitter
                const xpGain = target.type === 'boss' ? 200 :
                               target.type === 'miniboss' ? 80 : 20;
                ws.send(JSON.stringify({ type: 'killXp', amount: xpGain, enemyType: target.type }));
            }
        }

        // --- STATUS APPLICATION (skills that apply status without direct damage) ---
        if (msg.type === "applyStatus") {
            const target = enemies.find(en => en.id === msg.enemyId);
            if (target && msg.element) {
                applyStatus(target, msg.element, id, msg.stacks || 1);
            }
        }

        // --- READY ---
        if (msg.type === "playerReady") {
            if (players[id]) players[id].ready = msg.status;
            checkAllReady();
        }

        // --- POST-RUN CLASS XP ---
        if (msg.type === "runComplete") {
            // Client sends computed class XP — server records and echoes back
            console.log(`[Server] Player ${id} run complete. ClassXP earned: ${msg.classXp}`);
            ws.send(JSON.stringify({
                type: 'runResult',
                classXp: msg.classXp,
                swarmTier,
            }));
        }
    });

    ws.on("close", () => {
        delete players[id];
        if (Object.keys(players).length === 0) {
            console.log("[Server] All players left. Resetting.");
            stopSwarm();
            swarmTier = 1;
            gamePhase = 'WAVE';
            enemies = [];
            portal = null;
        }
    });
});

// ============================================================
//  READY CHECK (HUB transitions)
// ============================================================
function checkAllReady() {
    const list = Object.values(players);
    if (list.length === 0) return;
    const allReady = list.every(p => p.ready);

    if (gamePhase === 'WAVE' && portal && allReady) {
        console.log("[Server] All entered portal. HUB phase.");
        gamePhase = 'HUB';
        portal = null;
        list.forEach(p => { p.ready = false; p.x = 0; p.y = 0; });
        broadcastState();
    } else if (gamePhase === 'HUB' && allReady) {
        swarmTier++;
        console.log(`[Server] Starting swarm tier ${swarmTier}`);
        list.forEach(p => p.ready = false);
        startSwarm();
    }
}

// ============================================================
//  MAIN GAME LOOP (20 fps = 50ms)
// ============================================================
setInterval(() => {
    if (gamePhase !== 'WAVE') { broadcastState(); return; }

    // --- TICK STATUSES ---
    tickAllStatuses();

    // --- ENEMY AI ---
    enemies.forEach(en => {
        let closest = null, minDist = Infinity;
        for (const pid in players) {
            const d = Math.hypot(players[pid].x - en.x, players[pid].y - en.y);
            if (d < minDist) { minDist = d; closest = players[pid]; }
        }
        if (closest) {
            const dx = closest.x - en.x;
            const dy = closest.y - en.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 5) {
                en.x += (dx / dist) * en.speed;
                en.y += (dy / dist) * en.speed;
            }
        }
    });

    // --- BOSS DEATH = PORTAL ---
    const bossAlive = enemies.some(e => e.type === 'boss');
    if (SWARM_CONFIG.isBossTier(swarmTier) && !bossAlive && !portal) {
        portal = { x: 0, y: -350 };
        console.log("[Server] Boss killed. Portal spawned.");
        stopSwarm();
        broadcastState();
    }

    broadcastState();
}, 50);

console.log(`[Server] Spire Online running on port ${PORT}`);
