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
    spreadMin: null,
    minVolume: null,
    minLiquidity: null,
    refreshIntervalMs: null,
    submitDelayMs: null,
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
    executionModes: {
      openEnabled: true,
      closeEnabled: false
    }
  }
};
