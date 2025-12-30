// core/arbitrageEngine.js
import cfg from './config.js';
import state from './state.js';

let lastTrigger = 0;
let aboveSince = null;

function getSettings() {
  return {
    SPREAD_MIN:
      state.settings.spreadMinOpen ??
      state.settings.spreadMin ??
      cfg.SPREAD_MIN_OPEN,
    EXPOSURE_LIMITS: {
      PER_ASSET: state.settings.exposurePerAsset ?? cfg.EXPOSURE_LIMITS.PER_ASSET,
      PER_EXCHANGE:
        state.settings.exposurePerExchange ?? cfg.EXPOSURE_LIMITS.PER_EXCHANGE,
      GLOBAL: state.settings.exposureGlobal ?? cfg.EXPOSURE_LIMITS.GLOBAL
    }
  };
}

function evaluateFilters({ spread, volume, settings }) {
  const reasons = [];
  if (spread < settings.SPREAD_MIN) reasons.push('spread_min');

  const futuresContracts = volume;

  const perExchange = volume;
  const perAsset = volume * 2;
  const global = volume * 2;

  if (perExchange > settings.EXPOSURE_LIMITS.PER_EXCHANGE) {
    reasons.push('exposure_exchange');
  }
  if (perAsset > settings.EXPOSURE_LIMITS.PER_ASSET) {
    reasons.push('exposure_asset');
  }
  if (global > settings.EXPOSURE_LIMITS.GLOBAL) {
    reasons.push('exposure_global');
  }

  return { reasons, futuresContracts };
}

export function checkArbitrage() {
  if (!state.askGate || !state.bidMexc) return;

  const spread = ((state.bidMexc - state.askGate) / state.askGate) * 100;
  state.spread = spread;

  if (state.mode !== 'ARMED') {
    state.signal = false;
    aboveSince = null;
    state.alert = null;
    return;
  }

  const now = Date.now();
  const inCooldown = (now - lastTrigger) < cfg.COOLDOWN_MS;
  const settings = getSettings();
  const volume = state.settings.spotVolume ?? cfg.ORDER_VOLUME;

  const { reasons, futuresContracts } = evaluateFilters({
    spread,
    volume,
    settings
  });

  const eligible = reasons.length === 0 && !inCooldown;
  state.alert = {
    reasons,
    futuresContracts,
    volume
  };

  if (spread >= settings.SPREAD_MIN && eligible) {
    if (aboveSince === null) aboveSince = now;

    const persisted = (now - aboveSince) >= cfg.PERSISTENCE_MS;
    if (persisted) {
      state.signal = true;
      lastTrigger = now;
    }
  } else {
    aboveSince = null;
    state.signal = false;
  }
}
