// core/config.js
export default {
  PAIR_GATE: 'WMTX_USDT',   // Par SPOT na Gate
  PAIR_MEXC: 'WMTX_USDT',   // Par FUTUROS na MEXC
  SPREAD_MIN_OPEN: 0.2,     // Percentual mínimo de arbitragem (abertura)
  SPREAD_MIN_CLOSE: 0.2,    // Percentual mínimo de arbitragem (fechamento)
  COOLDOWN_MS: 7000,        // Cooldown entre sinais
  PERSISTENCE_MS: 300,      // Tempo mínimo (ms) acima do spread
  AUTO_EXECUTION_COOLDOWN_MS: 7000,
  AUTO_CLOSE_PROFIT_PERCENT: null,
  AUTO_CLOSE_PROFIT_USDT: null,
  AUTO_CLOSE_MINUTES: null,
  LIMIT_TO_TOP_LIQUIDITY: false,
  ENABLE_AUTO_REBALANCE: false,

  ORDER_VOLUME: 50,
  MIN_LIQUIDITY_OPEN: 50,
  MIN_LIQUIDITY_CLOSE: 50,
  ALLOW_PARTIAL_EXECUTION: false,

  EXPOSURE_LIMITS: {
    PER_ASSET: 1000,
    PER_EXCHANGE: 2000,
    GLOBAL: 5000
  }
};
