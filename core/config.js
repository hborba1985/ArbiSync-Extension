// core/config.js
export default {
  PAIR_GATE: 'WMTX_USDT',   // Par SPOT na Gate
  PAIR_MEXC: 'WMTX_USDT',   // Par FUTUROS na MEXC
  SPREAD_MIN: 0.2,          // Percentual mínimo de arbitragem
  COOLDOWN_MS: 7000,        // Cooldown entre sinais
  PERSISTENCE_MS: 300,      // Tempo mínimo (ms) acima do spread

  ORDER_VOLUME: 50,
  MIN_VOLUME: 10,
  SLIPPAGE_MAX: 0.15,       // Percentual máximo de slippage permitido
  MAX_ORDERS_PER_MINUTE: 6,
  LIQUIDITY_MAX_PER_ORDER: 200,
  SIMULATED_SLIPPAGE_PCT: 0.02,

  LOSS_COOLDOWN_AFTER: 3,
  LOSS_COOLDOWN_MS: 30000,

  EXPOSURE_LIMITS: {
    PER_ASSET: 1000,
    PER_EXCHANGE: 2000,
    GLOBAL: 5000
  },

  MAX_QUEUE_HISTORY: 50
};
