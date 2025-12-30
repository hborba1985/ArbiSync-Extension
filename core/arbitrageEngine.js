// core/arbitrageEngine.js
import cfg from './config.js';
import state from './state.js';

let lastTrigger = 0;
let aboveSince = null;
const alertTimestamps = [];

function getSettings() {
  return {
    SPREAD_MIN:
      state.settings.spreadMinOpen ??
      state.settings.spreadMin ??
      cfg.SPREAD_MIN_OPEN,
    MIN_VOLUME: state.settings.minVolume ?? cfg.MIN_VOLUME,
    SLIPPAGE_MAX: state.settings.slippageMax ?? cfg.SLIPPAGE_MAX,
    MAX_ALERTS_PER_MINUTE:
      state.settings.maxAlertsPerMinute ?? cfg.MAX_ALERTS_PER_MINUTE,
    FUTURES_CONTRACT_SIZE:
      state.settings.futuresContractSize ?? cfg.FUTURES_CONTRACT_SIZE,
    EXPOSURE_LIMITS: {
      PER_ASSET: state.settings.exposurePerAsset ?? cfg.EXPOSURE_LIMITS.PER_ASSET,
      PER_EXCHANGE:
        state.settings.exposurePerExchange ?? cfg.EXPOSURE_LIMITS.PER_EXCHANGE,
      GLOBAL: state.settings.exposureGlobal ?? cfg.EXPOSURE_LIMITS.GLOBAL
    }
  };
}

function cleanupAlerts() {
  const cutoff = Date.now() - 60_000;
  while (alertTimestamps.length && alertTimestamps[0] < cutoff) {
    alertTimestamps.shift();
  }
}

function computeFuturesContracts(volume, contractSize) {
  if (!contractSize || contractSize <= 0) return 0;
  return volume / contractSize;
}

function evaluateFilters({ spread, volume, slippage, settings }) {
  const reasons = [];
  if (volume < settings.MIN_VOLUME) reasons.push('volume_min');
  if (spread < settings.SPREAD_MIN) reasons.push('spread_min');
  if (slippage > settings.SLIPPAGE_MAX) reasons.push('slippage_max');

  const futuresContracts = computeFuturesContracts(
    volume,
    settings.FUTURES_CONTRACT_SIZE
  );

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

  cleanupAlerts();
  if (alertTimestamps.length >= settings.MAX_ALERTS_PER_MINUTE) {
    reasons.push('alerts_per_minute');
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
  const slippage = state.settings.slippageEstimate ?? 0;

  const { reasons, futuresContracts } = evaluateFilters({
    spread,
    volume,
    slippage,
    settings
  });

  const eligible = reasons.length === 0 && !inCooldown;
  state.alert = {
    reasons,
    futuresContracts,
    volume,
    slippage
  };

  if (spread >= settings.SPREAD_MIN && eligible) {
    if (aboveSince === null) aboveSince = now;

    const persisted = (now - aboveSince) >= cfg.PERSISTENCE_MS;
    if (persisted) {
      state.signal = true;
      lastTrigger = now;
      alertTimestamps.push(now);
    }
  } else {
    aboveSince = null;
    state.signal = false;
  }
}
