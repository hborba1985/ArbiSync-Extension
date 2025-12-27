// core/priceFeeds.js
import WebSocket from 'ws';
import state from './state.js';
import cfg from './config.js';

/**
 * Inicializa os feeds de preço:
 * - Gate.io / Gate.com SPOT  -> melhor ASK (lowest_ask)
 * - MEXC FUTUROS            -> melhor BID
 */
export function startFeeds() {
  startGateSpot();
  startMexcFutures();
}

/* ========================================================= */
/* ====================== GATE SPOT ======================== */
/* ========================================================= */

function startGateSpot() {
  const url = 'wss://api.gateio.ws/ws/v4/';
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('🟢 Gate SPOT WS conectado');

    ws.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: 'spot.tickers',
        event: 'subscribe',
        payload: [cfg.PAIR_GATE]
      })
    );
  });

  ws.on('message', (raw) => {
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
    } catch (err) {
      console.error('❌ Erro ao processar Gate:', err.message);
    }
  });

  ws.on('error', (err) => {
    console.error('❌ Gate WS erro:', err.message);
  });

  ws.on('close', () => {
    console.warn('⚠️ Gate WS fechado — reconectando em 5s');
    setTimeout(startGateSpot, 5000);
  });
}

/* ========================================================= */
/* ==================== MEXC FUTUROS ======================= */
/* ========================================================= */

function startMexcFutures() {
  const url = 'wss://contract.mexc.com/edge';
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('🟢 MEXC FUTUROS WS conectado');

    ws.send(
      JSON.stringify({
        method: 'sub.ticker',
        param: {
          symbol: cfg.PAIR_MEXC
        }
      })
    );
  });

  ws.on('message', (raw) => {
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
    } catch (err) {
      console.error('❌ Erro ao processar MEXC:', err.message);
    }
  });

  ws.on('error', (err) => {
    console.error('❌ MEXC WS erro:', err.message);
  });

  ws.on('close', () => {
    console.warn('⚠️ MEXC WS fechado — reconectando em 5s');
    setTimeout(startMexcFutures, 5000);
  });
}
