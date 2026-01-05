// core/index.js
import { startFeeds } from './priceFeeds.js';
import { checkArbitrage } from './arbitrageEngine.js';
import { startBridge, broadcastState } from './bridge.js';
import cfg from './config.js';
import state from './state.js';

console.log('🚀 Arbitrage core iniciado');

state.mode = 'ARMED';

startFeeds();
startBridge(8787);

state.settings = {
  ...state.settings,
  spreadMinOpen: cfg.SPREAD_MIN_OPEN,
  spreadMinClose: cfg.SPREAD_MIN_CLOSE,
  minLiquidityOpen: cfg.MIN_LIQUIDITY_OPEN,
  minLiquidityClose: cfg.MIN_LIQUIDITY_CLOSE,
  refreshIntervalMs: 1,
  submitDelayMs: 1,
  allowPartialExecution: cfg.ALLOW_PARTIAL_EXECUTION,
  exposurePerAsset: cfg.EXPOSURE_LIMITS.PER_ASSET,
  exposurePerExchange: cfg.EXPOSURE_LIMITS.PER_EXCHANGE,
  exposureGlobal: cfg.EXPOSURE_LIMITS.GLOBAL,
  spotVolume: cfg.ORDER_VOLUME,
  testVolume: cfg.ORDER_VOLUME,
  enableLiveExecution: false,
  autoExecutionCooldownMs: cfg.AUTO_EXECUTION_COOLDOWN_MS,
  executionModes: {
    openEnabled: true,
    closeEnabled: false
  },
  pairGate: cfg.PAIR_GATE,
  pairMexc: cfg.PAIR_MEXC
};

setInterval(() => {
  checkArbitrage();
  broadcastState();
}, 100);
