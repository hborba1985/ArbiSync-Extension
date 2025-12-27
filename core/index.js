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
  spreadMin: cfg.SPREAD_MIN,
  minVolume: cfg.MIN_VOLUME,
  minLiquidity: cfg.MIN_LIQUIDITY,
  slippageMax: cfg.SLIPPAGE_MAX,
  maxAlertsPerMinute: cfg.MAX_ALERTS_PER_MINUTE,
  futuresContractSize: cfg.FUTURES_CONTRACT_SIZE,
  allowPartialExecution: cfg.ALLOW_PARTIAL_EXECUTION,
  exposurePerAsset: cfg.EXPOSURE_LIMITS.PER_ASSET,
  exposurePerExchange: cfg.EXPOSURE_LIMITS.PER_EXCHANGE,
  exposureGlobal: cfg.EXPOSURE_LIMITS.GLOBAL,
  spotVolume: cfg.ORDER_VOLUME,
  testVolume: cfg.MIN_VOLUME,
  slippageEstimate: 0,
  enableLiveExecution: false,
  executionModes: {
    openEnabled: true,
    closeEnabled: false
  }
};

setInterval(() => {
  checkArbitrage();
  broadcastState();

  if (state.signal && typeof state.spread === 'number') {
    console.log(`⚡ Arbitragem detectada: ${state.spread.toFixed(3)}%`);
  }
}, 100);
