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
    syncTestExecution: false,
    executionModes: {
      openEnabled: true,
      closeEnabled: false
    }
  }
};
