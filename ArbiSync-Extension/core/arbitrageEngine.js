// core/arbitrageEngine.js
import cfg from './config.js';
import state from './state.js';

let lastTrigger = 0;
let aboveSince = null;

export function checkArbitrage() {
  if (!state.askGate || !state.bidMexc) return;

  const spread = ((state.bidMexc - state.askGate) / state.askGate) * 100;
  state.spread = spread;

  // apenas quando ARMADO
  if (state.mode !== 'ARMED') {
    state.signal = false;
    aboveSince = null;
    return;
  }

  const now = Date.now();
  const inCooldown = (now - lastTrigger) < cfg.COOLDOWN_MS;

  if (spread >= cfg.SPREAD_MIN && !inCooldown) {
    if (aboveSince === null) aboveSince = now;

    const persisted = (now - aboveSince) >= cfg.PERSISTENCE_MS;
    if (persisted) {
      state.signal = true;
      lastTrigger = now;
      // mantém signal true até a extensão consumir/confirmar (por enquanto)
    }
  } else {
    aboveSince = null;
    state.signal = false;
  }
}
