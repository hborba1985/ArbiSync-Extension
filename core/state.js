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
    minVolume: null,
    minLiquidityOpen: null,
    minLiquidityClose: null,
    refreshIntervalMs: 1,
    submitDelayMs: 1,
    slippageMax: null,
    maxAlertsPerMinute: null,
    futuresContractSize: null,
    allowPartialExecution: false,
    exposurePerAsset: null,
    exposurePerExchange: null,
    exposureGlobal: null,
    spotVolume: null,
    testVolume: null,
    slippageEstimate: null,
    enableLiveExecution: false,
    syncTestExecution: false,
    executionModes: {
      openEnabled: true,
      closeEnabled: false
    }
  }
};
