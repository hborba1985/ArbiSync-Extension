// core/state.js
export default {
  askGate: null,
  bidMexc: null,
  spread: null,
  signal: false,
  mode: 'READY',
  alert: null,
  lastTestExecution: null,
  settings: {
    spreadMin: null,
    minVolume: null,
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
