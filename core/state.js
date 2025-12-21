// core/state.js
export default {
  askGate: null,
  bidMexc: null,
  spread: null,
  signal: false,
  mode: 'READY',
  autoMode: false,
  assistedMode: true,
  panic: false,
  losses: 0,
  cooldownUntil: null,
  lastEnqueueAt: null,
  exposure: {
    global: 0,
    exchanges: {},
    assets: {}
  },
  executionQueue: [],
  queueHistory: []
};
