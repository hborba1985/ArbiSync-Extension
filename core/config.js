// core/config.js
export default {
  PAIR_GATE: 'WMTX_USDT',   // Par SPOT na Gate
  PAIR_MEXC: 'WMTX_USDT',   // Par FUTUROS na MEXC
  SPREAD_MIN: 0.2,          // Percentual mínimo de arbitragem
  COOLDOWN_MS: 7000,        // Cooldown entre sinais
  PERSISTENCE_MS: 300,      // Tempo mínimo (ms) acima do spread

  ORDER_VOLUME: 50,
  MIN_VOLUME: 10,
  MIN_LIQUIDITY: 50,
  SLIPPAGE_MAX: 0.15,       // Percentual máximo de slippage permitido
  MAX_ALERTS_PER_MINUTE: 6,
  FUTURES_CONTRACT_SIZE: 1,
  ALLOW_PARTIAL_EXECUTION: false,

  EXPOSURE_LIMITS: {
    PER_ASSET: 1000,
    PER_EXCHANGE: 2000,
    GLOBAL: 5000
  }
};
