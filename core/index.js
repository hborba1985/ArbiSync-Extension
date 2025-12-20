// core/index.js
import { startFeeds } from './priceFeeds.js';
import { checkArbitrage } from './arbitrageEngine.js';
import { startBridge, broadcastState } from './bridge.js';
import state from './state.js';

console.log('🚀 Arbitrage core iniciado');

state.mode = 'ARMED';

startFeeds();
startBridge(8787);

setInterval(() => {
  checkArbitrage();
  broadcastState();

  if (state.signal && typeof state.spread === 'number') {
    console.log(`⚡ Arbitragem detectada: ${state.spread.toFixed(3)}%`);
  }
}, 100);
