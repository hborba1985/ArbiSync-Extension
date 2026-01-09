// core/priceFeeds.js
import WebSocket from 'ws';
import state from './state.js';
import cfg from './config.js';

/**
 * Inicializa os feeds de preço:
 * - Gate.io / Gate.com SPOT  -> melhor ASK (lowest_ask)
 * - MEXC FUTUROS            -> melhor BID
 */
let gateWs = null;
let mexcWs = null;
let gateReconnectTimer = null;
let mexcReconnectTimer = null;
let currentGatePair = null;
let currentMexcPair = null;

export function startFeeds() {
  const pairGate = state.settings?.pairGate ?? cfg.PAIR_GATE;
  const pairMexc = state.settings?.pairMexc ?? cfg.PAIR_MEXC;
  currentGatePair = pairGate;
  currentMexcPair = pairMexc;
  startGateSpot(pairGate);
  startMexcFutures(pairMexc);
}

export function updateFeeds({ pairGate, pairMexc } = {}) {
  const nextGate = pairGate ?? currentGatePair ?? cfg.PAIR_GATE;
  const nextMexc = pairMexc ?? currentMexcPair ?? cfg.PAIR_MEXC;
  const gateChanged = nextGate && nextGate !== currentGatePair;
  const mexcChanged = nextMexc && nextMexc !== currentMexcPair;
  if (gateChanged) {
    currentGatePair = nextGate;
    if (gateReconnectTimer) clearTimeout(gateReconnectTimer);
    if (gateWs) gateWs.close();
    startGateSpot(nextGate);
  }
  if (mexcChanged) {
    currentMexcPair = nextMexc;
    if (mexcReconnectTimer) clearTimeout(mexcReconnectTimer);
    if (mexcWs) mexcWs.close();
    startMexcFutures(nextMexc);
  }
}

function normalizeBookSize(entry) {
  if (entry == null) return null;
  if (Array.isArray(entry)) {
    return Number(entry[1]);
  }
  if (typeof entry === 'object') {
    return Number(
      entry.size ??
        entry.qty ??
        entry.quantity ??
        entry.vol ??
        entry.volume ??
        entry.amount ??
        entry.q
    );
  }
  return Number(entry);
}

function normalizeMexcDepthQuantity(entry) {
  if (entry == null) return null;
  if (Array.isArray(entry)) {
    if (entry.length >= 3) return Number(entry[2]);
    return Number(entry[1]);
  }
  if (typeof entry === 'object') {
    return Number(entry.quantity ?? entry.qty ?? entry.size ?? entry.q);
  }
  return Number(entry);
}

/* ========================================================= */
/* ====================== GATE SPOT ======================== */
/* ========================================================= */

function startGateSpot(pairGate) {
  const url = 'wss://api.gateio.ws/ws/v4/';
  gateWs = new WebSocket(url);

  gateWs.on('open', () => {
    console.log('🟢 Gate SPOT WS conectado');

    gateWs.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: 'spot.tickers',
        event: 'subscribe',
        payload: [pairGate]
      })
    );
    gateWs.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: 'spot.order_book',
        event: 'subscribe',
        payload: [pairGate, '100ms', '1']
      })
    );
  });

  gateWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // spot.tickers retorna result com lowest_ask e highest_bid
      if (msg.result?.lowest_ask) {
        const ask = Number(msg.result.lowest_ask);
        if (!Number.isNaN(ask)) {
          state.askGate = ask;
        }
      }
      const rawAskSize =
        msg.result?.lowest_ask_size ??
        msg.result?.lowest_ask_qty ??
        msg.result?.ask_size;
      if (rawAskSize != null) {
        const askSize = Number(rawAskSize);
        if (!Number.isNaN(askSize)) {
          state.gateAskSize = askSize;
        }
      }
      if (msg.result?.highest_bid) {
        const bid = Number(msg.result.highest_bid);
        if (!Number.isNaN(bid)) {
          state.bidGate = bid;
        }
      }
      const rawBidSize =
        msg.result?.highest_bid_size ??
        msg.result?.highest_bid_qty ??
        msg.result?.bid_size;
      if (rawBidSize != null) {
        const bidSize = Number(rawBidSize);
        if (!Number.isNaN(bidSize)) {
          state.gateBidSize = bidSize;
        }
      }

      if (msg.channel === 'spot.order_book' && msg.result) {
        const asks = msg.result.asks ?? msg.result.a;
        const bids = msg.result.bids ?? msg.result.b;
        const askSize = normalizeBookSize(asks?.[0]);
        if (!Number.isNaN(askSize)) {
          state.gateAskSize = askSize;
        }
        const bidSize = normalizeBookSize(bids?.[0]);
        if (!Number.isNaN(bidSize)) {
          state.gateBidSize = bidSize;
        }
      }
    } catch (err) {
      console.error('❌ Erro ao processar Gate:', err.message);
    }
  });

  gateWs.on('error', (err) => {
    console.error('❌ Gate WS erro:', err.message);
  });

  gateWs.on('close', () => {
    console.warn('⚠️ Gate WS fechado — reconectando em 5s');
    if (gateReconnectTimer) clearTimeout(gateReconnectTimer);
    gateReconnectTimer = setTimeout(
      () => startGateSpot(currentGatePair ?? pairGate),
      5000
    );
  });
}

/* ========================================================= */
/* ==================== MEXC FUTUROS ======================= */
/* ========================================================= */

function startMexcFutures(pairMexc) {
  const url = 'wss://contract.mexc.com/edge';
  mexcWs = new WebSocket(url);

  mexcWs.on('open', () => {
    console.log('🟢 MEXC FUTUROS WS conectado');

    mexcWs.send(
      JSON.stringify({
        method: 'sub.ticker',
        param: {
          symbol: pairMexc
        }
      })
    );
    mexcWs.send(
      JSON.stringify({
        method: 'sub.depth',
        param: {
          symbol: pairMexc,
          level: 1
        }
      })
    );
  });

  mexcWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // ticker da MEXC futures: data.bid/bid1 e data.ask/ask1 (pode vir como string)
      const rawBid = msg?.data?.bid ?? msg?.data?.bid1;
      if (rawBid != null) {
        const bid = Number(rawBid);
        if (!Number.isNaN(bid)) {
          state.bidMexc = bid;
        }
      }
      const rawBidSize =
        msg?.data?.bidSize ??
        msg?.data?.bid1Size ??
        msg?.data?.bidVol ??
        msg?.data?.bidQty;
      if (rawBidSize != null) {
        const bidSize = Number(rawBidSize);
        if (!Number.isNaN(bidSize)) {
          state.mexcBidSize = bidSize;
        }
      }
      const rawAsk = msg?.data?.ask ?? msg?.data?.ask1;
      if (rawAsk != null) {
        const ask = Number(rawAsk);
        if (!Number.isNaN(ask)) {
          state.askMexc = ask;
        }
      }
      const rawAskSize =
        msg?.data?.askSize ??
        msg?.data?.ask1Size ??
        msg?.data?.askVol ??
        msg?.data?.askQty;
      if (rawAskSize != null) {
        const askSize = Number(rawAskSize);
        if (!Number.isNaN(askSize)) {
          state.mexcAskSize = askSize;
        }
      }

      if (msg?.data?.asks || msg?.data?.bids) {
        const depthAskBase = normalizeMexcDepthQuantity(msg.data?.asks?.[0]);
        const depthAskSize = depthAskBase;
        if (!Number.isNaN(depthAskSize)) {
          state.mexcAskSize = depthAskSize;
        }
        const depthBidBase = normalizeMexcDepthQuantity(msg.data?.bids?.[0]);
        const depthBidSize = depthBidBase;
        if (!Number.isNaN(depthBidSize)) {
          state.mexcBidSize = depthBidSize;
        }
      }
    } catch (err) {
      console.error('❌ Erro ao processar MEXC:', err.message);
    }
  });

  mexcWs.on('error', (err) => {
    console.error('❌ MEXC WS erro:', err.message);
  });

  mexcWs.on('close', () => {
    console.warn('⚠️ MEXC WS fechado — reconectando em 5s');
    if (mexcReconnectTimer) clearTimeout(mexcReconnectTimer);
    mexcReconnectTimer = setTimeout(
      () => startMexcFutures(currentMexcPair ?? pairMexc),
      5000
    );
  });
}
