// ==UserScript==
// @name         ArbiSync - Execução sincronizada (SPOT/FUTUROS)
// @namespace    https://arbsync.local/
// @version      0.1.0
// @description  Executa ordens simultâneas em SPOT e FUTUROS via automação na página.
// @author       ArbiSync
// @match        https://www.gate.io/* 
// @match        https://www.gate.com/*
// @match        https://www.mexc.com/* 
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const EXCHANGE = detectExchange();

  if (!EXCHANGE) {
    return;
  }

  window.postMessage(
    { type: 'ARBSYNC_SYNC_READY', exchange: EXCHANGE },
    '*'
  );

  window.addEventListener('message', async (event) => {
    if (!event?.data || event.data.type !== 'ARBSYNC_TEST_EXECUTION') return;

    const payload = event.data.payload || {};
    const spotVolume = Number(payload.spotVolume || 0);
    const futuresContracts = Number(payload.futuresContracts || 0);
    const gateSymbol = normalizeSymbol(payload.pairGate);
    const mexcSymbol = normalizeSymbol(payload.pairMexc);
    const actionSpot = payload.actionSpot || 'BUY';
    const mode = payload.mode || 'OPEN';

    if (EXCHANGE === 'GATE') {
      await executeGateSpot(spotVolume, {
        symbol: gateSymbol,
        action: actionSpot,
        mode
      });
    }

    if (EXCHANGE === 'MEXC') {
      await executeMexcFutures(futuresContracts, {
        symbol: mexcSymbol,
        mode
      });
    }
  });

  function detectExchange() {
    const host = window.location.host;
    if (host.includes('gate.io') || host.includes('gate.com')) return 'GATE';
    if (host.includes('mexc.com')) return 'MEXC';
    return null;
  }

  function findButtonByText(labels, scopeSelector) {
    const scope = scopeSelector
      ? document.querySelector(scopeSelector)
      : document;
    if (!scope) return null;
    const buttons = Array.from(scope.querySelectorAll('button'));
    return buttons.find((btn) =>
      labels.some((label) => btn.textContent?.trim().includes(label))
    );
  }

  async function executeGateSpot(volume, context = {}) {
    if (!volume) {
      console.warn('[ArbiSync] Volume SPOT inválido');
      return;
    }

    const qtyInput =
      document.querySelector('#mantine-0l3yrzgvy') ||
      document.querySelector(
        '#trading_dom input[inputmode="decimal"], #trading_dom input[type="text"][inputmode="decimal"]'
      ) ||
      document.querySelector('input[placeholder*="Quantidade"], input[placeholder*="Amount"]');
    const symbolLabel = (context.symbol || '').toUpperCase();
    const buyButton =
      document.querySelector(
        '#trading_dom > div > div.tab_body > div > div > div:nth-child(7) > button'
      ) ||
      document.querySelector(
        '#trading_dom > div > div.tab_body > div > div > div:nth-child(8) > button'
      ) ||
      document.querySelector(
        '#trading_dom > div > div.tab_body > div > div > div:nth-child(6) > button'
      ) ||
      findButtonByText(
        buildSpotButtonLabels(context.action, symbolLabel),
        '#trading_dom'
      );

    if (!qtyInput || !buyButton) {
      console.warn('[ArbiSync] Ajuste os seletores Gate SPOT');
      return;
    }

    setNativeValue(qtyInput, String(volume));
    dispatchInputEvents(qtyInput);
    await delay(150);
    buyButton.click();
  }

  async function executeMexcFutures(contracts, context = {}) {
    if (!contracts) {
      console.warn('[ArbiSync] Contratos FUTUROS inválidos');
      return;
    }

    const qtyInput = document.querySelector(
      '#mexc_contract_v_open_position > div > div.component_inputWrapper__LP4Dm > div.component_numberInput__PF7Vf > div > div.InputNumberHandle_inputOuterWrapper__8w_l1 > div > div > input, input[placeholder*="Quantidade"], input[placeholder*="Qty"]'
    );
    const sellButton =
      document.querySelector(
        '#mexc_contract_v_open_position_info_login > section > div > div:nth-child(1) > div > button.ant-btn-v2.ant-btn-v2-tertiary.ant-btn-v2-md.component_shortBtn__x5P3I.component_withColor__LqLhs'
      ) || findButtonByText(['Abrir Short', 'Short']);

    if (!qtyInput || !sellButton) {
      console.warn('[ArbiSync] Ajuste os seletores MEXC FUTUROS');
      return;
    }

    setNativeValue(qtyInput, String(contracts));
    dispatchInputEvents(qtyInput);
    await delay(150);
    sellButton.click();
  }

  function setNativeValue(element, value) {
    const { set } = Object.getOwnPropertyDescriptor(element, 'value') || {};
    const prototype = Object.getPrototypeOf(element);
    const { set: prototypeSet } = Object.getOwnPropertyDescriptor(
      prototype,
      'value'
    ) || {};
    if (prototypeSet) {
      prototypeSet.call(element, value);
    } else if (set) {
      set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeSymbol(symbol) {
    if (!symbol) return '';
    return symbol.split('_')[0] || symbol.split('/')[0] || symbol;
  }

  function buildSpotButtonLabels(action, symbolLabel) {
    const verb = action === 'SELL' ? 'Vender' : 'Comprar';
    const fallback = action === 'SELL' ? 'Sell' : 'Buy';
    if (!symbolLabel) return [verb, fallback];
    return [`${verb} ${symbolLabel}`, verb, `${fallback} ${symbolLabel}`, fallback];
  }
})();
