// extension/content_mexc.js

console.log('🧩 content_mexc.js carregado');

(function () {
  const OVERLAY_ID = 'arb-assistant-overlay-wrapper';

  function ensureOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const htmlUrl = chrome.runtime.getURL('overlay/panel.html');
    const cssUrl = chrome.runtime.getURL('overlay/panel.css');

    fetch(htmlUrl)
      .then((res) => res.text())
      .then((html) => {
        const wrapper = document.createElement('div');
        wrapper.id = OVERLAY_ID;
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);

        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = cssUrl;
        document.head.appendChild(css);

        const panel = document.getElementById('arb-panel');
        if (panel) panel.style.display = 'block';

        const btn = document.getElementById('confirmBtn');
        if (btn) btn.disabled = true;

        console.log('🟣 Overlay injetado com sucesso');

        setText('askGate', '--');
        setText('bidMexc', '--');
        setText('spread', '--');
        setText('coreStatus', 'CORE: aguardando...');
        setText('riskStatus', 'FILTROS: --');
        setText('conversionStatus', 'FUTUROS: -- contratos');

        setupActions();
        setupDrag();
        setupResize();
        startDomLiquidityPolling();
      })
      .catch((err) => {
        console.error('❌ Falha ao injetar overlay:', err);
      });
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }

  function sendCommand(command) {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: 'UI_COMMAND', command });
    } catch (err) {
      console.warn('Falha ao enviar comando para extensão:', err);
    }
  }

  function setupActions() {
    const saveBtn = document.getElementById('saveSettingsBtn');
    const testBtn = document.getElementById('testBtn');
    const inputs = [
      'spotVolume',
      'futuresContractSize',
      'spreadMin',
      'minVolume',
      'minLiquidity',
      'refreshIntervalMs',
      'slippageMax',
      'slippageEstimate',
      'maxAlertsPerMinute',
      'exposurePerAsset',
      'exposurePerExchange',
      'exposureGlobal',
      'testVolume'
    ];
    inputs.forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('input', () => {
        input.dataset.userEdited = 'true';
      });
    });
    const allowPartial = document.getElementById('allowPartialExecution');
    if (allowPartial) {
      allowPartial.addEventListener('change', () => {
        allowPartial.dataset.userEdited = 'true';
      });
    }
    const openEnabled = document.getElementById('openEnabled');
    const closeEnabled = document.getElementById('closeEnabled');
    [openEnabled, closeEnabled].forEach((el) => {
      if (!el) return;
      el.addEventListener('change', () => {
        el.dataset.userEdited = 'true';
      });
    });
    const readNumber = (id) => {
      const input = document.getElementById(id);
      if (!input) return null;
      const value = Number(input.value);
      return Number.isFinite(value) ? value : null;
    };

    const readSettings = () => ({
      spotVolume: readNumber('spotVolume'),
      futuresContractSize: readNumber('futuresContractSize'),
      spreadMin: readNumber('spreadMin'),
      minVolume: readNumber('minVolume'),
      minLiquidity: readNumber('minLiquidity'),
      refreshIntervalMs: readNumber('refreshIntervalMs'),
      slippageMax: readNumber('slippageMax'),
      slippageEstimate: readNumber('slippageEstimate'),
      maxAlertsPerMinute: readNumber('maxAlertsPerMinute'),
      exposurePerAsset: readNumber('exposurePerAsset'),
      exposurePerExchange: readNumber('exposurePerExchange'),
      exposureGlobal: readNumber('exposureGlobal'),
      allowPartialExecution:
        document.getElementById('allowPartialExecution')?.checked ?? false,
      testVolume: readNumber('testVolume'),
      enableLiveExecution: false,
      executionModes: {
        openEnabled: openEnabled?.checked ?? true,
        closeEnabled: closeEnabled?.checked ?? false
      }
    });

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        sendCommand({ action: 'UPDATE_SETTINGS', settings: readSettings() });
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', () => {
        const settings = readSettings();
        const contractsPreview = Number(
          document.getElementById('conversionStatus')?.dataset.contracts || 0
        );
        window.postMessage(
          {
            type: 'ARBSYNC_TEST_EXECUTION',
            payload: {
              spotVolume: settings.testVolume,
              futuresContracts: settings.testVolume,
              pairGate: testBtn.dataset.pairGate || '',
              pairMexc: testBtn.dataset.pairMexc || '',
              modes: settings.executionModes
            }
          },
          '*'
        );
        sendCommand({ action: 'UPDATE_SETTINGS', settings });
        sendCommand({
          action: 'TEST_EXECUTION',
          volume: settings.testVolume
        });
      });
    }
  }

  function setupDrag() {
    const panel = document.getElementById('arb-panel');
    const handle = panel?.querySelector('.title');
    if (!panel || !handle) return;

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('mousedown', (event) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      const nextLeft = Math.max(0, event.clientX - offsetX);
      const nextTop = Math.max(0, event.clientY - offsetY);
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
      panel.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  function setupResize() {
    const panel = document.getElementById('arb-panel');
    const resizer = panel?.querySelector('.resizer');
    if (!panel || !resizer) return;

    let resizing = false;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;

    resizer.addEventListener('mousedown', (event) => {
      resizing = true;
      const rect = panel.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startWidth = rect.width;
      startHeight = rect.height;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!resizing) return;
      const nextWidth = Math.max(260, startWidth + (event.clientX - startX));
      const nextHeight = Math.max(240, startHeight + (event.clientY - startY));
      panel.style.width = `${nextWidth}px`;
      panel.style.height = `${nextHeight}px`;
    });

    document.addEventListener('mouseup', () => {
      resizing = false;
      document.body.style.userSelect = '';
    });
  }

  function parseNumber(value) {
    if (value == null) return null;
    const cleaned = String(value)
      .replace(/[^\d.,-]/g, '')
      .replace(/\.(?=.*\.)/g, '')
      .replace(',', '.');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function startDomLiquidityPolling() {
    const selectors = {
      askPrice:
        '#mexc-web-inspection-futures-exchange-orderbook > div.market_moduleBody__rui0V > div.market_tableBody__bhNY_ > div.market_asksWrapper__JH8bn > div:nth-child(1) > div:nth-child(9) > div.market_price__V_09X.market_sell__SZ_It > span',
      askVolume:
        '#mexc-web-inspection-futures-exchange-orderbook > div.market_moduleBody__rui0V > div.market_tableBody__bhNY_ > div.market_asksWrapper__JH8bn > div:nth-child(1) > div:nth-child(9) > div.market_vol__M6Ton',
      bidPrice:
        '#mexc-web-inspection-futures-exchange-orderbook > div.market_moduleBody__rui0V > div.market_tableBody__bhNY_ > div.market_bidsWrapper__lt6yB > div:nth-child(1) > div:nth-child(1) > div.market_price__V_09X.market_buy__F9O7S > span',
      bidVolume:
        '#mexc-web-inspection-futures-exchange-orderbook > div.market_moduleBody__rui0V > div.market_tableBody__bhNY_ > div.market_bidsWrapper__lt6yB > div:nth-child(1) > div:nth-child(1) > div.market_vol__M6Ton'
    };

    const last = {
      askPrice: null,
      askVolume: null,
      bidPrice: null,
      bidVolume: null
    };

    const applyDomValues = (values) => {
      const askPrice = values.askPrice ?? last.askPrice;
      const bidPrice = values.bidPrice ?? last.bidPrice;
      const askVolume = values.askVolume ?? last.askVolume;
      const bidVolume = values.bidVolume ?? last.bidVolume;

      if (Number.isFinite(bidPrice)) {
        setText('bidMexc', bidPrice.toFixed(11));
        const bidPriceEl = document.getElementById('mexcBidPrice');
        if (bidPriceEl) bidPriceEl.textContent = bidPrice.toFixed(11);
        last.bidPrice = bidPrice;
      }
      if (Number.isFinite(askPrice)) {
        const askPriceEl = document.getElementById('mexcAskPrice');
        if (askPriceEl) askPriceEl.textContent = askPrice.toFixed(11);
        last.askPrice = askPrice;
      }
      if (Number.isFinite(bidVolume)) {
        const bidVolEl = document.getElementById('mexcBidSize');
        if (bidVolEl) bidVolEl.textContent = bidVolume.toFixed(4);
        last.bidVolume = bidVolume;
      }
      if (Number.isFinite(askVolume)) {
        const askVolEl = document.getElementById('mexcAskSize');
        if (askVolEl) askVolEl.textContent = askVolume.toFixed(4);
        last.askVolume = askVolume;
      }
    };

    const updateFromDom = () => {
      const askPrice = parseNumber(
        document.querySelector(selectors.askPrice)?.textContent
      );
      const askVolume = parseNumber(
        document.querySelector(selectors.askVolume)?.textContent
      );
      const bidPrice = parseNumber(
        document.querySelector(selectors.bidPrice)?.textContent
      );
      const bidVolume = parseNumber(
        document.querySelector(selectors.bidVolume)?.textContent
      );

      applyDomValues({ askPrice, askVolume, bidPrice, bidVolume });

      chrome.runtime?.sendMessage?.({
        type: 'DOM_BOOK',
        payload: {
          source: 'mexc',
          askPrice,
          askVolume,
          bidPrice,
          bidVolume
        }
      });
    };

    updateFromDom();
    const getRefreshInterval = () => {
      const value = Number(
        document.getElementById('refreshIntervalMs')?.value
      );
      return Number.isFinite(value) && value > 0 ? value : 1000;
    };
    let intervalId = setInterval(updateFromDom, getRefreshInterval());
    const refreshInput = document.getElementById('refreshIntervalMs');
    refreshInput?.addEventListener('input', () => {
      clearInterval(intervalId);
      intervalId = setInterval(updateFromDom, getRefreshInterval());
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureOverlay);
  } else {
    ensureOverlay();
  }

  window.addEventListener('message', (event) => {
    if (!event?.data || event.data.type !== 'ARBSYNC_SYNC_READY') return;
    const syncStatus = document.getElementById('syncStatus');
    if (syncStatus) {
      syncStatus.textContent = 'SYNC: Tampermonkey conectado';
    }
  });

  window.addEventListener('message', (event) => {
    if (!event?.data || event.data.type !== 'ARBSYNC_ALERT') return;
    const testStatus = document.getElementById('testStatus');
    const message = event.data.message || 'Falha na execução.';
    if (testStatus) {
      testStatus.textContent = `TESTE: ${message}`;
    }
    if (window.alert) {
      window.alert(message);
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'CORE_STATUS') {
      setText('coreStatus', msg.ok ? 'CORE: conectado' : 'CORE: desconectado');
      return;
    }

    if (msg.type === 'CORE_DATA') {
      const data = msg.data || {};
      const settings = data.settings || {};

      if (typeof data.askGate === 'number') setText('askGate', data.askGate.toFixed(11));
      if (typeof data.bidMexc === 'number') setText('bidMexc', data.bidMexc.toFixed(11));
      if (typeof data.spread === 'number') setText('spread', data.spread.toFixed(3) + '%');
      const spreadOpen = document.getElementById('spreadOpen');
      const spreadClose = document.getElementById('spreadClose');
      if (spreadOpen && typeof data.spread === 'number') {
        spreadOpen.textContent = `${data.spread.toFixed(3)}%`;
        spreadOpen.classList.toggle('positive', data.spread >= 0);
        spreadOpen.classList.toggle('negative', data.spread < 0);
      }
      if (
        spreadClose &&
        typeof data.bidGate === 'number' &&
        typeof data.askMexc === 'number'
      ) {
        const closeSpread =
          ((data.bidGate - data.askMexc) / data.askMexc) * 100;
        spreadClose.textContent = `${closeSpread.toFixed(3)}%`;
        spreadClose.classList.toggle('positive', closeSpread >= 0);
        spreadClose.classList.toggle('negative', closeSpread < 0);
      }

      const liquidityOpen = document.getElementById('liquidityOpen');
      const liquidityClose = document.getElementById('liquidityClose');
      const gateAskSize = document.getElementById('gateAskSize');
      const gateBidSize = document.getElementById('gateBidSize');
      const mexcBidSize = document.getElementById('mexcBidSize');
      const mexcAskSize = document.getElementById('mexcAskSize');
      const gateAskPrice = document.getElementById('gateAskPrice');
      const gateBidPrice = document.getElementById('gateBidPrice');
      const mexcBidPrice = document.getElementById('mexcBidPrice');
      const mexcAskPrice = document.getElementById('mexcAskPrice');
      const minLiquidity = Number(settings.minLiquidity);
      const hasMinLiquidity = Number.isFinite(minLiquidity) && minLiquidity > 0;
      const formatLiquidity = (value) =>
        Number.isFinite(value) ? value.toFixed(4) : '--';
      const formatPrice = (value) =>
        Number.isFinite(value) ? value.toFixed(11) : '--';
      const setLiquidityStatus = (el, label, leftSize, rightSize) => {
        if (!el) return;
        el.classList.remove('positive', 'negative');
        if (!hasMinLiquidity) {
          el.textContent = `LIQUIDEZ ${label}: sem mínimo`;
          return;
        }
        if (!Number.isFinite(leftSize) || !Number.isFinite(rightSize)) {
          el.textContent = `LIQUIDEZ ${label}: aguardando`;
          return;
        }
        const enough = leftSize >= minLiquidity && rightSize >= minLiquidity;
        el.textContent = `LIQUIDEZ ${label}: ${enough ? 'OK' : 'INSUFICIENTE'} (${formatLiquidity(
          leftSize
        )}/${formatLiquidity(rightSize)})`;
        el.classList.add(enough ? 'positive' : 'negative');
      };
      const gateAskQty = Number(data.gateAskSize);
      const gateBidQty = Number(data.gateBidSize);
      const mexcBidQty = Number(data.mexcBidSize);
      const mexcAskQty = Number(data.mexcAskSize);
      const gateAskPx = Number(data.askGate);
      const gateBidPx = Number(data.bidGate);
      const mexcBidPx = Number(data.bidMexc);
      const mexcAskPx = Number(data.askMexc);
      setLiquidityStatus(
        liquidityOpen,
        'ENTRADA',
        gateAskQty,
        mexcBidQty
      );
      setLiquidityStatus(
        liquidityClose,
        'SAÍDA',
        gateBidQty,
        mexcAskQty
      );
      if (gateAskSize && Number.isFinite(gateAskQty)) {
        gateAskSize.textContent = formatLiquidity(gateAskQty);
      }
      if (gateBidSize && Number.isFinite(gateBidQty)) {
        gateBidSize.textContent = formatLiquidity(gateBidQty);
      }
      if (mexcBidSize && Number.isFinite(mexcBidQty)) {
        mexcBidSize.textContent = formatLiquidity(mexcBidQty);
      }
      if (mexcAskSize && Number.isFinite(mexcAskQty)) {
        mexcAskSize.textContent = formatLiquidity(mexcAskQty);
      }
      if (gateAskPrice && Number.isFinite(gateAskPx)) {
        gateAskPrice.textContent = formatPrice(gateAskPx);
      }
      if (gateBidPrice && Number.isFinite(gateBidPx)) {
        gateBidPrice.textContent = formatPrice(gateBidPx);
      }
      if (mexcBidPrice && Number.isFinite(mexcBidPx)) {
        mexcBidPrice.textContent = formatPrice(mexcBidPx);
      }
      if (mexcAskPrice && Number.isFinite(mexcAskPx)) {
        mexcAskPrice.textContent = formatPrice(mexcAskPx);
      }

      const riskStatus = document.getElementById('riskStatus');
      if (riskStatus) {
        const reasons = data.alert?.reasons?.length
          ? data.alert.reasons.join(', ')
          : 'OK';
        riskStatus.textContent = `FILTROS: ${reasons}`;
      }

      const testStatus = document.getElementById('testStatus');
      if (testStatus && data.lastTestExecution?.at) {
        const time = new Date(data.lastTestExecution.at).toLocaleTimeString();
        const volume = data.lastTestExecution.volume ?? '--';
        const status = data.lastTestExecution.status ?? 'PENDING';
        testStatus.textContent = `TESTE: ${volume} @ ${time} (${status})`;
      }

      const conversionStatus = document.getElementById('conversionStatus');
      if (conversionStatus) {
        const contracts = data.alert?.futuresContracts ?? 0;
        conversionStatus.textContent = `FUTUROS: ${contracts.toFixed(4)} contratos`;
        conversionStatus.dataset.contracts = String(contracts);
      }

      const syncStatus = document.getElementById('syncStatus');
      if (syncStatus) {
        syncStatus.textContent = 'SYNC: pronto para Tampermonkey';
      }

      const panel = document.getElementById('arb-panel');
      if (panel) {
        panel.classList.toggle('signal', !!data.signal);
      }

      const updateInput = (id, value) => {
        const input = document.getElementById(id);
        if (!input) return;
        if (input.dataset.userEdited === 'true') return;
        if (value === null || value === undefined) return;
        input.value = value;
      };

      updateInput('spotVolume', settings.spotVolume);
      updateInput('futuresContractSize', settings.futuresContractSize);
      updateInput('spreadMin', settings.spreadMin);
      updateInput('minVolume', settings.minVolume);
      updateInput('minLiquidity', settings.minLiquidity);
      updateInput('refreshIntervalMs', settings.refreshIntervalMs);
      updateInput('slippageMax', settings.slippageMax);
      updateInput('slippageEstimate', settings.slippageEstimate);
      updateInput('maxAlertsPerMinute', settings.maxAlertsPerMinute);
      updateInput('exposurePerAsset', settings.exposurePerAsset);
      updateInput('exposurePerExchange', settings.exposurePerExchange);
      updateInput('exposureGlobal', settings.exposureGlobal);
      updateInput('testVolume', settings.testVolume);
      const testBtn = document.getElementById('testBtn');
      if (testBtn) {
        testBtn.dataset.pairGate = data.pairGate || '';
        testBtn.dataset.pairMexc = data.pairMexc || '';
      }
      const allowPartialInput = document.getElementById('allowPartialExecution');
      if (allowPartialInput && allowPartialInput.dataset.userEdited !== 'true') {
        allowPartialInput.checked = !!settings.allowPartialExecution;
      }
      if (settings.executionModes) {
        const openEnabled = document.getElementById('openEnabled');
        const closeEnabled = document.getElementById('closeEnabled');
        if (openEnabled && openEnabled.dataset.userEdited !== 'true') {
          openEnabled.checked = !!settings.executionModes.openEnabled;
        }
        if (closeEnabled && closeEnabled.dataset.userEdited !== 'true') {
          closeEnabled.checked = !!settings.executionModes.closeEnabled;
        }
      }
    }

    if (msg.type === 'DOM_BOOK' && msg.payload?.source === 'gate') {
      const askPrice = Number(msg.payload.askPrice);
      const bidPrice = Number(msg.payload.bidPrice);
      const askVolume = Number(msg.payload.askVolume);
      const bidVolume = Number(msg.payload.bidVolume);

      const gateAskPrice = document.getElementById('gateAskPrice');
      const gateBidPrice = document.getElementById('gateBidPrice');
      const gateAskSize = document.getElementById('gateAskSize');
      const gateBidSize = document.getElementById('gateBidSize');

      if (gateAskPrice && Number.isFinite(askPrice)) {
        gateAskPrice.textContent = askPrice.toFixed(11);
      }
      if (gateBidPrice && Number.isFinite(bidPrice)) {
        gateBidPrice.textContent = bidPrice.toFixed(11);
      }
      if (gateAskSize && Number.isFinite(askVolume)) {
        gateAskSize.textContent = askVolume.toFixed(4);
      }
      if (gateBidSize && Number.isFinite(bidVolume)) {
        gateBidSize.textContent = bidVolume.toFixed(4);
      }
    }
  });
})();
