// server.js — Spire Online (Lobby Edition)
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss  = new WebSocketServer({ port: PORT });

const MAP_SIZE  = 3000;
const SAFE_ZONE = 200;

const DAMAGE_CHART = {
    fire:      { fire:1.0,water:0.5,ice:2.0,light:1.0,necrotic:1.5,dark:1.0,holy:0.5,void:1.0,wind:0.5,earth:1.0,poison:1.5,lightning:1.0 },
    water:     { fire:2.0,water:1.0,ice:0.5,light:1.0,necrotic:1.0,dark:1.0,holy:0.5,void:1.0,wind:1.5,earth:1.5,poison:0.5,lightning:0.5 },
    ice:       { fire:0.5,water:1.5,ice:1.0,light:1.0,necrotic:1.5,dark:0.5,holy:1.0,void:1.0,wind:0.5,earth:0.5,poison:1.0,lightning:1.0 },
    lightning: { fire:1.0,water:2.0,ice:1.5,light:1.5,necrotic:0.5,dark:1.0,holy:1.0,void:0.5,wind:1.5,earth:0.5,poison:1.0,lightning:1.0 },
    poison:    { fire:0.5,water:1.5,ice:1.0,light:0.5,necrotic:0.5,dark:1.5,holy:0.5,void:1.0,wind:1.0,earth:2.0,poison:1.0,lightning:1.0 },
    earth:     { fire:1.0,water:0.5,ice:0.5,light:1.0,necrotic:1.0,dark:1.0,holy:1.0,void:0.5,wind:2.0,earth:1.0,poison:0.5,lightning:2.0 },
    dark:      { fire:1.0,water:1.0,ice:1.0,light:0.5,necrotic:0.5,dark:1.0,holy:0.2,void:1.5,wind:1.0,earth:1.0,poison:1.5,lightning:1.0 },
    light:     { fire:1.0,water:1.0,ice:1.0,light:1.0,necrotic:2.0,dark:2.0,holy:0.5,void:1.5,wind:1.0,earth:1.0,poison:1.0,lightning:1.0 },
    holy:      { fire:0.5,water:1.0,ice:1.0,light:1.0,necrotic:2.0,dark:2.0,holy:1.0,void:1.5,wind:1.0,earth:1.0,poison:0.5,lightning:1.0 },
    necrotic:  { fire:0.5,water:1.0,ice:1.5,light:0.5,necrotic:1.0,dark:1.5,holy:0.2,void:2.0,wind:1.0,earth:1.0,poison:2.0,lightning:0.5 },
    void:      { fire:1.0,water:1.0,ice:1.0,light:1.5,necrotic:1.5,dark:1.5,holy:1.5,void:1.0,wind:1.0,earth:1.0,poison:1.0,lightning:1.0 },
    wind:      { fire:0.5,water:0.5,ice:1.0,light:1.0,necrotic:1.0,dark:1.0,holy:1.0,void:0.5,wind:1.0,earth:2.0,poison:1.5,lightning:0.5 },
};
const ENEMY_EL = {
    goblin:   { element:'poison',   weakTo:['fire','holy'],      resistTo:['water','dark'] },
    skeleton: { element:'necrotic', weakTo:['holy','light'],     resistTo:['poison','dark'] },
    troll:    { element:'earth',    weakTo:['lightning','water'], resistTo:['fire','earth'] },
    wraith:   { element:'dark',     weakTo:['holy','light'],     resistTo:['necrotic','void'] },
    miniboss: { element:'void',     weakTo:[],                   resistTo:[] },
    boss:     { element:'chaos',    weakTo:[],                   resistTo:[] },
};
const CROSS_COMBOS = {
    frozen:      { fire:{name:'Shatter',dmgMult:3.0},      lightning:{name:'Cryostrike',dmgMult:2.0} },
    soaked:      { lightning:{name:'Conductance',dmgMult:2.0}, ice:{name:'Flash Freeze',dmgMult:1.5} },
    burn:        { water:{name:'Steam Burst',dmgMult:1.5},  poison:{name:'Venom Flare',dmgMult:2.0} },
    shocked:     { earth:{name:'Grounded',dmgMult:2.0},    water:{name:'Electrolysis',dmgMult:1.5} },
    poisoned:    { fire:{name:'Venom Flare',dmgMult:2.5},  holy:{name:'Purge',dmgMult:2.0} },
    cursed:      { holy:{name:'Exorcism',dmgMult:4.0},     light:{name:'Revelation',dmgMult:2.5} },
    decay:       { light:{name:'Purge',dmgMult:3.0},       fire:{name:'Cremation',dmgMult:2.0} },
    nulled:      { _any:{name:'Amplified',dmgMult:2.0} },
    staggered:   { wind:{name:'Rockslide',dmgMult:2.0},    lightning:{name:'Shockwave',dmgMult:2.0} },
    illuminated: { dark:{name:'Eclipse',dmgMult:2.0},      holy:{name:'Judgement',dmgMult:3.0} },
};
const STATUS_MAP  = { fire:'burn',water:'soaked',ice:'frozen',lightning:'shocked',poison:'poisoned',earth:'staggered',dark:'cursed',light:'illuminated',holy:'seared',necrotic:'decay',void:'nulled',wind:'swept' };
const STATUS_DUR  = { burn:180,soaked:240,frozen:150,shocked:120,poisoned:300,staggered:90,cursed:240,illuminated:200,seared:180,decay:360,nulled:180,swept:120 };
const STATUS_MAX  = { burn:5,soaked:1,frozen:1,shocked:1,poisoned:8,staggered:1,cursed:5,illuminated:1,seared:3,decay:4,nulled:1,swept:1 };
const STATUS_TICKS= { burn:{interval:30,dmg:s=>s*0.5}, poisoned:{interval:40,dmg:s=>s*0.3}, seared:{interval:45,dmg:s=>s*0.8} };

// ── Lobby registry ──
const lobbies = new Map();

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join(''); }
    while (lobbies.has(code));
    return code;
}

class Lobby {
    constructor(code, isPrivate=false) {
        this.code       = code;
        this.isPrivate  = isPrivate;
        this.phase      = 'WAITING';
        this.hostId     = null;
        this.players    = {};
        this.sockets    = {};
        this.levelNum   = 1;
        this.swarmTier  = 1;
        this.enemies    = [];
        this.gems       = [];
        this.corruption = { radius:MAP_SIZE+200, speed:0.18, reversing:false, runOver:false };
        this.purgeStones= [];
        this.clusters   = [];
        this.swarmTimer = null;
        this.tierTimer  = null;
        this.initialized= false;
    }

    broadcast(obj) {
        const msg = JSON.stringify(obj);
        Object.values(this.sockets).forEach(ws=>{ if(ws.readyState===1) ws.send(msg); });
    }
    broadcastEvent(event, data={}) { this.broadcast({type:'event',event,...data}); }

    getRoster() {
        return Object.entries(this.players).map(([id,p])=>({
            id, avatar:p.avatar, className:p.className, heroName:p.heroName, isHost:id===this.hostId,
        }));
    }

    broadcastState() {
        this.broadcast({
            type:'state', players:this.players, enemies:this.enemies, gems:this.gems,
            phase:this.phase, level:this.levelNum, swarmTier:this.swarmTier,
            corruption:this.corruption, initialized:this.initialized,
            purgeStones:this.purgeStones.map(s=>({id:s.id,x:s.x,y:s.y,activated:s.activated,progress:s.progress})),
            clusters:this.clusters.map(c=>({id:c.id,x:c.x,y:c.y,radius:c.radius,cleared:c.cleared,corruptionPushRadius:c.corruptionPushRadius})),
        });
    }

    initLevel(level) {
        const rng = seededRng(level*9973+1337);
        this.levelNum=level; this.phase='WAVE'; this.enemies=[]; this.gems=[]; this.initialized=false;
        this.corruption={ radius:MAP_SIZE+200, speed:0.15+level*0.02, reversing:false, runOver:false };

        const angles=[0,(Math.PI*2)/3,(Math.PI*4)/3];
        this.purgeStones=angles.map((angle,idx)=>{
            const dist=MAP_SIZE*0.55+rng()*MAP_SIZE*0.15, jitter=(rng()-0.5)*0.4;
            return { id:`stone_${idx}`, x:Math.cos(angle+jitter)*dist, y:Math.sin(angle+jitter)*dist, activated:false, progress:0, channelTime:300 };
        });

        this.clusters=spreadPoints(12,MAP_SIZE-300,SAFE_ZONE+200,rng).map((pos,idx)=>{
            const types=['goblin','skeleton','troll','wraith'];
            return { id:`cluster_${idx}`, x:pos.x, y:pos.y, radius:200+rng()*100, primaryType:types[Math.floor(rng()*types.length)], cleared:false, corruptionPushRadius:350+rng()*150, enemyCount:6+Math.floor(rng()*8), spawned:false };
        });

        this._spawnSwarmBurst(this.swarmTier);
        this.initialized=true;
        this.startSwarm();

        console.log(`[${this.code}] Level ${level} ready. Enemies:${this.enemies.length}`);
        this.broadcast({ type:'gameStart', level, code:this.code });
        this.broadcastState();
    }

    _spawnEnemy(type, x, y, clusterId=null) {
        const cfgs={ goblin:{emoji:'👺',hp:3,speed:1.8,radius:15}, skeleton:{emoji:'💀',hp:2,speed:1.0,radius:15}, troll:{emoji:'👾',hp:6,speed:1.2,radius:20}, wraith:{emoji:'👻',hp:4,speed:2.2,radius:15}, miniboss:{emoji:'🐲',hp:30,speed:1.0,radius:25}, boss:{emoji:'👹',hp:80,speed:0.7,radius:35} };
        const cfg=cfgs[type]||cfgs.goblin, el=ENEMY_EL[type]||{element:'earth',weakTo:[],resistTo:[]};
        const scale=1+this.swarmTier*0.15;
        this.enemies.push({ id:Math.random().toString(36).slice(2), type, x, y, emoji:cfg.emoji, hp:cfg.hp*scale, maxHp:cfg.hp*scale, speed:cfg.speed*(1+this.swarmTier*0.02), radius:cfg.radius, element:el.element, weakTo:el.weakTo, resistTo:el.resistTo, statuses:{}, clusterId, lastShot:0 });
    }

    _spawnSwarmBurst(tier) {
        const pool=enemyPool(tier), count=Math.min(4+tier*2,20);
        for (let i=0;i<count;i++) {
            const angle=Math.random()*Math.PI*2, dist=Math.min(this.corruption.radius*0.85+Math.random()*200,MAP_SIZE-50);
            this._spawnEnemy(pool[Math.floor(Math.random()*pool.length)], Math.cos(angle)*dist, Math.sin(angle)*dist);
        }
    }

    _spawnClusterEnemies(cl) {
        for (let i=0;i<cl.enemyCount;i++) {
            const a=Math.random()*Math.PI*2, d=40+Math.random()*cl.radius*0.7;
            this._spawnEnemy(i===0?cl.primaryType:randomType(cl.primaryType), cl.x+Math.cos(a)*d, cl.y+Math.sin(a)*d, cl.id);
        }
        cl.spawned=true;
    }

    startSwarm() {
        this.stopSwarm();
        const iv=()=>Math.max(4000,10000-this.swarmTier*400);
        this.swarmTimer=setInterval(()=>{ if(this.phase==='WAVE') this._spawnSwarmBurst(this.swarmTier); }, iv());
        this.tierTimer=setInterval(()=>{
            this.swarmTier++;
            this.broadcastEvent('tierUp',{tier:this.swarmTier});
            if (this.swarmTier%10===0) { const a=Math.random()*Math.PI*2; this._spawnEnemy('boss',Math.cos(a)*300,Math.sin(a)*300); this.broadcastEvent('bossIncoming',{tier:this.swarmTier}); }
            else if (this.swarmTier%5===0) { const a=Math.random()*Math.PI*2; this._spawnEnemy('miniboss',Math.cos(a)*500,Math.sin(a)*500); this.broadcastEvent('miniBossIncoming',{}); }
            clearInterval(this.swarmTimer);
            this.swarmTimer=setInterval(()=>{ if(this.phase==='WAVE') this._spawnSwarmBurst(this.swarmTier); }, iv());
        }, 45000);
    }

    stopSwarm() {
        if (this.swarmTimer) { clearInterval(this.swarmTimer); this.swarmTimer=null; }
        if (this.tierTimer)  { clearInterval(this.tierTimer);  this.tierTimer=null; }
    }

    tick() {
        if (this.phase!=='WAVE') return;
        this._tickStatuses();
        this._tickCorruption();
        this._tickPurgeStones();
        this._checkClusters();
        for (let i=this.gems.length-1;i>=0;i--) {
            this.gems[i].lifetime--; this.gems[i].pulse=(this.gems[i].pulse||0)+0.08;
            if (this.gems[i].lifetime<=0) this.gems.splice(i,1);
        }
        this.enemies.forEach(en=>{
            let closest=null, minD=Infinity;
            for (const p of Object.values(this.players)) { const d=Math.hypot(p.x-en.x,p.y-en.y); if(d<minD){minD=d;closest=p;} }
            if (!closest) return;
            const dx=closest.x-en.x, dy=closest.y-en.y, d=Math.hypot(dx,dy);
            if (d>5) { en.x+=(dx/d)*en.speed; en.y+=(dy/d)*en.speed; }
        });
        this.broadcastState();
    }

    _tickCorruption() {
        if (this.corruption.runOver) return;
        if (this.corruption.reversing) { this.corruption.radius=Math.min(MAP_SIZE+400,this.corruption.radius+0.4); return; }
        this.corruption.radius-=this.corruption.speed;
        if (this.corruption.radius<=80) { this.corruption.runOver=true; this.broadcastEvent('runOver',{}); }
    }

    _tickPurgeStones() {
        this.purgeStones.forEach(stone=>{
            if (stone.activated) return;
            const near=Object.values(this.players).filter(p=>Math.hypot(p.x-stone.x,p.y-stone.y)<80).length;
            if (near>0) {
                stone.progress+=1/stone.channelTime;
                if (stone.progress>=1) {
                    stone.progress=1; stone.activated=true;
                    this.broadcastEvent('stoneActivated',{stoneId:stone.id});
                    if (this.purgeStones.every(s=>s.activated)) {
                        this.corruption.reversing=true;
                        this.broadcastEvent('allStonesActivated',{});
                        setTimeout(()=>{ const a=Math.random()*Math.PI*2; this._spawnEnemy('boss',Math.cos(a)*200,Math.sin(a)*200); this.broadcastEvent('finalBossSpawned',{}); }, 3000);
                    }
                }
            } else { stone.progress=Math.max(0,stone.progress-1/(stone.channelTime*0.5)); }
        });
    }

    _checkClusters() {
        this.clusters.forEach(cl=>{
            if (cl.cleared) return;
            if (!cl.spawned && Object.values(this.players).some(p=>Math.hypot(p.x-cl.x,p.y-cl.y)<cl.radius+400)) this._spawnClusterEnemies(cl);
            if (cl.spawned && this.enemies.filter(e=>e.clusterId===cl.id).length===0) {
                cl.cleared=true;
                this.corruption.radius+=cl.corruptionPushRadius*0.003;
                this.broadcastEvent('clusterCleared',{clusterId:cl.id,x:cl.x,y:cl.y});
            }
        });
    }

    _tickStatuses() {
        this.enemies.forEach(en=>{
            if (!en.statuses) return;
            for (const [key,s] of Object.entries(en.statuses)) {
                if (!s||s.stacks<=0) continue;
                s.duration--;
                if (s.duration<=0) { delete en.statuses[key]; continue; }
                const td=STATUS_TICKS[key];
                if (td) { s.tickTimer=(s.tickTimer||0)+1; if(s.tickTimer>=td.interval){s.tickTimer=0;en.hp-=td.dmg(s.stacks);if(en.hp<=0){this._onEnemyDied(en);this.enemies=this.enemies.filter(e=>e.id!==en.id);}}}
                if (key==='frozen'&&!en._frozenApplied) { en._frozenApplied=true; en._baseSpeed=en.speed; en.speed*=0.15; }
            }
            if (!en.statuses.frozen&&en._frozenApplied) { en._frozenApplied=false; if(en._baseSpeed){en.speed=en._baseSpeed;delete en._baseSpeed;} }
        });
    }

    _onEnemyDied(en) {
        this._spawnGems(en.x,en.y,en.type);
        if (en.type==='boss'&&this.purgeStones.every(s=>s.activated)) this._levelClear();
        else if (en.type==='boss') this.broadcastEvent('bossKilled',{});
    }

    _spawnGems(x,y,type) {
        const vals={goblin:3,skeleton:4,troll:6,wraith:5,miniboss:30,boss:100}, val=vals[type]||3;
        const count=type==='boss'?5:type==='miniboss'?3:1;
        for (let i=0;i<count;i++) {
            const a=Math.random()*Math.PI*2, sp=Math.random()*40;
            this.gems.push({ id:Math.random().toString(36).slice(2), x:x+Math.cos(a)*sp, y:y+Math.sin(a)*sp, value:Math.ceil(val/count), lifetime:600, color:val>=50?'#ff88ff':val>=20?'#ffcc00':val>=8?'#00ccff':'#44ff88', radius:val>=20?14:val>=8?10:7, pulse:Math.random()*Math.PI*2 });
        }
    }

    _levelClear() {
        this.phase='LEVEL_CLEAR'; this.stopSwarm();
        this.broadcastEvent('levelClear',{level:this.levelNum});
    }

    handleHit(playerId, msg, ws) {
        const t=this.enemies.find(e=>e.id===msg.enemyId); if(!t) return;
        const el=msg.element||null, combo=this._checkCrossCombo(t,el,playerId);
        let dmg=this._calcDmg(msg.damage||1,el,t);
        if (combo) { dmg*=combo.dmgMult; this.broadcast({type:'crossCombo',comboName:combo.name,color:combo.color||'#fff',enemyId:t.id,triggeredBy:playerId,statusAppliedBy:combo.statusAppliedBy,dmgMult:combo.dmgMult}); delete t.statuses[combo.statusKey]; }
        t.hp-=dmg;
        if (el) this._applyStatus(t,el,playerId);
        const mult=(el&&t.element&&DAMAGE_CHART[el])?(DAMAGE_CHART[el][t.element]??1.0):1.0;
        ws.send(JSON.stringify({type:'hitResult',enemyId:t.id,enemyElement:t.element,attackElement:el,multiplier:mult,comboTriggered:combo?combo.name:null,enemyType:t.type}));
        if (t.hp<=0) { this._onEnemyDied(t); this.enemies=this.enemies.filter(e=>e.id!==t.id); ws.send(JSON.stringify({type:'killXp',amount:t.type==='boss'?200:t.type==='miniboss'?80:20,enemyType:t.type})); }
    }

    _calcDmg(base,el,enemy) {
        let dmg=base;
        if (el&&enemy.element&&DAMAGE_CHART[el]) dmg*=DAMAGE_CHART[el][enemy.element]??1.0;
        if (enemy.statuses?.nulled?.stacks>0){const raw=DAMAGE_CHART[el]?.[enemy.element]??1.0;if(raw<1.0)dmg=base;}
        if (enemy.statuses?.soaked?.stacks>0){dmg*=1.5;enemy.statuses.soaked.stacks=0;}
        if (enemy.statuses?.cursed?.stacks>0) dmg*=1+enemy.statuses.cursed.stacks*0.15;
        return Math.round(dmg*10)/10;
    }

    _applyStatus(enemy,el,pid,stacks=1) {
        const key=STATUS_MAP[el]; if(!key) return;
        if (!enemy.statuses[key]) enemy.statuses[key]={stacks:0,duration:0,tickTimer:0,element:el,appliedBy:pid};
        const s=enemy.statuses[key];
        s.stacks=Math.min(s.stacks+stacks,STATUS_MAX[key]||1);
        s.duration=Math.max(s.duration,STATUS_DUR[key]||120);
        s.appliedBy=pid;
    }

    _checkCrossCombo(enemy,el,pid) {
        if (!enemy.statuses) return null;
        for (const [sk,sd] of Object.entries(enemy.statuses)) {
            if (!sd||sd.stacks<=0||sd.appliedBy===pid) continue;
            const table=CROSS_COMBOS[sk]; if(!table) continue;
            const combo=table[el]||table['_any'];
            if (combo) return {...combo,statusKey:sk,attackElement:el,triggeredBy:pid,statusAppliedBy:sd.appliedBy};
        }
        return null;
    }

    destroy() { this.stopSwarm(); lobbies.delete(this.code); console.log(`[${this.code}] Destroyed.`); }
}

// ── Helpers ──
function seededRng(seed){let s=seed;return()=>{s=(s*1664525+1013904223)&0xffffffff;return(s>>>0)/0xffffffff;};}
function spreadPoints(count,maxDist,minDist,rng){const pts=[];let a=0;while(pts.length<count&&a++<count*20){const angle=rng()*Math.PI*2,dist=minDist+rng()*(maxDist-minDist),x=Math.cos(angle)*dist,y=Math.sin(angle)*dist;if(!pts.some(p=>Math.hypot(p.x-x,p.y-y)<350))pts.push({x,y});}return pts;}
function enemyPool(t){const p=['goblin'];if(t>=2)p.push('skeleton');if(t>=4)p.push('wraith');if(t>=6)p.push('troll');return p;}
function randomType(pref){return Math.random()<0.6?pref:['goblin','skeleton','troll','wraith'][Math.floor(Math.random()*4)];}

// ── Connection handler ──
wss.on('connection',(ws)=>{
    let playerId=null, lobbyCode=null;

    ws.on('message',(raw)=>{
        let msg; try{msg=JSON.parse(raw);}catch{return;}

        if (msg.type==='createLobby') {
            const code=generateCode(), lobby=new Lobby(code,msg.private||false);
            lobbies.set(code,lobby);
            playerId=Math.random().toString(36).slice(2); lobbyCode=code; lobby.hostId=playerId;
            lobby.players[playerId]={x:0,y:0,hp:10,avatar:msg.avatar||'🧙',className:msg.className||'HERO',heroName:msg.heroName||'HERO',activeElements:msg.activeElements||['fire'],ready:false};
            lobby.sockets[playerId]=ws;
            console.log(`[${code}] Created by ${playerId}`);
            ws.send(JSON.stringify({type:'welcome',id:playerId,lobbyCode:code,isHost:true,roster:lobby.getRoster()}));
            return;
        }

        if (msg.type==='joinLobby') {
            const code=(msg.code||'').toUpperCase().trim(), lobby=lobbies.get(code);
            if (!lobby) { ws.send(JSON.stringify({type:'error',message:'Lobby not found.'})); return; }
            if (lobby.phase!=='WAITING') { ws.send(JSON.stringify({type:'error',message:'Game already started.'})); return; }
            playerId=Math.random().toString(36).slice(2); lobbyCode=code;
            lobby.players[playerId]={x:0,y:0,hp:10,avatar:msg.avatar||'🧙',className:msg.className||'HERO',heroName:msg.heroName||'HERO',activeElements:msg.activeElements||['fire'],ready:false};
            lobby.sockets[playerId]=ws;
            console.log(`[${code}] ${playerId} joined. Total:${Object.keys(lobby.players).length}`);
            ws.send(JSON.stringify({type:'welcome',id:playerId,lobbyCode:code,isHost:false,roster:lobby.getRoster()}));
            lobby.broadcast({type:'rosterUpdate',roster:lobby.getRoster()});
            return;
        }

        if (msg.type==='quickJoin') {
            let target=null;
            for (const [,l] of lobbies) { if(!l.isPrivate&&l.phase==='WAITING'){target=l;break;} }
            if (!target) { const code=generateCode(); target=new Lobby(code,false); lobbies.set(code,target); }
            playerId=Math.random().toString(36).slice(2); lobbyCode=target.code;
            if (!target.hostId) target.hostId=playerId;
            target.players[playerId]={x:0,y:0,hp:10,avatar:msg.avatar||'🧙',className:msg.className||'HERO',heroName:msg.heroName||'HERO',activeElements:msg.activeElements||['fire'],ready:false};
            target.sockets[playerId]=ws;
            console.log(`[${target.code}] ${playerId} quick-joined. Host:${target.hostId===playerId}`);
            ws.send(JSON.stringify({type:'welcome',id:playerId,lobbyCode:target.code,isHost:target.hostId===playerId,roster:target.getRoster()}));
            target.broadcast({type:'rosterUpdate',roster:target.getRoster()});
            return;
        }

        const lobby=lobbyCode?lobbies.get(lobbyCode):null;
        if (!lobby||!playerId) return;

        if (msg.type==='startGame'&&playerId===lobby.hostId&&lobby.phase==='WAITING') {
            lobby.phase='LOADING';
            lobby.broadcast({type:'loading'});
            setTimeout(()=>lobby.initLevel(1), 300);
            return;
        }
        if (msg.type==='profile'&&lobby.players[playerId]) {
            const p=lobby.players[playerId];
            p.avatar=msg.avatar||'🧙'; p.className=msg.className||'HERO'; p.heroName=msg.heroName||'HERO'; p.activeElements=msg.activeElements||['fire'];
            lobby.broadcast({type:'rosterUpdate',roster:lobby.getRoster()});
        }
        if (msg.type==='move'&&lobby.players[playerId]) { lobby.players[playerId].x=msg.x; lobby.players[playerId].y=msg.y; }
        if (msg.type==='hit') lobby.handleHit(playerId,msg,ws);
        if (msg.type==='applyStatus') { const t=lobby.enemies.find(e=>e.id===msg.enemyId); if(t&&msg.element) lobby._applyStatus(t,msg.element,playerId,msg.stacks||1); }
        if (msg.type==='collectGem') { const g=lobby.gems.find(g=>g.id===msg.gemId); if(g){lobby.gems=lobby.gems.filter(x=>x.id!==msg.gemId);ws.send(JSON.stringify({type:'gemCollected',gemId:msg.gemId,value:g.value}));} }
        if (msg.type==='playerReady'&&lobby.players[playerId]) {
            lobby.players[playerId].ready=msg.status;
            if (Object.values(lobby.players).every(p=>p.ready)&&lobby.phase==='LEVEL_CLEAR') {
                Object.values(lobby.players).forEach(p=>{p.ready=false;p.x=0;p.y=0;});
                lobby.swarmTier=Math.max(1,lobby.swarmTier-2);
                setTimeout(()=>lobby.initLevel(lobby.levelNum+1),300);
            }
        }
        if (msg.type==='runComplete') ws.send(JSON.stringify({type:'runResult',classXp:msg.classXp,swarmTier:lobby.swarmTier}));
    });

    ws.on('close',()=>{
        if (!lobbyCode||!playerId) return;
        const lobby=lobbies.get(lobbyCode); if(!lobby) return;
        delete lobby.players[playerId]; delete lobby.sockets[playerId];
        console.log(`[${lobbyCode}] ${playerId} left. Remaining:${Object.keys(lobby.players).length}`);
        if (Object.keys(lobby.players).length===0) { lobby.destroy(); return; }
        if (lobby.hostId===playerId) {
            lobby.hostId=Object.keys(lobby.players)[0];
            lobby.sockets[lobby.hostId]?.send(JSON.stringify({type:'hostTransferred'}));
        }
        lobby.broadcast({type:'rosterUpdate',roster:lobby.getRoster()});
    });
});

// ── Global tick ──
setInterval(()=>{ for(const[,lobby]of lobbies) if(lobby.phase==='WAVE') lobby.tick(); }, 50);

console.log(`[Server] Spire Online (Lobby Edition) on port ${PORT}`);
