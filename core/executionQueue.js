// core/executionQueue.js
import cfg from './config.js';
import state from './state.js';
import {
  applyExposure,
  canPlaceOrders,
  checkLimits,
  registerOrder,
  registerOutcome
} from './riskManager.js';

const STATUS = {
  PENDING: 'PENDING',
  EXECUTING: 'EXECUTING',
  FAILED: 'FAILED',
  COMPLETED: 'COMPLETED'
};

function buildOrderId() {
  return `ord_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function pushHistory(item) {
  state.queueHistory.unshift(item);
  if (state.queueHistory.length > cfg.MAX_QUEUE_HISTORY) {
    state.queueHistory.pop();
  }
}

export function enqueueOrder(order) {
  const payload = {
    id: buildOrderId(),
    asset: order.asset,
    exchange: order.exchange,
    volume: order.volume,
    side: order.side,
    price: order.price,
    spreadPct: order.spreadPct,
    slippagePct: order.slippagePct ?? cfg.SIMULATED_SLIPPAGE_PCT,
    priority: order.priority ?? 0,
    status: STATUS.PENDING,
    createdAt: Date.now(),
    bypassLimits: !!order.bypassLimits,
    suggested: !!order.suggested,
    confirmed: !!order.confirmed
  };

  state.executionQueue.push(payload);
  state.executionQueue.sort((a, b) => b.priority - a.priority);
  return payload;
}

function splitByLiquidity(order) {
  if (order.volume <= cfg.LIQUIDITY_MAX_PER_ORDER) return [order];

  const chunks = [];
  let remaining = order.volume;
  while (remaining > 0) {
    const chunkSize = Math.min(cfg.LIQUIDITY_MAX_PER_ORDER, remaining);
    chunks.push({ ...order, volume: chunkSize });
    remaining -= chunkSize;
  }
  return chunks;
}

function executeOrder(order) {
  order.status = STATUS.EXECUTING;

  const slippagePct = order.slippagePct ?? cfg.SIMULATED_SLIPPAGE_PCT;
  const spreadPct = order.spreadPct ?? 0;

  if (!order.bypassLimits) {
    const allowed = canPlaceOrders();
    if (!allowed.ok) {
      order.status = STATUS.FAILED;
      order.error = allowed.reason;
      pushHistory({ ...order, executedAt: Date.now() });
      registerOutcome({ success: false });
      return;
    }

    const limits = checkLimits({
      volume: order.volume,
      spreadPct,
      slippagePct,
      asset: order.asset,
      exchange: order.exchange
    });

    if (!limits.ok) {
      order.status = STATUS.FAILED;
      order.error = limits.reason;
      pushHistory({ ...order, executedAt: Date.now() });
      registerOutcome({ success: false });
      return;
    }
  }

  registerOrder();
  applyExposure({
    volume: order.volume,
    asset: order.asset,
    exchange: order.exchange
  });

  const resolved = {
    ...order,
    status: STATUS.COMPLETED,
    executedAt: Date.now()
  };

  order.status = resolved.status;
  pushHistory(resolved);
  registerOutcome({ success: true });
}

export function processQueue() {
  if (state.panic) {
    return;
  }

  const pending = state.executionQueue.filter((order) => {
    if (order.status !== STATUS.PENDING) return false;
    if (order.suggested && !order.confirmed) return false;
    return true;
  });

  if (!pending.length) return;

  const order = pending[0];
  state.executionQueue = state.executionQueue.filter((item) => item.id !== order.id);

  const chunks = splitByLiquidity(order);
  if (chunks.length > 1) {
    chunks.forEach((chunk, index) => {
      enqueueOrder({
        ...chunk,
        id: `${order.id}_${index}`,
        priority: order.priority
      });
    });
    return;
  }

  executeOrder(order);
}

export function clearQueue({ keepHistory = false } = {}) {
  state.executionQueue = [];
  if (!keepHistory) {
    state.queueHistory = [];
  }
}

export function confirmOrder(id) {
  const target = state.executionQueue.find((order) => order.id === id);
  if (!target) return false;
  target.confirmed = true;
  return true;
}

export function emergencyStop() {
  clearQueue({ keepHistory: true });
  state.exposure.global = 0;
  state.exposure.assets = {};
  state.exposure.exchanges = {};
}

export function getQueueStatus() {
  return {
    queue: state.executionQueue,
    history: state.queueHistory
  };
}

export { STATUS };
