import { GameEngine } from '../js/game/engine.js';
import { BotRuntime } from '../js/game/bot.js';
import { pickBot } from '../js/data/bots.js';
let now = 0;
const engine = new GameEngine({ roomCode:'TESTIO', config:{maxPlayers:9,minStart:9,roles:{doctor:true,assassin:true,jester:true},timers:{night:10,discussion:20,voting:10}}, now:()=>now, rng:Math.random });
for (let i=0;i<9;i++) { const b = pickBot(engine.players.map(p=>p.botId)); engine.addBot(b.id,b); }
engine.start(true);
const runtime = new BotRuntime({engine});
let steps=0;
while (engine.phase!=='ended' && steps<5000) {
  now += 250;
  engine.tick(now);
  runtime.tick(now);
  steps++;
  if (steps%40===0) console.log(engine.phase, 'day',engine.day, 'alive',engine.alivePlayers.length, 'chat',engine.chat.length);
}
console.log('END', steps, engine.phase, engine.winner?.team, engine.winner?.title, 'chat', engine.chat.length);
console.log(engine.players.map(p=>`${p.name}:${p.roleId}:${p.alive?'alive':'dead'}`).join('\n'));
console.log(engine.chat.slice(-20).map(m=>`${m.name}: ${m.text}`).join('\n'));
