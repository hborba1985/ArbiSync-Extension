// core/executionService.js
function normalizeSymbol(symbol, fallback) {
  const raw = symbol || fallback || '';
  if (raw.includes('/')) return raw;
  if (raw.includes('_')) return raw.replace('_', '/');
  return raw;
}

async function loadCcxt() {
  try {
    const mod = await import('ccxt');
    return mod.default ?? mod;
  } catch (err) {
    const message = err?.message || String(err);
    throw new Error(
      `Dependência ccxt não instalada. Rode "npm install" antes de executar (${message}).`
    );
  }
}

function buildGateClient(settings) {
  if (!settings.gateApiKey || !settings.gateApiSecret) {
    throw new Error('Gate API key/secret ausentes');
  }

  return new ccxt.gateio({
    apiKey: settings.gateApiKey,
    secret: settings.gateApiSecret,
    enableRateLimit: true
  });
}

function buildMexcClient(settings) {
  if (!settings.mexcApiKey || !settings.mexcApiSecret) {
    throw new Error('MEXC API key/secret ausentes');
  }

  return new ccxt.mexc({
    apiKey: settings.mexcApiKey,
    secret: settings.mexcApiSecret,
    enableRateLimit: true,
    options: {
      defaultType: settings.mexcMarketType || 'swap'
    }
  });
}

export async function executeTestOrders({
  settings,
  spotVolume,
  futuresContracts,
  defaultGateSymbol,
  defaultMexcSymbol
}) {
  if (!settings.enableLiveExecution) {
    throw new Error('Execução ao vivo desativada');
  }
  if (!spotVolume || spotVolume <= 0) {
    throw new Error('Volume de teste inválido');
  }
  if (!futuresContracts || futuresContracts <= 0) {
    throw new Error('Conversão de contratos inválida');
  }

  const ccxt = await loadCcxt();
  const gate = buildGateClient(settings);
  const mexc = buildMexcClient(settings);
  const gateSymbol = normalizeSymbol(settings.gateSymbol, defaultGateSymbol);
  const mexcSymbol = normalizeSymbol(settings.mexcSymbol, defaultMexcSymbol);

  if (!gateSymbol || !mexcSymbol) {
    throw new Error('Símbolos de mercado inválidos');
  }

  const [spotOrder, futuresOrder] = await Promise.all([
    gate.createOrder(gateSymbol, 'market', 'buy', spotVolume),
    mexc.createOrder(mexcSymbol, 'market', 'sell', futuresContracts)
  ]);

  return {
    gateOrderId: spotOrder?.id ?? null,
    mexcOrderId: futuresOrder?.id ?? null
  };
}
