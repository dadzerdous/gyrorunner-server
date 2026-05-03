// server.js — Spire Online
import { WebSocketServer } from "ws";
const PORT = process.env.PORT || 3000;
const wss  = new WebSocketServer({ port: PORT });
const MAP_SIZE=3000, SAFE_ZONE=200;
const DAMAGE_CHART={fire:{fire:1.0,water:0.5,ice:2.0,light:1.0,necrotic:1.5,dark:1.0,holy:0.5,void:1.0,wind:0.5,earth:1.0,poison:1.5,lightning:1.0},water:{fire:2.0,water:1.0,ice:0.5,light:1.0,necrotic:1.0,dark:1.0,holy:0.5,void:1.0,wind:1.5,earth:1.5,poison:0.5,lightning:0.5},ice:{fire:0.5,water:1.5,ice:1.0,light:1.0,necrotic:1.5,dark:0.5,holy:1.0,void:1.0,wind:0.5,earth:0.5,poison:1.0,lightning:1.0},lightning:{fire:1.0,water:2.0,ice:1.5,light:1.5,necrotic:0.5,dark:1.0,holy:1.0,void:0.5,wind:1.5,earth:0.5,poison:1.0,lightning:1.0},poison:{fire:0.5,water:1.5,ice:1.0,light:0.5,necrotic:0.5,dark:1.5,holy:0.5,void:1.0,wind:1.0,earth:2.0,poison:1.0,lightning:1.0},earth:{fire:1.0,water:0.5,ice:0.5,light:1.0,necrotic:1.0,dark:1.0,holy:1.0,void:0.5,wind:2.0,earth:1.0,poison:0.5,lightning:2.0},dark:{fire:1.0,water:1.0,ice:1.0,light:0.5,necrotic:0.5,dark:1.0,holy:0.2,void:1.5,wind:1.0,earth:1.0,poison:1.5,lightning:1.0},light:{fire:1.0,water:1.0,ice:1.0,light:1.0,necrotic:2.0,dark:2.0,holy:0.5,void:1.5,wind:1.0,earth:1.0,poison:1.0,lightning:1.0},holy:{fire:0.5,water:1.0,ice:1.0,light:1.0,necrotic:2.0,dark:2.0,holy:1.0,void:1.5,wind:1.0,earth:1.0,poison:0.5,lightning:1.0},necrotic:{fire:0.5,water:1.0,ice:1.5,light:0.5,necrotic:1.0,dark:1.5,holy:0.2,void:2.0,wind:1.0,earth:1.0,poison:2.0,lightning:0.5},void:{fire:1.0,water:1.0,ice:1.0,light:1.5,necrotic:1.5,dark:1.5,holy:1.5,void:1.0,wind:1.0,earth:1.0,poison:1.0,lightning:1.0},wind:{fire:0.5,water:0.5,ice:1.0,light:1.0,necrotic:1.0,dark:1.0,holy:1.0,void:0.5,wind:1.0,earth:2.0,poison:1.5,lightning:0.5}};
const ENEMY_EL={goblin:{element:'poison',weakTo:['fire','holy'],resistTo:['water','dark']},skeleton:{element:'necrotic',weakTo:['holy','light'],resistTo:['poison','dark']},troll:{element:'earth',weakTo:['lightning','water'],resistTo:['fire','earth']},wraith:{element:'dark',weakTo:['holy','light'],resistTo:['necrotic','void']},miniboss:{element:'void',weakTo:[],resistTo:[]},boss:{element:'chaos',weakTo:[],resistTo:[]}};
const CROSS_COMBOS={frozen:{fire:{name:'Shatter',dmgMult:3.0},lightning:{name:'Cryostrike',dmgMult:2.0}},soaked:{lightning:{name:'Conductance',dmgMult:2.0},ice:{name:'Flash Freeze',dmgMult:1.5}},burn:{water:{name:'Steam Burst',dmgMult:1.5},poison:{name:'Venom Flare',dmgMult:2.0}},shocked:{earth:{name:'Grounded',dmgMult:2.0},water:{name:'Electrolysis',dmgMult:1.5}},poisoned:{fire:{name:'Venom Flare',dmgMult:2.5},holy:{name:'Purge',dmgMult:2.0}},cursed:{holy:{name:'Exorcism',dmgMult:4.0},light:{name:'Revelation',dmgMult:2.5}},decay:{light:{name:'Purge',dmgMult:3.0},fire:{name:'Cremation',dmgMult:2.0}},nulled:{_any:{name:'Amplified',dmgMult:2.0}},staggered:{wind:{name:'Rockslide',dmgMult:2.0},lightning:{name:'Shockwave',dmgMult:2.0}},illuminated:{dark:{name:'Eclipse',dmgMult:2.0},holy:{name:'Judgement',dmgMult:3.0}}};
const STATUS_MAP={fire:'burn',water:'soaked',ice:'frozen',lightning:'shocked',poison:'poisoned',earth:'staggered',dark:'cursed',light:'illuminated',holy:'seared',necrotic:'decay',void:'nulled',wind:'swept'};
const STATUS_DUR={burn:180,soaked:240,frozen:150,shocked:120,poisoned:300,staggered:90,cursed:240,illuminated:200,seared:180,decay:360,nulled:180,swept:120};
const STATUS_MAX={burn:5,soaked:1,frozen:1,shocked:1,poisoned:8,staggered:1,cursed:5,illuminated:1,seared:3,decay:4,nulled:1,swept:1};
const STATUS_TICKS={burn:{interval:30,dmg:(s)=>s*0.5},poisoned:{interval:40,dmg:(s)=>s*0.3},seared:{interval:45,dmg:(s)=>s*0.8}};

let players={}, enemies=[], gems=[], gamePhase='WAVE', levelNum=1;
let corruption={radius:MAP_SIZE+200,speed:0.18,reversing:false,runOver:false};
let purgeStones=[], enemyClusters=[], swarmTier=1, swarmTimer=null, tierTimer=null;

function seededRng(seed){let s=seed;return()=>{s=(s*1664525+1013904223)&0xffffffff;return(s>>>0)/0xffffffff;};}

function initLevel(level){
    const rng=seededRng(level*9973+1337);
    levelNum=level; gamePhase='WAVE'; enemies=[]; gems=[];
    corruption={radius:MAP_SIZE+200,speed:0.15+level*0.02,reversing:false,runOver:false};
    const stoneAngles=[0,(Math.PI*2)/3,(Math.PI*4)/3];
    purgeStones=stoneAngles.map((angle,idx)=>{
        const dist=MAP_SIZE*0.55+rng()*MAP_SIZE*0.15;
        const jitter=(rng()-0.5)*0.4;
        return{id:`stone_${idx}`,x:Math.cos(angle+jitter)*dist,y:Math.sin(angle+jitter)*dist,activated:false,progress:0,channelTime:300};
    });
    enemyClusters=spreadPoints(12,MAP_SIZE-300,SAFE_ZONE+200,rng).map((pos,idx)=>{
        const types=['goblin','skeleton','troll','wraith'];
        return{id:`cluster_${idx}`,x:pos.x,y:pos.y,radius:200+rng()*100,primaryType:types[Math.floor(rng()*types.length)],cleared:false,corruptionPushRadius:350+rng()*150,enemyCount:6+Math.floor(rng()*8),spawned:false};
    });
    spawnSwarmBurst(swarmTier);
    startSwarm();
    console.log(`[Server] Level ${level} init. Stones:${purgeStones.length} Clusters:${enemyClusters.length}`);
    broadcastState();
}

function spawnEnemy(type,x,y,clusterId=null){
    const cfgs={goblin:{emoji:'👺',hp:3,speed:1.8,radius:15},skeleton:{emoji:'💀',hp:2,speed:1.0,radius:15},troll:{emoji:'👾',hp:6,speed:1.2,radius:20},wraith:{emoji:'👻',hp:4,speed:2.2,radius:15},miniboss:{emoji:'🐲',hp:30,speed:1.0,radius:25},boss:{emoji:'👹',hp:80,speed:0.7,radius:35}};
    const cfg=cfgs[type]||cfgs.goblin;
    const el=ENEMY_EL[type]||{element:'earth',weakTo:[],resistTo:[]};
    const scale=1+swarmTier*0.15;
    enemies.push({id:Math.random().toString(36).slice(2),type,x,y,emoji:cfg.emoji,hp:cfg.hp*scale,maxHp:cfg.hp*scale,speed:cfg.speed*(1+swarmTier*0.02),radius:cfg.radius,element:el.element,weakTo:el.weakTo,resistTo:el.resistTo,statuses:{},clusterId,lastShot:0});
}

function spawnSwarmBurst(tier){
    const pool=enemyPool(tier);
    const count=Math.min(4+tier*2,20);
    for(let i=0;i<count;i++){
        const angle=Math.random()*Math.PI*2;
        const dist=Math.min(corruption.radius*0.85+Math.random()*200,MAP_SIZE-50);
        spawnEnemy(pool[Math.floor(Math.random()*pool.length)],Math.cos(angle)*dist,Math.sin(angle)*dist);
    }
}

function spawnClusterEnemies(cluster){
    for(let i=0;i<cluster.enemyCount;i++){
        const angle=Math.random()*Math.PI*2;
        const dist=40+Math.random()*cluster.radius*0.7;
        const type=i===0?cluster.primaryType:randomType(cluster.primaryType);
        spawnEnemy(type,cluster.x+Math.cos(angle)*dist,cluster.y+Math.sin(angle)*dist,cluster.id);
    }
    cluster.spawned=true;
}

function enemyPool(tier){const p=['goblin'];if(tier>=2)p.push('skeleton');if(tier>=4)p.push('wraith');if(tier>=6)p.push('troll');return p;}
function randomType(pref){return Math.random()<0.6?pref:['goblin','skeleton','troll','wraith'][Math.floor(Math.random()*4)];}

function startSwarm(){
    stopSwarm();
    const interval=()=>Math.max(4000,10000-swarmTier*400);
    swarmTimer=setInterval(()=>{if(gamePhase==='WAVE')spawnSwarmBurst(swarmTier);},interval());
    tierTimer=setInterval(()=>{
        swarmTier++;
        console.log(`[Server] Tier ${swarmTier}`);
        broadcastEvent('tierUp',{tier:swarmTier});
        if(swarmTier%10===0){const a=Math.random()*Math.PI*2;spawnEnemy('boss',Math.cos(a)*300,Math.sin(a)*300);broadcastEvent('bossIncoming',{tier:swarmTier});}
        else if(swarmTier%5===0){const a=Math.random()*Math.PI*2;spawnEnemy('miniboss',Math.cos(a)*500,Math.sin(a)*500);broadcastEvent('miniBossIncoming',{});}
        clearInterval(swarmTimer);
        swarmTimer=setInterval(()=>{if(gamePhase==='WAVE')spawnSwarmBurst(swarmTier);},interval());
    },45000);
}
function stopSwarm(){if(swarmTimer){clearInterval(swarmTimer);swarmTimer=null;}if(tierTimer){clearInterval(tierTimer);tierTimer=null;}}

function tickCorruption(){
    if(corruption.runOver)return;
    if(corruption.reversing){corruption.radius=Math.min(MAP_SIZE+400,corruption.radius+0.4);return;}
    corruption.radius-=corruption.speed;
    if(corruption.radius<=80){corruption.runOver=true;broadcastEvent('runOver',{});console.log('[Server] Run over.');}
}

function tickPurgeStones(){
    if(gamePhase!=='WAVE')return;
    purgeStones.forEach(stone=>{
        if(stone.activated)return;
        const near=Object.values(players).filter(p=>Math.hypot(p.x-stone.x,p.y-stone.y)<80).length;
        if(near>0){
            stone.progress+=1/stone.channelTime;
            if(stone.progress>=1){
                stone.progress=1;stone.activated=true;
                console.log(`[Server] Stone ${stone.id} activated!`);
                broadcastEvent('stoneActivated',{stoneId:stone.id});
                if(purgeStones.every(s=>s.activated)){
                    corruption.reversing=true;
                    broadcastEvent('allStonesActivated',{});
                    setTimeout(()=>{const a=Math.random()*Math.PI*2;spawnEnemy('boss',Math.cos(a)*200,Math.sin(a)*200);broadcastEvent('finalBossSpawned',{});},3000);
                }
            }
        } else {
            stone.progress=Math.max(0,stone.progress-1/(stone.channelTime*0.5));
        }
    });
}

function checkClusters(){
    enemyClusters.forEach(cl=>{
        if(cl.cleared)return;
        if(!cl.spawned){
            if(Object.values(players).some(p=>Math.hypot(p.x-cl.x,p.y-cl.y)<cl.radius+400))spawnClusterEnemies(cl);
        }
        if(cl.spawned&&enemies.filter(e=>e.clusterId===cl.id).length===0){
            cl.cleared=true;
            corruption.radius+=cl.corruptionPushRadius*0.003;
            broadcastEvent('clusterCleared',{clusterId:cl.id,x:cl.x,y:cl.y});
        }
    });
}

function spawnGems(x,y,type){
    const vals={goblin:3,skeleton:4,troll:6,wraith:5,miniboss:30,boss:100};
    const val=vals[type]||3;
    const count=type==='boss'?5:type==='miniboss'?3:1;
    for(let i=0;i<count;i++){
        const a=Math.random()*Math.PI*2,sp=Math.random()*40;
        gems.push({id:Math.random().toString(36).slice(2),x:x+Math.cos(a)*sp,y:y+Math.sin(a)*sp,value:Math.ceil(val/count),lifetime:600,color:val>=50?'#ff88ff':val>=20?'#ffcc00':val>=8?'#00ccff':'#44ff88',radius:val>=20?14:val>=8?10:7,pulse:Math.random()*Math.PI*2});
    }
}

function calcDmg(base,el,enemy){
    let dmg=base;
    if(el&&enemy.element&&DAMAGE_CHART[el])dmg*=DAMAGE_CHART[el][enemy.element]??1.0;
    if(enemy.statuses?.nulled?.stacks>0){const raw=DAMAGE_CHART[el]?.[enemy.element]??1.0;if(raw<1.0)dmg=base;}
    if(enemy.statuses?.soaked?.stacks>0){dmg*=1.5;enemy.statuses.soaked.stacks=0;}
    if(enemy.statuses?.cursed?.stacks>0)dmg*=1+enemy.statuses.cursed.stacks*0.15;
    return Math.round(dmg*10)/10;
}
function applyStatus(enemy,el,pid,stacks=1){
    const key=STATUS_MAP[el];if(!key)return;
    if(!enemy.statuses[key])enemy.statuses[key]={stacks:0,duration:0,tickTimer:0,element:el,appliedBy:pid};
    const s=enemy.statuses[key];
    s.stacks=Math.min(s.stacks+stacks,STATUS_MAX[key]||1);
    s.duration=Math.max(s.duration,STATUS_DUR[key]||120);
    s.appliedBy=pid;
}
function checkCrossCombo(enemy,el,pid){
    if(!enemy.statuses)return null;
    for(const[sk,sd]of Object.entries(enemy.statuses)){
        if(!sd||sd.stacks<=0||sd.appliedBy===pid)continue;
        const table=CROSS_COMBOS[sk];if(!table)continue;
        const combo=table[el]||table['_any'];
        if(combo)return{...combo,statusKey:sk,attackElement:el,triggeredBy:pid,statusAppliedBy:sd.appliedBy};
    }
    return null;
}
function tickStatuses(){
    enemies.forEach(en=>{
        if(!en.statuses)return;
        for(const[key,s]of Object.entries(en.statuses)){
            if(!s||s.stacks<=0)continue;
            s.duration--;
            if(s.duration<=0){delete en.statuses[key];continue;}
            const td=STATUS_TICKS[key];
            if(td){s.tickTimer=(s.tickTimer||0)+1;if(s.tickTimer>=td.interval){s.tickTimer=0;en.hp-=td.dmg(s.stacks);if(en.hp<=0){spawnGems(en.x,en.y,en.type);enemies=enemies.filter(e=>e.id!==en.id);}}}
            if(key==='frozen'&&!en._frozenApplied){en._frozenApplied=true;en._baseSpeed=en.speed;en.speed*=0.15;}
        }
        if(!en.statuses.frozen&&en._frozenApplied){en._frozenApplied=false;if(en._baseSpeed){en.speed=en._baseSpeed;delete en._baseSpeed;}}
    });
}

function broadcastState(){
    const snap=JSON.stringify({type:'state',players,enemies,gems,phase:gamePhase,level:levelNum,swarmTier,corruption,purgeStones:purgeStones.map(s=>({id:s.id,x:s.x,y:s.y,activated:s.activated,progress:s.progress})),clusters:enemyClusters.map(c=>({id:c.id,x:c.x,y:c.y,radius:c.radius,cleared:c.cleared,corruptionPushRadius:c.corruptionPushRadius}))});
    wss.clients.forEach(c=>{if(c.readyState===1)c.send(snap);});
}
function broadcastEvent(event,data={}){const msg=JSON.stringify({type:'event',event,...data});wss.clients.forEach(c=>{if(c.readyState===1)c.send(msg);});}
function broadcastCombo(combo,enemyId,triggeredBy,statusAppliedBy){wss.clients.forEach(c=>{if(c.readyState===1)c.send(JSON.stringify({type:'crossCombo',comboName:combo.name,color:combo.color||'#fff',enemyId,triggeredBy,statusAppliedBy,dmgMult:combo.dmgMult}));});}

wss.on('connection',(ws)=>{
    const id=Math.random().toString(36).slice(2);
    players[id]={x:0,y:0,hp:10,ready:false,avatar:'❓',className:'',heroName:'',activeElements:['fire']};
    console.log(`[Server] ${id} connected`);
    ws.send(JSON.stringify({type:'welcome',id}));
    if(Object.keys(players).length===1){swarmTier=1;initLevel(1);}
    else ws.send(JSON.stringify({type:'state',players,enemies,gems,phase:gamePhase,level:levelNum,swarmTier,corruption,purgeStones:purgeStones.map(s=>({id:s.id,x:s.x,y:s.y,activated:s.activated,progress:s.progress})),clusters:enemyClusters.map(c=>({id:c.id,x:c.x,y:c.y,radius:c.radius,cleared:c.cleared,corruptionPushRadius:c.corruptionPushRadius}))}));

    ws.on('message',(raw)=>{
        let msg;try{msg=JSON.parse(raw);}catch{return;}
        if(msg.type==='move'&&players[id]){players[id].x=msg.x;players[id].y=msg.y;}
        if(msg.type==='profile'&&players[id]){players[id].avatar=msg.avatar||'🧙';players[id].className=msg.className||'HERO';players[id].heroName=msg.heroName||'HERO';players[id].activeElements=msg.activeElements||['fire'];}
        if(msg.type==='hit'){
            const t=enemies.find(e=>e.id===msg.enemyId);if(!t)return;
            const el=msg.element||null;
            const combo=checkCrossCombo(t,el,id);
            let dmg=calcDmg(msg.damage||1,el,t);
            if(combo){dmg*=combo.dmgMult;broadcastCombo(combo,t.id,id,combo.statusAppliedBy);delete t.statuses[combo.statusKey];}
            t.hp-=dmg;
            if(el)applyStatus(t,el,id);
            const mult=(el&&t.element&&DAMAGE_CHART[el])?(DAMAGE_CHART[el][t.element]??1.0):1.0;
            ws.send(JSON.stringify({type:'hitResult',enemyId:t.id,enemyElement:t.element,attackElement:el,multiplier:mult,comboTriggered:combo?combo.name:null,enemyType:t.type}));
            if(t.hp<=0){spawnGems(t.x,t.y,t.type);enemies=enemies.filter(e=>e.id!==t.id);const xp=t.type==='boss'?200:t.type==='miniboss'?80:20;ws.send(JSON.stringify({type:'killXp',amount:xp,enemyType:t.type}));}
        }
        if(msg.type==='applyStatus'){const t=enemies.find(e=>e.id===msg.enemyId);if(t&&msg.element)applyStatus(t,msg.element,id,msg.stacks||1);}
        if(msg.type==='collectGem'){const g=gems.find(g=>g.id===msg.gemId);if(g){gems=gems.filter(x=>x.id!==msg.gemId);ws.send(JSON.stringify({type:'gemCollected',gemId:msg.gemId,value:g.value}));}}
        if(msg.type==='playerReady'&&players[id]){players[id].ready=msg.status;checkAllReady();}
        if(msg.type==='runComplete')ws.send(JSON.stringify({type:'runResult',classXp:msg.classXp,swarmTier}));
    });
    ws.on('close',()=>{
        delete players[id];
        if(Object.keys(players).length===0){stopSwarm();enemies=[];gems=[];swarmTier=1;gamePhase='WAVE';}
    });
});

function checkAllReady(){
    const list=Object.values(players);
    if(!list.length||!list.every(p=>p.ready))return;
    if(gamePhase==='LEVEL_CLEAR'){list.forEach(p=>{p.ready=false;p.x=0;p.y=0;});swarmTier=Math.max(1,swarmTier-2);initLevel(levelNum+1);}
}

setInterval(()=>{
    if(gamePhase!=='WAVE'){broadcastState();return;}
    tickStatuses();tickCorruption();tickPurgeStones();checkClusters();
    for(let i=gems.length-1;i>=0;i--){gems[i].lifetime--;gems[i].pulse=(gems[i].pulse||0)+0.08;if(gems[i].lifetime<=0)gems.splice(i,1);}
    enemies.forEach(en=>{
        let closest=null,minD=Infinity;
        for(const p of Object.values(players)){const d=Math.hypot(p.x-en.x,p.y-en.y);if(d<minD){minD=d;closest=p;}}
        if(!closest)return;
        const dx=closest.x-en.x,dy=closest.y-en.y,d=Math.hypot(dx,dy);
        if(d>5){en.x+=(dx/d)*en.speed;en.y+=(dy/d)*en.speed;}
    });
    broadcastState();
},50);

function spreadPoints(count,maxDist,minDist,rng){
    const pts=[];let attempts=0;
    while(pts.length<count&&attempts<count*20){attempts++;const angle=rng()*Math.PI*2,dist=minDist+rng()*(maxDist-minDist),x=Math.cos(angle)*dist,y=Math.sin(angle)*dist;if(!pts.some(p=>Math.hypot(p.x-x,p.y-y)<350))pts.push({x,y});}
    return pts;
}

console.log(`[Server] Spire Online on port ${PORT}`);
