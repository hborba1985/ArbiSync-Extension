// core/config.js
export default {
  PAIR_GATE: 'WMTX_USDT',   // Par SPOT na Gate
  PAIR_MEXC: 'WMTX_USDT',   // Par FUTUROS na MEXC
  SPREAD_MIN: 0.2,          // Percentual mínimo de arbitragem
  COOLDOWN_MS: 7000,        // Cooldown entre sinais
  PERSISTENCE_MS: 300       // Tempo mínimo (ms) acima do spread
};
