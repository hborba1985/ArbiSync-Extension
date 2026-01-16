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
    const submitDelayMs = Number(payload.submitDelayMs || 250);
    const gateSymbol = normalizeSymbol(payload.pairGate);
    const mexcSymbol = normalizeSymbol(payload.pairMexc);
    const modes = payload.modes || {};

    if (EXCHANGE === 'GATE') {
      await executeGateSpot(spotVolume, {
        symbol: gateSymbol,
        modes,
        submitDelayMs
      });
    }

    if (EXCHANGE === 'MEXC') {
      await executeMexcFutures(futuresContracts, {
        symbol: mexcSymbol,
        modes,
        submitDelayMs
      });
    }
  });

  function detectExchange() {
    const host = window.location.host;
    if (host.includes('gate.io') || host.includes('gate.com')) return 'GATE';
    if (host.includes('mexc.com')) return 'MEXC';
    return null;
  }

  function findButtonByText(labels, scopeSelector, { skipTabs = false } = {}) {
    const scope = scopeSelector
      ? document.querySelector(scopeSelector)
      : document;
    if (!scope) return null;
    const buttons = Array.from(scope.querySelectorAll('button'));
    return buttons.find((btn) => {
      if (skipTabs && isTabButton(btn)) return false;
      return labels.some((label) => btn.textContent?.trim().includes(label));
    });
  }

  function isTabButton(button) {
    if (!button) return false;
    if (button.getAttribute('role') === 'tab') return true;
    if (button.closest('[role="tablist"]')) return true;
    return Boolean(button.closest('[class*="tab"]'));
  }

  async function executeGateSpot(volume, context = {}) {
    if (!volume) {
      console.warn('[ArbiSync] Volume SPOT inválido');
      return;
    }

    const getQtyInput = () =>
      document.querySelector('#mantine-0l3yrzgvy') ||
      document.querySelector(
        '#trading_dom input[inputmode="decimal"], #trading_dom input[type="text"][inputmode="decimal"]'
      ) ||
      document.querySelector(
        'input[placeholder*="Quantidade"], input[placeholder*="Amount"]'
      );
    const qtyInput = getQtyInput();
    const symbolLabel = (context.symbol || '').toUpperCase();
    const modes = context.modes || {};
    const submitDelay = Number(context.submitDelayMs || 250);
    const buyButton = findButtonByText(
      buildSpotButtonLabels('BUY', symbolLabel),
      '#trading_dom',
      { skipTabs: true }
    );
    const sellButton = findButtonByText(
      buildSpotButtonLabels('SELL', symbolLabel),
      '#trading_dom',
      { skipTabs: true }
    );

    if (!qtyInput) {
      console.warn('[ArbiSync] Ajuste os seletores Gate SPOT');
      return;
    }

    const needsBuy = !!modes.openEnabled;
    const needsSell = !!modes.closeEnabled;
    const actionLabel = buildSpotButtonLabels('BUY', symbolLabel);
    const closeLabel = buildSpotButtonLabels('SELL', symbolLabel);

    const findGateMatch = (labels) => {
      const gateButtons = findGateSubmitButtons();
      return gateButtons.find((btn) =>
        labels.some((label) => btn.textContent?.trim().includes(label))
      );
    };

    const actions = [];
    if (needsBuy) {
      actions.push({ tab: 'buy', labels: actionLabel, alert: 'Compra' });
    }
    if (needsSell) {
      actions.push({ tab: 'sell', labels: closeLabel, alert: 'Venda' });
    }

    if (actions.length === 0) {
      return;
    }

    for (const action of actions) {
      await activateGateTab(action.tab);
      const actionButton = findGateMatch(action.labels);
      if (!actionButton) {
        sendAlert(`Não encontrei "${action.alert}". Verifique os botões da Gate.`);
        continue;
      }
      const refreshedQtyInput = getQtyInput();
      if (!refreshedQtyInput) {
        sendAlert('Não encontrei o campo Quantia na Gate.');
        return;
      }
      setNativeValue(refreshedQtyInput, formatGateQuantity(volume));
      dispatchInputEvents(refreshedQtyInput);
      await delay(submitDelay);
      actionButton.click();
    }
  }

  async function executeMexcFutures(contracts, context = {}) {
    if (!contracts) {
      console.warn('[ArbiSync] Contratos FUTUROS inválidos');
      return;
    }

    const getQtyInput = (mode = 'open') => {
      const scopeSelectors = mode === 'close'
        ? [
            '#mexc_contract_v_close_position',
            '#mexc_contract_v_close_position_info_login',
            '[data-testid*="close"]'
          ]
        : [
            '#mexc_contract_v_open_position',
            '#mexc_contract_v_open_position_info_login',
            '[data-testid*="open"]'
          ];
      for (const scopeSelector of scopeSelectors) {
        const scope = document.querySelector(scopeSelector);
        if (!scope) continue;
        const input =
          scope.querySelector('input[placeholder*="Quantidade"]') ||
          scope.querySelector('input[placeholder*="Qty"]') ||
          scope.querySelector('input[type="text"]') ||
          scope.querySelector('input[type="number"]');
        if (input) return input;
      }
      const fallbackSelectors = [
        '#mexc_contract_v_open_position input[placeholder*="Quantidade"]',
        '#mexc_contract_v_open_position input[placeholder*="Qty"]',
        '#mexc_contract_v_open_position input[type="text"]',
        '#mexc_contract_v_open_position input[type="number"]',
        '#mexc_contract_v_close_position input[placeholder*="Quantidade"]',
        '#mexc_contract_v_close_position input[placeholder*="Qty"]',
        '#mexc_contract_v_close_position input[type="text"]',
        '#mexc_contract_v_close_position input[type="number"]',
        'input[placeholder*="Quantidade"]',
        'input[placeholder*="Qty"]'
      ];
      for (const selector of fallbackSelectors) {
        const input = document.querySelector(selector);
        if (input) return input;
      }
      return null;
    };
    const findCloseQtyInput = () => {
      const form = document.querySelector('[data-testid="contract-trade-order-form"]');
      const root = form || document.querySelector('#mexc-web-handle-content-wrapper-v');
      if (!root) return null;
      const closeButton =
        root.querySelector('button[data-testid="contract-trade-close-short-btn"]') ||
        document.querySelector(
          '#mexc-web-handle-content-wrapper-v > div:nth-child(2) > div > div > div.component_inputWrapper__LP4Dm > div:nth-child(3) > section > div > div:nth-child(1) > div > button.ant-btn-v2.ant-btn-v2-tertiary.ant-btn-v2-md.component_longBtn__eazYU.component_withColor__LqLhs'
        );
      if (closeButton) {
        const container = closeButton.closest('section') || closeButton.closest('div');
        const scopedInput = container?.querySelector(
          'input[type="text"], input[type="number"]'
        );
        if (scopedInput) {
          return scopedInput;
        }
      }
      const inputs = Array.from(
        root.querySelectorAll('input[type="text"], input[type="number"]')
      );
      return inputs[inputs.length - 1] || null;
    };
    const findSellButton = () =>
      document.querySelector(
        'button[data-testid="contract-trade-open-short-btn"]'
      ) ||
      findButtonByText(
        ['Abrir Short', 'Short', 'Abrir'],
        '#mexc_contract_v_open_position_info_login'
      );
    const findCloseButton = () => {
      const candidates = [
        document.querySelector(
          '#mexc-web-handle-content-wrapper-v > div:nth-child(2) > div > div > div.component_inputWrapper__LP4Dm > div:nth-child(3) > section > div > div:nth-child(1) > div > button.ant-btn-v2.ant-btn-v2-tertiary.ant-btn-v2-md.component_longBtn__eazYU.component_withColor__LqLhs'
        ),
        ...Array.from(
          document.querySelectorAll(
            'button[data-testid="contract-trade-close-short-btn"]'
          )
        ),
        findButtonByText(
          ['Fechar Short', 'Fechar Long', 'Fechar'],
          '#mexc_contract_v_open_position_info_login'
        )
      ].filter(Boolean);
      return candidates.find((btn) => btn.offsetParent !== null) || candidates[0];
    };

    const ensureCloseByQuantity = () => {
      const closeButton = findCloseButton();
      const scope = closeButton?.closest('[data-testid="contract-trade-order-form"]')
        || document.querySelector('#mexc_contract_v_close_position')
        || document.querySelector('#mexc-web-handle-content-wrapper-v');
      if (!scope) return;
      const percentButtons = Array.from(
        scope.querySelectorAll('button, span, div')
      ).filter((el) =>
        ['%', 'Porcentagem', 'Percent', '100%'].some((label) =>
          el.textContent?.trim().includes(label)
        )
      );
      percentButtons.forEach((el) => {
        if (el.getAttribute('aria-pressed') === 'true') {
          el.click();
        }
      });
      const zeroPercent = Array.from(
        scope.querySelectorAll('button, span, div')
      ).find((el) => el.textContent?.trim() === '0%');
      zeroPercent?.click();
      const closeAllToggle = Array.from(
        scope.querySelectorAll('input[type="checkbox"]')
      ).find((input) => {
        const label = input.closest('label')?.textContent || '';
        return /fechar tudo|close all|all/i.test(label);
      });
      if (closeAllToggle?.checked) {
        closeAllToggle.click();
      }
    };

    const setContracts = (mode) => {
      const qtyInput =
        mode === 'close'
          ? findCloseQtyInput() || getQtyInput(mode)
          : getQtyInput(mode);
      if (!qtyInput) return null;
      setNativeValue(qtyInput, String(contracts));
      dispatchInputEvents(qtyInput);
      const parseQty = (value) => {
        if (value == null) return null;
        const cleaned = String(value).replace(/\s+/g, '').replace(',', '.');
        const parsed = Number(cleaned.replace(/[^\d.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
      };
      const parsedInput = parseQty(qtyInput.value);
      if (mode === 'close' && Number.isFinite(parsedInput)) {
        const expected = Number(contracts);
        if (Number.isFinite(expected) && Math.abs(parsedInput - expected) > 0.0001) {
          sendAlert(`Quantidade divergente na MEXC (input="${qtyInput.value}"). Abortando.`);
          return null;
        }
      }
      return qtyInput;
    };

    if (!getQtyInput('open') && !getQtyInput('close')) {
      console.warn('[ArbiSync] Ajuste os seletores MEXC FUTUROS');
      return;
    }

    if (context.modes?.openEnabled) {
      await activateMexcTab('open');
      if (!setContracts('open')) {
        sendAlert('Não encontrei o campo Quantidade na aba Abrir da MEXC.');
        return;
      }
      const sellButton = findSellButton();
      if (sellButton) {
        sellButton.click();
      } else {
        sendAlert('Não encontrei "Abrir Short". Verifique se a aba Abrir está ativa.');
      }
    }
    if (context.modes?.closeEnabled) {
      await activateMexcTab('close');
      ensureCloseByQuantity();
      if (!setContracts('close')) {
        sendAlert('Não encontrei o campo Quantidade na aba Fechar da MEXC.');
        return;
      }
      const closeButton = findCloseButton();
      if (closeButton) {
        closeButton.click();
      } else {
        sendAlert('Não encontrei "Fechar Short". Verifique se a aba Fechar está ativa.');
      }
    }
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

  function formatGateQuantity(value) {
    if (!Number.isFinite(value)) return '';
    return value
      .toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8
      })
      .replace(/\./g, '');
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }


  function sendAlert(message) {
    window.postMessage({ type: 'ARBSYNC_ALERT', message }, '*');
    console.warn('[ArbiSync]', message);
  }

  function findGateSubmitButtons() {
    return Array.from(
      document.querySelectorAll(
        '#trading_dom button[data-testid="tr-submit-btn"]'
      )
    );
  }

  async function activateGateTab(tab) {
    const selector = tab === 'sell' ? '#tab-sell' : '#tab-buy';
    const button = document.querySelector(selector);
    if (button) {
      button.click();
      await waitForGateTab(tab);
    }
  }

  async function waitForGateTab(tab) {
    const target = tab === 'sell' ? '#tab-sell' : '#tab-buy';
    const start = Date.now();
    while (Date.now() - start < 1500) {
      const el = document.querySelector(target);
      if (el?.getAttribute('aria-selected') === 'true' || el?.dataset?.active === 'true') {
        return;
      }
      await nextFrame();
    }
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function normalizeSymbol(symbol) {
    if (!symbol) return '';
    return symbol.split('_')[0] || symbol.split('/')[0] || symbol;
  }

  function buildSpotButtonLabels(action, symbolLabel) {
    const verb = action === 'SELL' ? 'Venda' : 'Compra';
    const fallback = action === 'SELL' ? 'Sell' : 'Buy';
    if (!symbolLabel) return [verb, fallback];
    return [`${verb} ${symbolLabel}`, verb, `${fallback} ${symbolLabel}`, fallback];
  }

  function findMexcTab(labels) {
    const tabs = Array.from(
      document.querySelectorAll(
        '[data-testid="contract-trade-order-form-tab-open"], [data-testid="contract-trade-order-form-tab-close"], [role="tab"], button'
      )
    );
    return tabs.find((tab) => {
      if (!isTabButton(tab)) return false;
      return labels.some((label) => tab.textContent?.trim().includes(label));
    });
  }

  async function activateMexcTab(tab) {
    const labels = tab === 'close'
      ? ['Fechar', 'Close']
      : ['Abrir', 'Open'];
    const button =
      document.querySelector(
        tab === 'close'
          ? '[data-testid="contract-trade-order-form-tab-close"]'
          : '[data-testid="contract-trade-order-form-tab-open"]'
      ) || findMexcTab(labels);
    if (button) {
      button.click();
      await waitForMexcTab(button);
    }
  }

  async function waitForMexcTab(button) {
    const start = Date.now();
    while (Date.now() - start < 1500) {
      const selected =
        button.getAttribute('aria-selected') === 'true' ||
        button.dataset?.active === 'true' ||
        button.classList.contains('active') ||
        button.classList.contains('selected');
      if (selected) return;
      await nextFrame();
    }
  }
})();
