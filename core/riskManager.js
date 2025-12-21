// core/riskManager.js
import cfg from './config.js';
import state from './state.js';

const recentOrders = [];

function cleanupOrderTimestamps() {
  const cutoff = Date.now() - 60_000;
  while (recentOrders.length && recentOrders[0] < cutoff) {
    recentOrders.shift();
  }
}

export function canPlaceOrders() {
  if (state.panic) {
    return { ok: false, reason: 'panic' };
  }

  if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
    return { ok: false, reason: 'cooldown' };
  }

  cleanupOrderTimestamps();
  if (recentOrders.length >= cfg.MAX_ORDERS_PER_MINUTE) {
    return { ok: false, reason: 'orders_per_minute' };
  }

  return { ok: true };
}

export function registerOrder() {
  recentOrders.push(Date.now());
}

export function checkLimits({ volume, spreadPct, slippagePct, asset, exchange }) {
  if (volume < cfg.MIN_VOLUME) {
    return { ok: false, reason: 'min_volume' };
  }

  if (spreadPct < cfg.SPREAD_MIN) {
    return { ok: false, reason: 'min_spread' };
  }

  if (slippagePct > cfg.SLIPPAGE_MAX) {
    return { ok: false, reason: 'max_slippage' };
  }

  if (!checkExposure({ volume, asset, exchange })) {
    return { ok: false, reason: 'exposure_limit' };
  }

  return { ok: true };
}

export function checkExposure({ volume, asset, exchange }) {
  const nextGlobal = state.exposure.global + volume;
  if (nextGlobal > cfg.EXPOSURE_LIMITS.GLOBAL) return false;

  const nextExchange =
    (state.exposure.exchanges[exchange] || 0) + volume;
  if (nextExchange > cfg.EXPOSURE_LIMITS.PER_EXCHANGE) return false;

  const nextAsset = (state.exposure.assets[asset] || 0) + volume;
  if (nextAsset > cfg.EXPOSURE_LIMITS.PER_ASSET) return false;

  return true;
}

export function applyExposure({ volume, asset, exchange }) {
  state.exposure.global += volume;
  state.exposure.exchanges[exchange] =
    (state.exposure.exchanges[exchange] || 0) + volume;
  state.exposure.assets[asset] = (state.exposure.assets[asset] || 0) + volume;
}

export function releaseExposure({ volume, asset, exchange }) {
  state.exposure.global = Math.max(0, state.exposure.global - volume);
  state.exposure.exchanges[exchange] = Math.max(
    0,
    (state.exposure.exchanges[exchange] || 0) - volume
  );
  state.exposure.assets[asset] = Math.max(
    0,
    (state.exposure.assets[asset] || 0) - volume
  );
}

export function registerOutcome({ success }) {
  if (success) {
    state.losses = 0;
    return;
  }

  state.losses += 1;
  if (state.losses >= cfg.LOSS_COOLDOWN_AFTER) {
    state.cooldownUntil = Date.now() + cfg.LOSS_COOLDOWN_MS;
    state.losses = 0;
  }
}

export function triggerPanic() {
  state.panic = true;
  state.executionQueue = [];
}

export function clearPanic() {
  state.panic = false;
}
