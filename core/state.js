// core/state.js
export default {
  askGate: null,
  bidGate: null,
  gateAskSize: null,
  gateBidSize: null,
  bidMexc: null,
  askMexc: null,
  mexcBidSize: null,
  mexcAskSize: null,
  spread: null,
  signal: false,
  mode: 'READY',
  alert: null,
  lastTestExecution: null,
  settings: {
    spreadMinOpen: null,
    spreadMinClose: null,
    minLiquidityOpen: null,
    minLiquidityClose: null,
    refreshIntervalMs: 1,
    submitDelayMs: 1,
    allowPartialExecution: false,
    exposurePerAsset: null,
    exposurePerExchange: null,
    exposureGlobal: null,
    spotVolume: null,
    testVolume: null,
    enableLiveExecution: false,
    autoExecutionCooldownMs: null,
    autoCloseProfitPercent: null,
    autoCloseProfitUsdt: null,
    autoCloseMinutes: null,
    limitToTopLiquidity: false,
    enableAutoRebalance: false,
    syncTestExecution: false,
    executionModes: {
      openEnabled: true,
      closeEnabled: false
    },
    pairGate: null,
    pairMexc: null
  }
};
