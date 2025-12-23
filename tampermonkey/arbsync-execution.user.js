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

    if (EXCHANGE === 'GATE') {
      await executeGateSpot(spotVolume);
    }

    if (EXCHANGE === 'MEXC') {
      await executeMexcFutures(futuresContracts);
    }
  });

  function detectExchange() {
    const host = window.location.host;
    if (host.includes('gate.io') || host.includes('gate.com')) return 'GATE';
    if (host.includes('mexc.com')) return 'MEXC';
    return null;
  }

  function findButtonByText(labels) {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find((btn) =>
      labels.some((label) => btn.textContent?.trim().includes(label))
    );
  }

  async function executeGateSpot(volume) {
    if (!volume) {
      console.warn('[ArbiSync] Volume SPOT inválido');
      return;
    }

    const qtyInput = document.querySelector(
      '#mantine-0l3yrzgvy, input[placeholder*="Quantidade"], input[placeholder*="Amount"]'
    );
    const buyButton =
      document.querySelector(
        '#trading_dom > div > div.tab_body > div > div > div:nth-child(6) > button'
      ) || findButtonByText(['Compra', 'Comprar', 'Buy']);

    if (!qtyInput || !buyButton) {
      console.warn('[ArbiSync] Ajuste os seletores Gate SPOT');
      return;
    }

    qtyInput.value = volume;
    qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    buyButton.click();
  }

  async function executeMexcFutures(contracts) {
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

    qtyInput.value = contracts;
    qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
    sellButton.click();
  }
})();
