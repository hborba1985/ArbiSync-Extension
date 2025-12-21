// core/index.js
import { startFeeds } from './priceFeeds.js';
import { checkArbitrage } from './arbitrageEngine.js';
import { startBridge, broadcastState } from './bridge.js';
import { enqueueOrder, processQueue } from './executionQueue.js';
import cfg from './config.js';
import state from './state.js';

console.log('🚀 Arbitrage core iniciado');

state.mode = 'ARMED';
state.autoMode = false;
state.assistedMode = true;

startFeeds();
startBridge(8787);

function buildOrderPayload() {
  if (typeof state.askGate !== 'number' || typeof state.bidMexc !== 'number') {
    return null;
  }

  return {
    asset: cfg.PAIR_GATE,
    exchange: 'GATE',
    side: 'BUY',
    volume: cfg.ORDER_VOLUME,
    price: state.askGate,
    spreadPct: state.spread
  };
}

setInterval(() => {
  checkArbitrage();
  broadcastState();

  if (state.signal && typeof state.spread === 'number') {
    console.log(`⚡ Arbitragem detectada: ${state.spread.toFixed(3)}%`);

    const now = Date.now();
    const canEnqueue =
      !state.lastEnqueueAt || now - state.lastEnqueueAt > cfg.COOLDOWN_MS;

    if (canEnqueue) {
      if (state.autoMode) {
        const payload = buildOrderPayload();
        if (payload) {
          enqueueOrder({
            ...payload,
            priority: 10,
            suggested: false,
            confirmed: true
          });
          state.lastEnqueueAt = now;
        }
      } else if (state.assistedMode) {
        const payload = buildOrderPayload();
        if (payload) {
          enqueueOrder({
            ...payload,
            priority: 5,
            suggested: true,
            confirmed: false
          });
          state.lastEnqueueAt = now;
        }
      }
    }
  }

  processQueue();
}, 100);
