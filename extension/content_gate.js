// extension/content_gate.js

console.log('🧩 content_gate.js carregado');

(function () {
  const OVERLAY_ID = 'arb-assistant-overlay-wrapper';
  const EXCHANGE = 'GATE';
  const GROUP_STORAGE_KEY = 'arbsync_group';
  const AUTO_EXECUTION_COOLDOWN_FALLBACK_MS = 7000;
  const MIN_GATE_ORDER_USDT = 1;
  const MEXC_MIN_QTY_STEP = 10;
  let lastDomBookUpdate = 0;
  const lastAutoExecution = { open: 0, close: 0, rebalance: 0 };
  const executionLog = { open: null, close: null };
  const logEntries = [];
  const LOG_MAX_ENTRIES = 200;
  const LOG_THROTTLE_MS = 2000;
  const lastLogByMessage = new Map();
  const OVERLAY_ZOOM_STORAGE_KEY = 'arbsync_overlay_zoom';
  const domBookCache = {
    gate: { askPrice: null, askVolume: null, bidPrice: null, bidVolume: null },
    mexc: { askPrice: null, askVolume: null, bidPrice: null, bidVolume: null }
  };
  let currentGroup = sessionStorage.getItem(GROUP_STORAGE_KEY) || '';
  const latestPairs = { gate: '', mexc: '' };
  const exposureState = {
    exchange: EXCHANGE,
    asset: null,
    gateQty: null,
    mexcQty: null,
    gateAvg: null,
    mexcAvg: null
  };
  let lastLimitStatusMessage = null;
  let latestSettings = {};

  function safeStorageGet(key) {
    return new Promise((resolve) => {
      const status = document.getElementById('storageStatus');
      try {
        chrome.storage.local.get([key], (result) => {
          if (status) status.textContent = 'STORAGE: OK';
          resolve(result?.[key]);
        });
      } catch {
        if (status) status.textContent = 'STORAGE: FALHOU';
        resolve(null);
      }
    });
  }

  function safeStorageSet(payload) {
    return new Promise((resolve) => {
      const status = document.getElementById('storageStatus');
      try {
        chrome.storage.local.set(payload, () => {
          if (status) status.textContent = 'STORAGE: OK';
          resolve(true);
        });
      } catch {
        if (status) status.textContent = 'STORAGE: FALHOU';
        resolve(false);
      }
    });
  }

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

        setupActions();
        setupDrag();
        setupResize();
        startDomLiquidityPolling();
        startExposurePolling();
        ensureGateMarketTab();
        startPairSync();
        sendRuntimeMessage({ type: 'REQUEST_CORE_STATUS' }).then((response) => {
          if (response?.ok === true) {
            setText('coreStatus', 'CORE: conectado');
          } else if (response?.ok === false) {
            setText('coreStatus', 'CORE: desconectado');
          }
        });
        setupMinimize();
        setupOverlayZoom();
        setupTabs();
        registerTab();
        updateLogEmptyState();
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

  function setupTabs() {
    const tabButtons = Array.from(
      document.querySelectorAll('#arb-panel .panel-tab[data-tab-target]')
    );
    const tabContents = Array.from(
      document.querySelectorAll('#arb-panel .panel-tab-content')
    );
    if (!tabButtons.length || !tabContents.length) return;

    const activateTab = (target) => {
      tabButtons.forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.tabTarget === target);
      });
      tabContents.forEach((content) => {
        content.classList.toggle(
          'is-active',
          content.dataset.tabContent === target
        );
      });
    };

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        activateTab(btn.dataset.tabTarget);
      });
    });

    activateTab(tabButtons.find((btn) => btn.classList.contains('is-active'))?.dataset.tabTarget || 'trading');
  }

  function updateLogEmptyState() {
    const emptyState = document.getElementById('arb-log-empty');
    const list = document.getElementById('arb-log-list');
    if (!emptyState || !list) return;
    emptyState.style.display = list.children.length ? 'none' : 'block';
  }

  function appendLogEntry(entry) {
    if (!entry) return;
    const list = document.getElementById('arb-log-list');
    if (!list) return;
    const time = new Date(entry.at || Date.now());
    const timeLabel = time.toLocaleTimeString('pt-BR');
    const item = document.createElement('div');
    item.className = `log-entry ${entry.level ? `is-${entry.level}` : ''}`.trim();
    item.innerHTML = `<span class="log-time">${timeLabel}</span><span class="log-message">${entry.message}</span>`;
    list.insertBefore(item, list.firstChild);
    logEntries.push(entry);
    while (logEntries.length > LOG_MAX_ENTRIES) {
      logEntries.shift();
      list.removeChild(list.lastChild);
    }
    updateLogEmptyState();
  }

  function broadcastLogEntry(message, level = 'info') {
    if (!message) return;
    const now = Date.now();
    const lastAt = lastLogByMessage.get(message);
    if (Number.isFinite(lastAt) && now - lastAt < LOG_THROTTLE_MS) {
      return;
    }
    lastLogByMessage.set(message, now);
    const entry = {
      message,
      level,
      at: Date.now(),
      source: EXCHANGE
    };
    appendLogEntry(entry);
    sendRuntimeMessage({ type: 'EXECUTION_LOG', payload: { logEntry: entry } });
  }

  function setupMinimize() {
    const panel = document.getElementById('arb-panel');
    const minimizeBtn = document.getElementById('minimizeOverlayBtn');
    const minimizedToggle = document.getElementById('arb-minimized-toggle');
    if (!panel || !minimizeBtn || !minimizedToggle) return;

    const applyState = (minimized) => {
      if (!panel.dataset.displayBefore) {
        panel.dataset.displayBefore = panel.style.display || 'block';
      }
      panel.style.display = minimized ? 'none' : panel.dataset.displayBefore;
      minimizedToggle.classList.toggle('show', minimized);
      minimizedToggle.style.display = minimized ? 'inline-flex' : 'none';
    };

    minimizeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyState(true);
    });

    minimizedToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyState(false);
    });

    applyState(false);
  }

  function applyOverlayZoom(scale) {
    const panel = document.getElementById('arb-panel');
    if (!panel) return;
    panel.style.transform = `scale(${scale})`;
    panel.style.transformOrigin = 'top right';
  }

  function setupOverlayZoom() {
    const panel = document.getElementById('arb-panel');
    const zoomInput = document.getElementById('overlayZoom');
    const zoomValue = document.getElementById('overlayZoomValue');
    if (!panel || !zoomInput || !zoomValue) return;
    const stored = Number(localStorage.getItem(OVERLAY_ZOOM_STORAGE_KEY));
    const initial = Number.isFinite(stored) && stored > 0 ? stored : 100;
    zoomInput.value = String(initial);
    zoomValue.textContent = `${initial}%`;
    applyOverlayZoom(initial / 100);

    zoomInput.addEventListener('input', () => {
      const next = Number(zoomInput.value);
      if (!Number.isFinite(next)) return;
      zoomValue.textContent = `${next}%`;
      localStorage.setItem(OVERLAY_ZOOM_STORAGE_KEY, String(next));
      applyOverlayZoom(next / 100);
    });
  }

  function sendCommand(command) {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: 'UI_COMMAND', command });
    } catch (err) {
      console.warn('Falha ao enviar comando para extensão:', err);
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, resolve);
      } catch (err) {
        console.warn('Falha ao enviar mensagem para extensão:', err);
        resolve(null);
      }
    });
  }

  function normalizeGroup(value) {
    return String(value || '').trim();
  }

  function updateLinkStatus(status) {
    const linkStatus = document.getElementById('linkStatus');
    if (!linkStatus) return;
    const group = normalizeGroup(status?.group || currentGroup);
    if (!group) {
      linkStatus.textContent = 'LINK: defina um grupo para vincular SPOT + FUTUROS';
      return;
    }
    const hasGate = !!status?.hasGate;
    const hasMexc = !!status?.hasMexc;
    const gateLabel = `Gate ${hasGate ? '✅' : '❌'}`;
    const mexcLabel = `MEXC ${hasMexc ? '✅' : '❌'}`;
    linkStatus.textContent = `LINK: ${group} · ${gateLabel} | ${mexcLabel}`;
  }

  async function registerTab(groupValue) {
    const normalized = normalizeGroup(groupValue ?? currentGroup);
    currentGroup = normalized;
    sessionStorage.setItem(GROUP_STORAGE_KEY, currentGroup);
    const response = await sendRuntimeMessage({
      type: 'REGISTER_TAB',
      exchange: EXCHANGE,
      group: currentGroup
    });
    if (response?.status) {
      updateLinkStatus(response.status);
    } else {
      updateLinkStatus({ group: currentGroup, hasGate: true, hasMexc: false });
    }
  }

  function setupActions() {
    const testBtn = document.getElementById('testBtn');
    const syncExecutionEnabled = document.getElementById('syncExecutionEnabled');
    const arbGroupInput = document.getElementById('arbGroup');
    const linkTabsBtn = document.getElementById('linkTabsBtn');
    const usePairBtn = document.getElementById('usePairBtn');
    let settingsTimer = null;
    const inputs = [
      'spotVolume',
      'spreadMinOpen',
      'spreadMinClose',
      'minLiquidityOpen',
      'minLiquidityClose',
      'autoExecutionCooldownMs',
      'refreshIntervalMs',
      'submitDelayMs',
      'exposurePerAsset',
      'exposurePerExchange',
      'exposureGlobal',
      'autoCloseProfitPercent',
      'autoCloseProfitUsdt',
      'autoCloseMinutes',
      'testVolume'
    ];
    inputs.forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('input', () => {
        input.dataset.userEdited = 'true';
        scheduleSettingsUpdate();
      });
    });
    const allowPartial = document.getElementById('allowPartialExecution');
    if (allowPartial) {
      allowPartial.addEventListener('change', () => {
        allowPartial.dataset.userEdited = 'true';
        allowPartial.dataset.userEditedAt = String(Date.now());
        scheduleSettingsUpdate();
      });
    }
    const liveExecution = document.getElementById('enableLiveExecution');
    if (liveExecution) {
      liveExecution.addEventListener('change', () => {
        liveExecution.dataset.userEdited = 'true';
        liveExecution.dataset.userEditedAt = String(Date.now());
        scheduleSettingsUpdate();
      });
    }
    if (syncExecutionEnabled) {
      syncExecutionEnabled.addEventListener('change', () => {
        syncExecutionEnabled.dataset.userEdited = 'true';
        syncExecutionEnabled.dataset.userEditedAt = String(Date.now());
        scheduleSettingsUpdate();
      });
    }
    const limitToTopLiquidity = document.getElementById('limitToTopLiquidity');
    if (limitToTopLiquidity) {
      limitToTopLiquidity.addEventListener('change', () => {
        limitToTopLiquidity.dataset.userEdited = 'true';
        limitToTopLiquidity.dataset.userEditedAt = String(Date.now());
        scheduleSettingsUpdate();
      });
    }
    const enableAutoRebalance = document.getElementById('enableAutoRebalance');
    if (enableAutoRebalance) {
      enableAutoRebalance.addEventListener('change', () => {
        enableAutoRebalance.dataset.userEdited = 'true';
        enableAutoRebalance.dataset.userEditedAt = String(Date.now());
        scheduleSettingsUpdate();
      });
    }
    const openEnabled = document.getElementById('openEnabled');
    const closeEnabled = document.getElementById('closeEnabled');
    [openEnabled, closeEnabled].forEach((el) => {
      if (!el) return;
      el.addEventListener('change', () => {
        el.dataset.userEdited = 'true';
        el.dataset.userEditedAt = String(Date.now());
        scheduleSettingsUpdate();
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
      spreadMinOpen: readNumber('spreadMinOpen'),
      spreadMinClose: readNumber('spreadMinClose'),
      minLiquidityOpen: readNumber('minLiquidityOpen'),
      minLiquidityClose: readNumber('minLiquidityClose'),
      refreshIntervalMs: readNumber('refreshIntervalMs'),
      submitDelayMs: readNumber('submitDelayMs'),
      exposurePerAsset: readNumber('exposurePerAsset'),
      exposurePerExchange: readNumber('exposurePerExchange'),
      exposureGlobal: readNumber('exposureGlobal'),
      autoCloseProfitPercent: readNumber('autoCloseProfitPercent'),
      autoCloseProfitUsdt: readNumber('autoCloseProfitUsdt'),
      autoCloseMinutes: readNumber('autoCloseMinutes'),
      limitToTopLiquidity:
        document.getElementById('limitToTopLiquidity')?.checked ?? false,
      enableAutoRebalance:
        document.getElementById('enableAutoRebalance')?.checked ?? false,
      allowPartialExecution:
        document.getElementById('allowPartialExecution')?.checked ?? false,
      testVolume: readNumber('testVolume'),
      enableLiveExecution: liveExecution?.checked ?? false,
      autoExecutionCooldownMs: readNumber('autoExecutionCooldownMs'),
      syncTestExecution: syncExecutionEnabled?.checked ?? false,
      executionModes: {
        openEnabled: openEnabled?.checked ?? true,
        closeEnabled: closeEnabled?.checked ?? false
      }
    });

    const sendSettingsNow = () => {
      const settings = readSettings();
      sendCommand({ action: 'UPDATE_SETTINGS', settings });
    };

    const scheduleSettingsUpdate = () => {
      if (settingsTimer) {
        clearTimeout(settingsTimer);
      }
      settingsTimer = setTimeout(() => {
        sendSettingsNow();
        settingsTimer = null;
      }, 150);
    };

    if (testBtn) {
      testBtn.addEventListener('click', () => {
        const settings = readSettings();
        const payload = {
          spotVolume: settings.testVolume,
          futuresContracts: settings.testVolume,
          pairGate: testBtn.dataset.pairGate || '',
          pairMexc: testBtn.dataset.pairMexc || '',
          modes: settings.executionModes,
          submitDelayMs: settings.submitDelayMs
        };
        const group = normalizeGroup(arbGroupInput?.value);
        const shouldSync = syncExecutionEnabled?.checked ?? false;
        if (shouldSync) {
          sendRuntimeMessage({
            type: 'SYNC_TEST_EXECUTION',
            payload,
            group
          }).then((response) => {
            if (response?.status) updateLinkStatus(response.status);
            if (!response?.ok) {
              const testStatus = document.getElementById('testStatus');
              if (testStatus) {
                const reason =
                  response?.reason === 'NO_GROUP'
                    ? 'defina um grupo para sincronizar'
                    : 'aba SPOT/FUTUROS vinculada não encontrada';
                testStatus.textContent = `TESTE: ${reason}`;
              }
            }
          });
        } else {
          window.postMessage(
            {
              type: 'ARBSYNC_TEST_EXECUTION',
              payload
            },
            '*'
          );
        }
        sendCommand({ action: 'UPDATE_SETTINGS', settings });
        sendCommand({
          action: 'TEST_EXECUTION',
          volume: settings.testVolume
        });
      });
    }

    if (arbGroupInput) {
      arbGroupInput.value = currentGroup;
    }

    if (linkTabsBtn) {
      linkTabsBtn.addEventListener('click', async () => {
        const group = normalizeGroup(arbGroupInput?.value);
        const response = await sendRuntimeMessage({
          type: 'UPDATE_GROUP',
          exchange: EXCHANGE,
          group
        });
        currentGroup = group;
        sessionStorage.setItem(GROUP_STORAGE_KEY, currentGroup);
        updateLinkStatus(response?.status || { group, hasGate: true, hasMexc: false });
      });
    }

    if (usePairBtn) {
      usePairBtn.addEventListener('click', () => {
        const suggestion = [latestPairs.gate, latestPairs.mexc]
          .filter(Boolean)
          .join('-');
        if (arbGroupInput) {
          arbGroupInput.value = suggestion || arbGroupInput.value;
          arbGroupInput.focus();
        }
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

  function floorToStep(value, step) {
    if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
    return Math.floor(value / step) * step;
  }

  function ceilToStep(value, step) {
    if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
    return Math.ceil(value / step) * step;
  }

  function isGateNotionalOk(volume, price) {
    if (!Number.isFinite(volume) || !Number.isFinite(price)) return false;
    return volume * price >= MIN_GATE_ORDER_USDT;
  }

  function formatTokenQtyForLog(value) {
    if (!Number.isFinite(value)) return '--';
    const floored = Math.floor(value);
    return floored.toLocaleString('pt-BR');
  }

  function buildOpenDecisionReason(useTopLiquidity, gateAskQty, mexcBidQty) {
    if (!useTopLiquidity) {
      return 'Compra baseada no volume configurado.';
    }
    return `Compra baseada no menor volume do 1º nível (Gate ${formatTokenQtyForLog(
      gateAskQty
    )} x MEXC ${formatTokenQtyForLog(mexcBidQty)}).`;
  }

  function buildCloseDecisionReason(useTopLiquidity, gateBidQty, mexcAskQty) {
    if (!useTopLiquidity) {
      return 'Fechamento baseado no volume configurado.';
    }
    return `Fechamento baseado no menor volume do 1º nível (Gate ${formatTokenQtyForLog(
      gateBidQty
    )} x MEXC ${formatTokenQtyForLog(mexcAskQty)}).`;
  }

  function parseNumber(value) {
    if (value == null) return null;
    let cleaned = String(value).replace(/[^\d.,kKmM-]/g, '');
    let multiplier = 1;
    const suffix = cleaned.slice(-1).toLowerCase();
    if (suffix === 'k') {
      multiplier = 1000;
      cleaned = cleaned.slice(0, -1);
    } else if (suffix === 'm') {
      multiplier = 1_000_000;
      cleaned = cleaned.slice(0, -1);
    }
    cleaned = cleaned.replace(/\.(?=.*\.)/g, '').replace(',', '.');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed * multiplier : null;
  }

  function formatNumber(value, digits = 4) {
    return Number.isFinite(value) ? value.toFixed(digits) : '--';
  }

  function parseLocaleNumber(value) {
    if (value == null) return null;
    const raw = String(value).replace(/\s+/g, '');
    let cleaned = raw.replace(/[^\d,.-]/g, '');
    if (cleaned.includes(',') && cleaned.includes('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      const lastComma = cleaned.lastIndexOf(',');
      const lastDot = cleaned.lastIndexOf('.');
      if (lastComma !== -1 && lastDot === -1) {
        const fraction = cleaned.slice(lastComma + 1);
        if (fraction.length === 3) {
          cleaned = cleaned.replace(/,/g, '');
        } else {
          cleaned = cleaned.replace(/,/g, '.');
        }
      } else if (lastDot !== -1 && lastComma === -1) {
        const fraction = cleaned.slice(lastDot + 1);
        if (fraction.length === 3) {
          cleaned = cleaned.replace(/\./g, '');
        }
      } else if (lastComma !== -1 && lastDot !== -1) {
        const decimalIndex = Math.max(lastComma, lastDot);
        const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
        const fractionalPart = cleaned.slice(decimalIndex + 1).replace(/[.,]/g, '');
        cleaned = `${integerPart}.${fractionalPart}`;
      } else {
        cleaned = cleaned.replace(/[.,]/g, '');
      }
    }
    const parsed = Number(cleaned.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseTokenAmount(value) {
    if (!value) return { qty: null, asset: null };
    const cleaned = String(value).replace(/\s+/g, ' ').trim();
    const parts = cleaned.split(' ');
    const qty = parseLocaleNumber(parts[0]);
    const asset = parts.slice(1).join(' ').trim() || null;
    return { qty, asset };
  }

  function ensureGateMarketTab() {
    const tab = document.querySelector('#tab-marketPrice > span > span');
    if (tab) tab.click();
  }

  function getPairFromGateUrl() {
    const match = window.location.pathname.match(/\/trade\/([^/?#]+)/);
    if (!match) return null;
    return match[1].toUpperCase();
  }

  function getAssetFromPair(pair) {
    if (!pair) return null;
    const base = pair.split('_')[0] || pair.split('/')[0];
    return base ? base.toUpperCase() : null;
  }

  function syncPairFromUrl() {
    const pair = getPairFromGateUrl();
    if (!pair) return;
    if (latestPairs.gate === pair) return;
    latestPairs.gate = pair;
    exposureState.asset = getAssetFromPair(pair) || exposureState.asset;
    updateActiveAssetLabel();
    sendCommand({
      action: 'UPDATE_SETTINGS',
      settings: {
        pairGate: pair
      }
    });
  }

  let lastPath = '';
  function startPairSync() {
    const check = () => {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        syncPairFromUrl();
      }
    };
    check();
    setInterval(check, 1000);
  }

  function extractGateExposure(expectedAsset) {
    const selectors = [
      '#trade-assets-container > div > div.flex.flex-col.gap-3.pt-4 > div:nth-child(2)',
      '#trade-assets-container [class*="asset"]',
      '#trade-assets-container'
    ];
    const texts = selectors
      .map((selector) => document.querySelector(selector))
      .filter(Boolean)
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    const exposureStatus = document.getElementById('exposureStatus');
    if (!texts.length) {
      if (exposureStatus) {
        exposureStatus.dataset.base = 'EXPOSIÇÃO: aguardando...';
        exposureStatus.textContent = exposureStatus.dataset.base;
      }
      return null;
    }
    const assetHint = expectedAsset?.toUpperCase?.() || null;
    let matched = null;
    for (const text of texts) {
      if (assetHint) {
        const assetMatch = text.match(
          new RegExp(`([\\d.,]+)\\s*${assetHint}\\b`, 'i')
        );
        if (assetMatch) {
          matched = { text, qty: assetMatch[1], asset: assetHint };
          break;
        }
        const reversedMatch = text.match(
          new RegExp(`${assetHint}\\b[^\\d]*([\\d.,]+)`, 'i')
        );
        if (reversedMatch) {
          matched = { text, qty: reversedMatch[1], asset: assetHint };
          break;
        }
      }
      const genericMatch = text.match(/([\d.,]+)\s*([A-Za-z0-9-]+)/);
      if (genericMatch) {
        matched = { text, qty: genericMatch[1], asset: genericMatch[2] };
        break;
      }
    }
    const rawText = matched?.text || texts[0];
    if (exposureStatus) {
      exposureStatus.dataset.base = `EXPOSIÇÃO: raw="${rawText}"`;
      exposureStatus.textContent = exposureStatus.dataset.base;
    }
    if (!matched) return null;
    const qty = parseLocaleNumber(matched.qty);
    const asset = matched.asset;
    if (exposureStatus) {
      exposureStatus.dataset.base =
        `EXPOSIÇÃO: raw="${rawText}" parsedQty="${qty ?? 'n/d'}" asset="${asset ?? 'n/d'}"`;
      exposureStatus.textContent = exposureStatus.dataset.base;
    }
    if (!Number.isFinite(qty) || !asset) return null;
    return { qty, asset };
  }

  let gateHistoryToggleState = null;
  let gateHistoryToggleAt = 0;
  function refreshGateTradeHistory() {
    const now = Date.now();
    if (now - gateHistoryToggleAt < 1500) {
      return;
    }
    const oneDayButton = document.querySelector(
      '#orderPanel > div > div.flex.flex-col.w-full.h-full.relative.box-border.overflow-auto.transition-height.duration-400.ease-linear.text-body-s > div.flex.items-center.my-3.mx-4 > div.flex.gap-2 > div:nth-child(1)'
    );
    const sevenDayButton = document.querySelector(
      '#orderPanel > div > div.flex.flex-col.w-full.h-full.relative.box-border.overflow-auto.transition-height.duration-400.ease-linear.text-body-s > div.flex.items-center.my-3.mx-4 > div.flex.gap-2 > div:nth-child(2)'
    );
    if (oneDayButton && sevenDayButton) {
      if (!gateHistoryToggleState) {
        gateHistoryToggleState = '1d';
      }
      gateHistoryToggleState = gateHistoryToggleState === '1d' ? '7d' : '1d';
      const target = gateHistoryToggleState === '1d' ? oneDayButton : sevenDayButton;
      target.click();
      gateHistoryToggleAt = now;
      return;
    }
    const checkboxInput = document.querySelector('#mantine-7tgjuotkn');
    const checkboxRoot = document.querySelector(
      '#multiCurrencyMarginModeSpotStep3 > div.flex.gap-4.items-center.mr-0.h-full.cursor-pointer > div'
    );
    const isChecked = () => {
      if (checkboxInput) return checkboxInput.checked;
      if (!checkboxRoot) return null;
      const dataChecked = checkboxRoot.getAttribute('data-checked');
      if (dataChecked === 'true') return true;
      if (dataChecked === 'false') return false;
      return checkboxRoot.dataset.checked === 'true';
    };
    const current = isChecked();
    if (current === null) return;
    if (gateHistoryToggleState === null) {
      gateHistoryToggleState = current;
    }
    gateHistoryToggleState = !gateHistoryToggleState;
    const target = checkboxInput || checkboxRoot;
    if (!target) return;
    if (current !== gateHistoryToggleState) {
      target.click();
      gateHistoryToggleAt = now;
    }
  }

  function extractGateTrades() {
    const rows = Array.from(
      document.querySelectorAll(
        '#orderPanel table tbody tr'
      )
    );
    return rows.map((row) => {
      const cells = row.querySelectorAll('td');
      const market = cells[0]?.textContent?.trim() || '';
      const side = cells[1]?.textContent?.trim() || '';
      const priceText = cells[2]?.textContent?.trim() || '';
      const qtyText = cells[3]?.textContent?.trim() || '';
      const timeText = cells[5]?.textContent?.trim() || '';
      const asset = market.split('/')[0]?.trim();
      const price = parseLocaleNumber(priceText);
      const qty = parseLocaleNumber(qtyText);
      return {
        asset,
        side,
        price,
        qty,
        time: timeText
      };
    });
  }

  function computeGateAveragePrice(asset, exposureQty, trades) {
    if (!Number.isFinite(exposureQty) || exposureQty <= 0) return null;
    let remaining = exposureQty;
    let cost = 0;
    let filled = 0;
    for (const trade of trades) {
      if (!trade || trade.asset !== asset) continue;
      if (!Number.isFinite(trade.qty) || !Number.isFinite(trade.price)) continue;
      const side = trade.side.toLowerCase();
      const isBuy =
        side.includes('compra') || side.includes('buy') || side.includes('long');
      const isSell =
        side.includes('venda') || side.includes('sell') || side.includes('short');
      if (isSell) {
        remaining += trade.qty;
        continue;
      }
      if (!isBuy) continue;
      const used = Math.min(trade.qty, remaining);
      cost += used * trade.price;
      filled += used;
      remaining -= used;
      if (remaining <= 0) break;
    }
    if (filled <= 0) return null;
    return cost / filled;
  }

  async function persistExposureSnapshot(exchange, asset, qty, avgPrice) {
    if (!asset || !Number.isFinite(qty)) return;
    const normalizedAsset = asset.toUpperCase();
    const current = (await safeStorageGet('arbsync_exposure')) || {};
    const exchangeData = current[exchange] || {};
    exchangeData[normalizedAsset] = {
      qty,
      avgPrice: Number.isFinite(avgPrice) ? avgPrice : null,
      updatedAt: Date.now()
    };
    current[exchange] = exchangeData;
    await safeStorageSet({ arbsync_exposure: current });
  }

  async function readExposureSnapshot() {
    return (await safeStorageGet('arbsync_exposure')) || {};
  }

  function updatePositionPanel(snapshot) {
    if (!snapshot) return;
    const { spotVolume, futuresContracts } = snapshot;
    const spotEl = document.getElementById('positionSpotVolume');
    const futuresEl = document.getElementById('positionFuturesContracts');
    if (spotEl) spotEl.textContent = formatNumber(spotVolume, 4);
    if (futuresEl) futuresEl.textContent = formatNumber(futuresContracts, 4);

    const open = executionLog.open;
    const close = executionLog.close;
    const openGate = document.getElementById('openGatePrice');
    const openMexc = document.getElementById('openMexcPrice');
    const openVolume = document.getElementById('openVolume');
    const openSpread = document.getElementById('openSpread');
    const closeGate = document.getElementById('closeGatePrice');
    const closeMexc = document.getElementById('closeMexcPrice');
    const closeVolume = document.getElementById('closeVolume');
    const closeSpread = document.getElementById('closeSpread');

    if (openGate) openGate.textContent = formatNumber(open?.gatePrice, 11);
    if (openMexc) openMexc.textContent = formatNumber(open?.mexcPrice, 11);
    if (openVolume) openVolume.textContent = formatNumber(open?.spotVolume, 4);
    if (openSpread) openSpread.textContent = formatNumber(open?.spread, 3) + '%';
    if (closeGate) closeGate.textContent = formatNumber(close?.gatePrice, 11);
    if (closeMexc) closeMexc.textContent = formatNumber(close?.mexcPrice, 11);
    if (closeVolume) closeVolume.textContent = formatNumber(close?.spotVolume, 4);
    if (closeSpread) closeSpread.textContent = formatNumber(close?.spread, 3) + '%';

  }

  function updateExposurePanel(settings) {
    const baseAsset = exposureState.asset || getAssetFromPair(latestPairs.gate);
    const updateLimitStatus = (gateQty, mexcQty) => {
      const status = document.getElementById('limitStatus');
      if (!status) return;
      const perExchangeLimit = Number(settings.exposurePerExchange);
      const perAssetLimit = Number(settings.exposurePerAsset);
      const globalLimit = Number(settings.exposureGlobal);
      const total = Math.abs(Number(gateQty) || 0) + Math.abs(Number(mexcQty) || 0);
      const reasons = [];
      if (
        Number.isFinite(perExchangeLimit) &&
        perExchangeLimit > 0 &&
        Math.abs(Number(gateQty) || 0) > perExchangeLimit
      ) {
        reasons.push('EXCHANGE');
      }
      if (
        Number.isFinite(perAssetLimit) &&
        perAssetLimit > 0 &&
        total > perAssetLimit
      ) {
        reasons.push('ATIVO');
      }
      if (
        Number.isFinite(globalLimit) &&
        globalLimit > 0 &&
        total > globalLimit
      ) {
        reasons.push('GLOBAL');
      }
      const nextMessage =
        reasons.length > 0
          ? `LIMITES: ${reasons.join(', ')} atingido(s)`
          : 'LIMITES: OK';
      status.textContent = nextMessage;
      if (nextMessage !== lastLimitStatusMessage) {
        if (reasons.length > 0) {
          broadcastLogEntry(
            `Limites atingidos: ${reasons.join(', ')}.`,
            'warn'
          );
        } else if (lastLimitStatusMessage && lastLimitStatusMessage !== 'LIMITES: OK') {
          broadcastLogEntry('Limites normalizados.', 'info');
        }
        lastLimitStatusMessage = nextMessage;
      }
    };
    const renderWith = (
      gateQty,
      mexcQty,
      gateAvg,
      mexcAvg
    ) => {
      const formatQty = (value) => {
        if (!Number.isFinite(value)) return '--';
        const floored = Math.floor(value * 100) / 100;
        return floored.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      };
      const formatAvg = (value) =>
        Number.isFinite(value) ? value.toFixed(6) : '--';
      const formatSpread = (value) =>
        Number.isFinite(value) ? `${value.toFixed(3)}%` : '--';

      const setQty = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        const label = id === 'exposureGateQty' ? 'GATE' : 'MEXC';
        el.textContent = `${label}: ${formatQty(value)}`;
      };
      const setAvg = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = `Médio: ${formatAvg(value)}`;
      };
      const setTotalSpread = (value) => {
        const el = document.getElementById('exposureTotalSpread');
        if (!el) return;
        el.textContent = formatSpread(value);
      };
      const setPnl = (value) => {
        const el = document.getElementById('exposurePnl');
        if (!el) return;
        el.textContent = Number.isFinite(value) ? value.toFixed(6) : '--';
      };

      setQty('exposureGateQty', gateQty);
      setQty('exposureMexcQty', mexcQty);
      setAvg('exposureGateAvg', gateAvg);
      setAvg('exposureMexcAvg', mexcAvg);
      const totalSpread =
        Number.isFinite(gateAvg) && Number.isFinite(mexcAvg) && gateAvg > 0
          ? ((mexcAvg - gateAvg) / gateAvg) * 100
          : null;
      setTotalSpread(totalSpread);
      const matchedQty = Math.min(
        Math.abs(Number(gateQty) || 0),
        Math.abs(Number(mexcQty) || 0)
      );
      const pnl =
        Number.isFinite(gateAvg) &&
        Number.isFinite(mexcAvg) &&
        Number.isFinite(matchedQty)
          ? (mexcAvg - gateAvg) * matchedQty
          : null;
      setPnl(pnl);
      updateLimitStatus(gateQty, mexcQty);
    };

    if (!baseAsset) {
      renderWith(0, 0, null, null);
      return;
    }

    readExposureSnapshot().then((snapshot) => {
      const gate = snapshot.GATE || {};
      const mexc = snapshot.MEXC || {};
      const assetKey = baseAsset?.toUpperCase() || baseAsset;
      const storedGateQty = Number(gate[assetKey]?.qty) || 0;
      let gateQty = storedGateQty;
      let mexcQty = Number(mexc[assetKey]?.qty) || 0;
      let gateAvg = Number(gate[assetKey]?.avgPrice);
      const mexcAvg = Number(mexc[assetKey]?.avgPrice);
      if (gateQty === 0) {
        const fallback = extractGateExposure(assetKey);
        if (fallback) {
          const normalizedAsset = fallback.asset.toUpperCase();
          exposureState.asset = normalizedAsset;
          updateActiveAssetLabel();
          const fallbackTrades = extractGateTrades();
          const avgPrice = computeGateAveragePrice(
            normalizedAsset,
            fallback.qty,
            fallbackTrades
          );
          gateQty = fallback.qty;
          gateAvg = Number.isFinite(avgPrice) ? avgPrice : gateAvg;
          persistExposureSnapshot(EXCHANGE, normalizedAsset, gateQty, avgPrice);
        }
      }
      const exposureStatus = document.getElementById('exposureStatus');
      if (exposureStatus) {
        const base = exposureStatus.dataset.base || 'EXPOSIÇÃO: --';
        const fallbackNote =
          gateQty !== storedGateQty ? ` fallbackQty="${gateQty}"` : '';
        exposureStatus.textContent =
          `${base} storage[${assetKey}] gateQty="${storedGateQty}" mexcQty="${mexcQty}"${fallbackNote}`;
      }
      exposureState.gateQty = gateQty;
      exposureState.mexcQty = mexcQty;
      exposureState.gateAvg = gateAvg;
      exposureState.mexcAvg = mexcAvg;
      renderWith(gateQty, mexcQty, gateAvg, mexcAvg);
    });
  }

  function updateActiveAssetLabel() {
    const asset = exposureState.asset || getAssetFromPair(latestPairs.gate);
    const el = document.getElementById('activeAsset');
    if (!el) return;
    el.textContent = asset ? `(${asset})` : '--';
  }

  function syncExecutionLog(payload) {
    if (!payload) return;
    if (payload.open) {
      executionLog.open = payload.open;
      if (!executionLog.open.at) {
        executionLog.open.at = Date.now();
      }
    }
    if (payload.close) {
      executionLog.close = payload.close;
    }
    if (payload.logEntry) {
      appendLogEntry(payload.logEntry);
    }
    updatePositionPanel(payload.snapshot || {});
  }

  function startExposurePolling() {
    const poll = () => {
      const exposure = extractGateExposure(exposureState.asset);
      if (!exposure) return;
      const normalizedAsset = exposure.asset.toUpperCase();
      exposureState.asset = normalizedAsset;
      updateActiveAssetLabel();
      const trades = extractGateTrades();
      const avgPrice = computeGateAveragePrice(
        normalizedAsset,
        exposure.qty,
        trades
      );
      persistExposureSnapshot(EXCHANGE, normalizedAsset, exposure.qty, avgPrice)
        .then(() => updateExposurePanel(latestSettings));
    };
    poll();
    setInterval(poll, 3000);
  }

  function startDomLiquidityPolling() {
    const selectors = {
      askPrice:
        '#market-list-calc-height > div.react-grid-layout.layout.trade-grid-layout > div:nth-child(4) > div > div.h-full.w-full.flex.flex-col.bg-bg-primary > div.flex-1.overflow-hidden > div > div.text-sm.font-medium.px-4.h-full.overflow-hidden > div > div.flex-1.relative > div > div > div:nth-child(1) > div.styled__PriceItem-sc-802dfbfa-4.fACNWh, #market-list-calc-height > div.react-grid-layout.layout.trade-grid-layout > div:nth-child(4) > div > div.h-full.w-full.flex.flex-col.bg-bg-primary > div.flex-1.overflow-hidden > div > div.text-sm.font-medium.px-4.h-full.overflow-hidden > div > div.flex-1.relative > div > div > div:nth-child(1) > div.styled__PriceItem-sc-1206421-4.bBfmlX',
      askVolume:
        '#market-list-calc-height > div.react-grid-layout.layout.trade-grid-layout > div:nth-child(4) > div > div.h-full.w-full.flex.flex-col.bg-bg-primary > div.flex-1.overflow-hidden > div > div.text-sm.font-medium.px-4.h-full.overflow-hidden > div > div.flex-1.relative > div > div > div:nth-child(1) > div.styled__AmountItem-sc-802dfbfa-6.IXbhq, #market-list-calc-height > div.react-grid-layout.layout.trade-grid-layout > div:nth-child(4) > div > div.h-full.w-full.flex.flex-col.bg-bg-primary > div.flex-1.overflow-hidden > div > div.text-sm.font-medium.px-4.h-full.overflow-hidden > div > div.flex-1.relative > div > div > div:nth-child(1) > div.styled__AmountItem-sc-1206421-6.fZWbYE',
      bidPrice:
        '#market-list-calc-height > div.react-grid-layout.layout.trade-grid-layout > div:nth-child(4) > div > div.h-full.w-full.flex.flex-col.bg-bg-primary > div.flex-1.overflow-hidden > div > div.text-sm.font-medium.px-4.h-full.overflow-hidden > div > div:nth-child(3) > div > div > div:nth-child(1) > div.styled__PriceItem-sc-802dfbfa-4.ecPgvl, #market-list-calc-height > div.react-grid-layout.layout.trade-grid-layout > div:nth-child(4) > div > div.h-full.w-full.flex.flex-col.bg-bg-primary > div.flex-1.overflow-hidden > div > div.text-sm.font-medium.px-4.h-full.overflow-hidden > div > div:nth-child(3) > div > div > div:nth-child(1) > div.styled__PriceItem-sc-1206421-4.khGgGv',
      bidVolume:
        '#market-list-calc-height > div.react-grid-layout.layout.trade-grid-layout > div:nth-child(4) > div > div.h-full.w-full.flex.flex-col.bg-bg-primary > div.flex-1.overflow-hidden > div > div.text-sm.font-medium.px-4.h-full.overflow-hidden > div > div:nth-child(3) > div > div > div:nth-child(1) > div.styled__AmountItem-sc-802dfbfa-6.IXbhq, #market-list-calc-height > div.react-grid-layout.layout.trade-grid-layout > div:nth-child(4) > div > div.h-full.w-full.flex.flex-col.bg-bg-primary > div.flex-1.overflow-hidden > div > div.text-sm.font-medium.px-4.h-full.overflow-hidden > div > div:nth-child(3) > div > div > div:nth-child(1) > div.styled__AmountItem-sc-1206421-6.fZWbYE'
    };

    const fallbackSelectors = {
      askPrice:
        '#trade-container-spot-orderbook-asks .orderbook-list-item:nth-child(1) .price, #trade-container-spot-orderbook-asks .orderbook-row:nth-child(1) .price, #trade-container-spot-orderbook-asks li:nth-child(1) .price',
      askVolume:
        '#trade-container-spot-orderbook-asks .orderbook-list-item:nth-child(1) .amount, #trade-container-spot-orderbook-asks .orderbook-row:nth-child(1) .amount, #trade-container-spot-orderbook-asks li:nth-child(1) .amount',
      bidPrice:
        '#trade-container-spot-orderbook-bids .orderbook-list-item:nth-child(1) .price, #trade-container-spot-orderbook-bids .orderbook-row:nth-child(1) .price, #trade-container-spot-orderbook-bids li:nth-child(1) .price',
      bidVolume:
        '#trade-container-spot-orderbook-bids .orderbook-list-item:nth-child(1) .amount, #trade-container-spot-orderbook-bids .orderbook-row:nth-child(1) .amount, #trade-container-spot-orderbook-bids li:nth-child(1) .amount'
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

      if (Number.isFinite(askPrice)) {
        setText('askGate', askPrice.toFixed(11));
        const askPriceEl = document.getElementById('gateAskPrice');
        if (askPriceEl) askPriceEl.textContent = askPrice.toFixed(11);
        last.askPrice = askPrice;
        lastDomBookUpdate = Date.now();
        domBookCache.gate.askPrice = askPrice;
      }
      if (Number.isFinite(bidPrice)) {
        const bidEl = document.getElementById('gateBidPrice');
        if (bidEl) bidEl.textContent = bidPrice.toFixed(11);
        last.bidPrice = bidPrice;
        lastDomBookUpdate = Date.now();
        domBookCache.gate.bidPrice = bidPrice;
      }
      if (Number.isFinite(askVolume)) {
        const askVolEl = document.getElementById('gateAskSize');
        if (askVolEl) askVolEl.textContent = askVolume.toFixed(4);
        last.askVolume = askVolume;
        lastDomBookUpdate = Date.now();
        domBookCache.gate.askVolume = askVolume;
      }
      if (Number.isFinite(bidVolume)) {
        const bidVolEl = document.getElementById('gateBidSize');
        if (bidVolEl) bidVolEl.textContent = bidVolume.toFixed(4);
        last.bidVolume = bidVolume;
        lastDomBookUpdate = Date.now();
        domBookCache.gate.bidVolume = bidVolume;
      }
    };

    const updateFromDom = () => {
      const askPrice = parseNumber(
        document.querySelector(selectors.askPrice)?.textContent ??
          document.querySelector(fallbackSelectors.askPrice)?.textContent
      );
      const askVolume = parseNumber(
        document.querySelector(selectors.askVolume)?.textContent ??
          document.querySelector(fallbackSelectors.askVolume)?.textContent
      );
      const bidPrice = parseNumber(
        document.querySelector(selectors.bidPrice)?.textContent ??
          document.querySelector(fallbackSelectors.bidPrice)?.textContent
      );
      const bidVolume = parseNumber(
        document.querySelector(selectors.bidVolume)?.textContent ??
          document.querySelector(fallbackSelectors.bidVolume)?.textContent
      );

      applyDomValues({ askPrice, askVolume, bidPrice, bidVolume });

      chrome.runtime?.sendMessage?.({
        type: 'DOM_BOOK',
        payload: {
          source: 'gate',
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
    document.addEventListener('DOMContentLoaded', () => {
      ensureOverlay();
      refreshGateTradeHistory();
    });
  } else {
    ensureOverlay();
    refreshGateTradeHistory();
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
    broadcastLogEntry(`Falha na execução: ${message}`, 'error');
    if (window.alert) {
      window.alert(message);
    }
  });

  

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'RUN_TEST_EXECUTION') {
      const payload = msg.payload || {};
      window.postMessage(
        {
          type: 'ARBSYNC_TEST_EXECUTION',
          payload
        },
        '*'
      );
      refreshGateTradeHistory();
      return;
    }

    if (msg.type === 'CORE_STATUS') {
      setText('coreStatus', msg.ok ? 'CORE: conectado' : 'CORE: desconectado');
      return;
    }

    if (msg.type === 'CORE_DATA') {
      const data = msg.data || {};
      const settings = data.settings || {};
      latestSettings = settings;
      updateActiveAssetLabel();

      const bestGateAsk = Number.isFinite(domBookCache.gate.askPrice)
        ? domBookCache.gate.askPrice
        : Number(data.askGate);
      const bestGateBid = Number.isFinite(domBookCache.gate.bidPrice)
        ? domBookCache.gate.bidPrice
        : Number(data.bidGate);
      const bestMexcBid = Number.isFinite(domBookCache.mexc.bidPrice)
        ? domBookCache.mexc.bidPrice
        : Number(data.bidMexc);
      const bestMexcAsk = Number.isFinite(domBookCache.mexc.askPrice)
        ? domBookCache.mexc.askPrice
        : Number(data.askMexc);
      const computedOpenSpread =
        Number.isFinite(bestGateAsk) && Number.isFinite(bestMexcBid)
          ? ((bestMexcBid - bestGateAsk) / bestGateAsk) * 100
          : null;
      if (Number.isFinite(bestGateAsk)) setText('askGate', bestGateAsk.toFixed(11));
      if (Number.isFinite(bestMexcBid)) setText('bidMexc', bestMexcBid.toFixed(11));
      if (Number.isFinite(computedOpenSpread)) {
        setText('spread', computedOpenSpread.toFixed(3) + '%');
      }
      const spreadOpen = document.getElementById('spreadOpen');
      const spreadClose = document.getElementById('spreadClose');
      if (spreadOpen && Number.isFinite(computedOpenSpread)) {
        spreadOpen.textContent = `${computedOpenSpread.toFixed(3)}%`;
        spreadOpen.classList.toggle('positive', computedOpenSpread >= 0);
        spreadOpen.classList.toggle('negative', computedOpenSpread < 0);
      }
      if (
        spreadClose &&
        Number.isFinite(bestGateBid) &&
        Number.isFinite(bestMexcAsk)
      ) {
        const closeSpread =
          ((bestGateBid - bestMexcAsk) / bestMexcAsk) * 100;
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
      const minLiquidityOpen = Number(
        settings.minLiquidityOpen ?? settings.minLiquidity
      );
      const minLiquidityClose = Number(
        settings.minLiquidityClose ?? settings.minLiquidity
      );
      const formatLiquidity = (value) =>
        Number.isFinite(value) ? value.toFixed(4) : '--';
      const formatPrice = (value) =>
        Number.isFinite(value) ? value.toFixed(11) : '--';
      const setLiquidityStatus = (
        el,
        label,
        leftSize,
        rightSize,
        minLiquidity,
        leftPrice,
        rightPrice
      ) => {
        if (!el) return;
        el.classList.remove('positive', 'negative');
        if (!Number.isFinite(minLiquidity) || minLiquidity <= 0) {
          el.textContent = `LIQUIDEZ ${label}: sem mínimo`;
          return;
        }
        if (!Number.isFinite(leftSize) || !Number.isFinite(rightSize)) {
          el.textContent = `LIQUIDEZ ${label}: aguardando`;
          return;
        }
        const enough = leftSize >= minLiquidity && rightSize >= minLiquidity;
        const leftUsd =
          Number.isFinite(leftPrice) && Number.isFinite(leftSize)
            ? leftPrice * leftSize
            : null;
        const rightUsd =
          Number.isFinite(rightPrice) && Number.isFinite(rightSize)
            ? rightPrice * rightSize
            : null;
        const formatUsd = (value) =>
          Number.isFinite(value) ? value.toFixed(2) : '--';
        el.textContent = `LIQUIDEZ ${label}: ${enough ? 'OK' : 'INSUFICIENTE'} (${formatLiquidity(
          leftSize
        )}/${formatLiquidity(rightSize)}) | ${formatUsd(leftUsd)}/${formatUsd(rightUsd)} USDT`;
        el.classList.add(enough ? 'positive' : 'negative');
      };
      const gateAskQty =
        domBookCache.gate.askVolume ?? Number(data.gateAskSize);
      const gateBidQty =
        domBookCache.gate.bidVolume ?? Number(data.gateBidSize);
      const mexcBidQty =
        domBookCache.mexc.bidVolume ?? Number(data.mexcBidSize);
      const mexcAskQty =
        domBookCache.mexc.askVolume ?? Number(data.mexcAskSize);
      const gateAskPx = Number(data.askGate);
      const gateBidPx = Number(data.bidGate);
      const mexcBidPx = Number(data.bidMexc);
      const mexcAskPx = Number(data.askMexc);
      setLiquidityStatus(
        liquidityOpen,
        'ENTRADA',
        gateAskQty,
        mexcBidQty,
        minLiquidityOpen,
        gateAskPx,
        mexcBidPx
      );
      setLiquidityStatus(
        liquidityClose,
        'SAÍDA',
        gateBidQty,
        mexcAskQty,
        minLiquidityClose,
        gateBidPx,
        mexcAskPx
      );
      const domFresh = Date.now() - lastDomBookUpdate < 3000;
      if (!domFresh) {
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
      }

      const autoExecutionEnabled = !!settings.enableLiveExecution;
      const rebalanceEnabled = !!settings.enableAutoRebalance;
      if (autoExecutionEnabled || rebalanceEnabled) {
        const executionModes = settings.executionModes || {};
        const openModeEnabled = !!executionModes.openEnabled;
        const closeModeEnabled = !!executionModes.closeEnabled;
        const spreadOpen = Number.isFinite(data.spread) ? data.spread : null;
        const spreadClose = Number.isFinite(gateBidPx) && Number.isFinite(mexcAskPx)
          ? ((gateBidPx - mexcAskPx) / mexcAskPx) * 100
          : null;
        const spreadMinOpen = Number(settings.spreadMinOpen ?? settings.spreadMin);
        const spreadMinClose = Number(settings.spreadMinClose ?? settings.spreadMin);
        const hasSpreadMinOpen =
          Number.isFinite(spreadMinOpen) && spreadMinOpen > 0;
        const hasSpreadMinClose =
          Number.isFinite(spreadMinClose) && spreadMinClose > 0;
        const openSpreadOk =
          !hasSpreadMinOpen ||
          (Number.isFinite(spreadOpen) && spreadOpen >= spreadMinOpen);
        const closeSpreadOk =
          !hasSpreadMinClose ||
          (Number.isFinite(spreadClose) && spreadClose <= spreadMinClose);
        const openLiquidityOk =
          !Number.isFinite(minLiquidityOpen) ||
          minLiquidityOpen <= 0 ||
          (Number.isFinite(gateAskQty) &&
            Number.isFinite(mexcBidQty) &&
            gateAskQty >= minLiquidityOpen &&
            mexcBidQty >= minLiquidityOpen);
        const closeLiquidityOk =
          !Number.isFinite(minLiquidityClose) ||
          minLiquidityClose <= 0 ||
          (Number.isFinite(gateBidQty) &&
            Number.isFinite(mexcAskQty) &&
            gateBidQty >= minLiquidityClose &&
            mexcAskQty >= minLiquidityClose);
        const reasons = data.alert?.reasons || [];
        const openEligible = reasons.length === 0;
        const closeEligible =
          reasons.filter((reason) => reason !== 'spread_min').length === 0;
        const now = Date.now();
        const autoCooldownMs = Number(settings.autoExecutionCooldownMs);
        const cooldownMs =
          Number.isFinite(autoCooldownMs) && autoCooldownMs > 0
            ? autoCooldownMs
            : AUTO_EXECUTION_COOLDOWN_FALLBACK_MS;
        const openCooldownOk =
          now - lastAutoExecution.open >= cooldownMs;
        const closeCooldownOk =
          now - lastAutoExecution.close >= cooldownMs;
        const rebalanceCooldownOk =
          now - lastAutoExecution.rebalance >= cooldownMs;
        const currentGateQty = Math.abs(Number(exposureState.gateQty) || 0);
        const currentMexcQty = Math.abs(Number(exposureState.mexcQty) || 0);
        const projectedGateQty = currentGateQty + Number(settings.spotVolume || 0);
        const projectedMexcQty = currentMexcQty + Number(settings.spotVolume || 0);
        const projectedPerAsset = projectedGateQty + projectedMexcQty;
        const projectedGlobal = projectedPerAsset;
        const perExchangeLimit = Number(settings.exposurePerExchange);
        const perAssetLimit = Number(settings.exposurePerAsset);
        const globalLimit = Number(settings.exposureGlobal);
        const withinPerExchange =
          !Number.isFinite(perExchangeLimit) ||
          perExchangeLimit <= 0 ||
          projectedGateQty <= perExchangeLimit;
        const withinPerAsset =
          !Number.isFinite(perAssetLimit) ||
          perAssetLimit <= 0 ||
          projectedPerAsset <= perAssetLimit;
        const withinGlobal =
          !Number.isFinite(globalLimit) ||
          globalLimit <= 0 ||
          projectedGlobal <= globalLimit;
        const exposureOk = withinPerExchange && withinPerAsset && withinGlobal;
        const closePositionQty = currentMexcQty;
        const hasCloseExposure = currentGateQty > 0;
        const profitPercentTarget = Number(settings.autoCloseProfitPercent);
        const profitUsdtTarget = Number(settings.autoCloseProfitUsdt);
        const timeTargetMinutes = Number(settings.autoCloseMinutes);
        const currentGateAvg = Number(exposureState.gateAvg);
        const currentMexcAvg = Number(exposureState.mexcAvg);
        const closeMatchedQty = Math.min(currentGateQty, currentMexcQty);
        const closeSpreadPercent =
          Number.isFinite(currentGateAvg) && Number.isFinite(currentMexcAvg) && currentGateAvg > 0
            ? ((currentMexcAvg - currentGateAvg) / currentGateAvg) * 100
            : null;
        const closePnl =
          Number.isFinite(currentGateAvg) &&
          Number.isFinite(currentMexcAvg) &&
          Number.isFinite(closeMatchedQty)
            ? (currentMexcAvg - currentGateAvg) * closeMatchedQty
            : null;
        const profitPercentOk =
          Number.isFinite(profitPercentTarget) &&
          profitPercentTarget > 0 &&
          Number.isFinite(closeSpreadPercent) &&
          closeSpreadPercent >= profitPercentTarget;
        const profitUsdtOk =
          Number.isFinite(profitUsdtTarget) &&
          profitUsdtTarget > 0 &&
          Number.isFinite(closePnl) &&
          closePnl >= profitUsdtTarget;
        const openAt = executionLog.open?.at;
        const timeOk =
          Number.isFinite(timeTargetMinutes) &&
          timeTargetMinutes > 0 &&
          Number.isFinite(openAt) &&
          now - openAt >= timeTargetMinutes * 60 * 1000;
        const closeForced = profitPercentOk || profitUsdtOk || timeOk;
        const rebalanceDelta =
          Number.isFinite(currentGateQty) && Number.isFinite(currentMexcQty)
            ? currentMexcQty - currentGateQty
            : null;
        const rebalanceNeeded =
          rebalanceEnabled &&
          Number.isFinite(rebalanceDelta) &&
          Math.abs(rebalanceDelta) > 0.0001;
        let rebalanceHandled = false;

        if (rebalanceNeeded) {
          const targetExchange = rebalanceDelta > 0 ? 'GATE' : 'MEXC';
          const deltaVolume = Math.abs(rebalanceDelta);
          if (!rebalanceCooldownOk) {
            broadcastLogEntry(
              `Auto-rebalance aguardando cooldown. Diferença atual: ${formatTokenQtyForLog(deltaVolume)} tokens.`,
              'warn'
            );
            rebalanceHandled = true;
          } else if (targetExchange === 'GATE') {
            if (!isGateNotionalOk(deltaVolume, gateAskPx)) {
              broadcastLogEntry(
                `Auto-rebalance ignorado: ordem na Gate abaixo de ${MIN_GATE_ORDER_USDT} USDT (${formatTokenQtyForLog(
                  deltaVolume
                )} tokens).`,
                'warn'
              );
              rebalanceHandled = true;
            } else {
              const payload = {
                spotVolume: deltaVolume,
                futuresContracts: 0,
                pairGate: data.pairGate || '',
                pairMexc: data.pairMexc || '',
                modes: {
                  openEnabled: true,
                  closeEnabled: false
                },
                submitDelayMs: settings.submitDelayMs
              };
              const group = normalizeGroup(
                document.getElementById('arbGroup')?.value || currentGroup
              );
              broadcastLogEntry(
                `Auto-rebalance: comprando ${formatTokenQtyForLog(
                  deltaVolume
                )} tokens na Gate para igualar a MEXC.`,
                'success'
              );
              sendRuntimeMessage({
                type: 'SYNC_LIVE_EXECUTION',
                payload,
                group
              }).then((response) => {
                if (response?.status) updateLinkStatus(response.status);
              });
              lastAutoExecution.rebalance = now;
              refreshGateTradeHistory();
              rebalanceHandled = true;
            }
          } else if (targetExchange === 'MEXC') {
            const normalizedVolume = floorToStep(deltaVolume, MEXC_MIN_QTY_STEP);
            if (normalizedVolume <= 0) {
              broadcastLogEntry(
                `Auto-rebalance ignorado: diferença abaixo do mínimo de ${MEXC_MIN_QTY_STEP} tokens na MEXC.`,
                'warn'
              );
              rebalanceHandled = true;
            } else {
              const payload = {
                spotVolume: 0,
                futuresContracts: normalizedVolume,
                pairGate: data.pairGate || '',
                pairMexc: data.pairMexc || '',
                modes: {
                  openEnabled: true,
                  closeEnabled: false
                },
                submitDelayMs: settings.submitDelayMs
              };
              const group = normalizeGroup(
                document.getElementById('arbGroup')?.value || currentGroup
              );
              broadcastLogEntry(
                `Auto-rebalance: abrindo ${formatTokenQtyForLog(
                  normalizedVolume
                )} contratos na MEXC para igualar a Gate.`,
                'success'
              );
              sendRuntimeMessage({
                type: 'SYNC_LIVE_EXECUTION',
                payload,
                group
              }).then((response) => {
                if (response?.status) updateLinkStatus(response.status);
              });
              lastAutoExecution.rebalance = now;
              rebalanceHandled = true;
            }
          }
        }

        const shouldAutoOpen =
          autoExecutionEnabled &&
          openModeEnabled &&
          openEligible &&
          openSpreadOk &&
          openLiquidityOk &&
          openCooldownOk &&
          exposureOk;
        const shouldAutoClose =
          autoExecutionEnabled &&
          closeModeEnabled &&
          hasCloseExposure &&
          closeEligible &&
          (closeForced || (closeSpreadOk && closeLiquidityOk)) &&
          closeCooldownOk;

        if (!rebalanceHandled && (shouldAutoOpen || shouldAutoClose)) {
          const spotVolume = Number(settings.spotVolume);
          const useTopLiquidity = !!settings.limitToTopLiquidity;
          const remainingPerExchange =
            Number.isFinite(perExchangeLimit) && perExchangeLimit > 0
              ? Math.max(perExchangeLimit - currentGateQty, 0)
              : Infinity;
          const remainingPerAsset =
            Number.isFinite(perAssetLimit) && perAssetLimit > 0
              ? Math.max(perAssetLimit - (currentGateQty + currentMexcQty), 0)
              : Infinity;
          const remainingGlobal =
            Number.isFinite(globalLimit) && globalLimit > 0
              ? Math.max(globalLimit - (currentGateQty + currentMexcQty), 0)
              : Infinity;
          const remainingLimit = Math.min(
            remainingPerExchange,
            remainingPerAsset,
            remainingGlobal
          );
          const openTopVolume = useTopLiquidity
            ? Math.min(gateAskQty, mexcBidQty, remainingLimit)
            : spotVolume;
          const closeTopVolume = useTopLiquidity
            ? Math.min(gateBidQty, mexcAskQty)
            : spotVolume;
          if (shouldAutoOpen) {
            const selectedVolume = openTopVolume;
            const normalizedVolume = floorToStep(
              selectedVolume,
              MEXC_MIN_QTY_STEP
            );
            if (normalizedVolume <= 0) {
              broadcastLogEntry(
                `Ordem OPEN ignorada: volume abaixo do mínimo de ${MEXC_MIN_QTY_STEP} tokens.`,
                'warn'
              );
            } else if (!isGateNotionalOk(normalizedVolume, gateAskPx)) {
              broadcastLogEntry(
                `Ordem OPEN ignorada: valor abaixo de ${MIN_GATE_ORDER_USDT} USDT (${formatTokenQtyForLog(
                  normalizedVolume
                )} tokens).`,
                'warn'
              );
            } else {
              const reason = buildOpenDecisionReason(
                useTopLiquidity,
                gateAskQty,
                mexcBidQty
              );
              broadcastLogEntry(
                `Compra de ${formatTokenQtyForLog(
                  normalizedVolume
                )} tokens: ${reason}`,
                'info'
              );
              const logPayload = {
                open: {
                  gatePrice: gateAskPx,
                  mexcPrice: mexcBidPx,
                  spotVolume: normalizedVolume,
                  futuresContracts: normalizedVolume,
                  spread: spreadOpen,
                  at: now
                },
                close: null,
                snapshot: {
                  spotVolume: normalizedVolume,
                  futuresContracts: normalizedVolume
                }
              };
              syncExecutionLog(logPayload);
              sendRuntimeMessage({ type: 'EXECUTION_LOG', payload: logPayload });
              const payload = {
                spotVolume: normalizedVolume,
                futuresContracts: normalizedVolume,
                pairGate: data.pairGate || '',
                pairMexc: data.pairMexc || '',
                modes: {
                  openEnabled: true,
                  closeEnabled: false
                },
                submitDelayMs: settings.submitDelayMs
              };
              const group = normalizeGroup(
                document.getElementById('arbGroup')?.value || currentGroup
              );
              broadcastLogEntry(
                `Ordem OPEN enviada: ${formatTokenQtyForLog(
                  normalizedVolume
                )} tokens (Gate @ ${formatNumber(
                  gateAskPx,
                  6
                )}).`,
                'success'
              );
              sendRuntimeMessage({
                type: 'SYNC_LIVE_EXECUTION',
                payload,
                group
              }).then((response) => {
                if (response?.status) updateLinkStatus(response.status);
              });
              lastAutoExecution.open = now;
              refreshGateTradeHistory();
            }
          }
          if (shouldAutoClose) {
            const selectedVolume = closeTopVolume;
            const gateAvailable = Math.abs(Number(exposureState.gateQty) || 0);
            const effectiveGateBidPx = Number.isFinite(gateBidPx)
              ? gateBidPx
              : domBookCache.gate.bidPrice;
            const minGateReserveTokens =
              Number.isFinite(effectiveGateBidPx) && effectiveGateBidPx > 0
                ? MIN_GATE_ORDER_USDT / effectiveGateBidPx
                : 0;
            let gateSpotVolume;
            const wantsFullClose = selectedVolume >= gateAvailable;
            if (wantsFullClose && isGateNotionalOk(gateAvailable, effectiveGateBidPx)) {
              gateSpotVolume = gateAvailable;
            } else {
              gateSpotVolume = Math.min(selectedVolume, gateAvailable);
            }
            let closeContracts = Math.min(gateSpotVolume, closePositionQty);
            const allowFullClose =
              wantsFullClose && isGateNotionalOk(gateAvailable, effectiveGateBidPx);
            if (
              !allowFullClose &&
              Number.isFinite(minGateReserveTokens) &&
              minGateReserveTokens > 0 &&
              closeContracts > gateAvailable - minGateReserveTokens
            ) {
              const maxClosable = Math.max(gateAvailable - minGateReserveTokens, 0);
              const adjustedClose = floorToStep(maxClosable, MEXC_MIN_QTY_STEP);
              if (adjustedClose <= 0) {
                broadcastLogEntry(
                  `Ordem CLOSE ajustada para manter saldo mínimo na Gate (${formatTokenQtyForLog(
                    minGateReserveTokens
                  )} tokens).`,
                  'info'
                );
              } else if (adjustedClose < closeContracts) {
                closeContracts = adjustedClose;
                broadcastLogEntry(
                  `Ordem CLOSE ajustada para manter saldo mínimo na Gate (${formatTokenQtyForLog(
                    minGateReserveTokens
                  )} tokens).`,
                  'info'
                );
              }
            }
            const mexcContracts = allowFullClose
              ? Math.min(closePositionQty, ceilToStep(closeContracts, MEXC_MIN_QTY_STEP))
              : Math.min(closePositionQty, closeContracts);
            if (mexcContracts > closeContracts) {
              broadcastLogEntry(
                `Ordem CLOSE ajustada para a MEXC: ${formatTokenQtyForLog(
                  closeContracts
                )} tokens na Gate / ${formatTokenQtyForLog(
                  mexcContracts
                )} contratos na MEXC.`,
                'info'
              );
            }
            if (mexcContracts < MEXC_MIN_QTY_STEP) {
              broadcastLogEntry(
                `Ordem CLOSE ignorada: volume abaixo do mínimo de ${MEXC_MIN_QTY_STEP} tokens ou reserva mínima na Gate.`,
                'warn'
              );
            } else if (!isGateNotionalOk(closeContracts, effectiveGateBidPx)) {
              broadcastLogEntry(
                `Ordem CLOSE ignorada: valor abaixo de ${MIN_GATE_ORDER_USDT} USDT (${formatTokenQtyForLog(
                  closeContracts
                )} tokens).`,
                'warn'
              );
            } else {
              const reason = buildCloseDecisionReason(
                useTopLiquidity,
                gateBidQty,
                mexcAskQty
              );
              broadcastLogEntry(
                `Fechamento de ${formatTokenQtyForLog(
                  closeContracts
                )} tokens: ${reason}`,
                'info'
              );
              const logPayload = {
                open: null,
                close: {
                  gatePrice: gateBidPx,
                  mexcPrice: mexcAskPx,
                  spotVolume: closeContracts,
                  futuresContracts: mexcContracts,
                  spread: spreadClose
                },
                snapshot: {
                  spotVolume: closeContracts,
                  futuresContracts: mexcContracts
                }
              };
              syncExecutionLog(logPayload);
              sendRuntimeMessage({ type: 'EXECUTION_LOG', payload: logPayload });
              const payload = {
                spotVolume: closeContracts,
                futuresContracts: mexcContracts,
                pairGate: data.pairGate || '',
                pairMexc: data.pairMexc || '',
                modes: {
                  openEnabled: false,
                  closeEnabled: true
                },
                submitDelayMs: settings.submitDelayMs
              };
              const group = normalizeGroup(
                document.getElementById('arbGroup')?.value || currentGroup
              );
              broadcastLogEntry(
                `Ordem CLOSE enviada: ${formatNumber(
                  closeContracts,
                  4
                )} tokens (Gate @ ${formatNumber(
                  gateBidPx,
                  6
                )}) / ${formatNumber(mexcContracts, 4)} contratos (MEXC).`,
                'success'
              );
              sendRuntimeMessage({
                type: 'SYNC_LIVE_EXECUTION',
                payload,
                group
              }).then((response) => {
                if (response?.status) updateLinkStatus(response.status);
              });
              lastAutoExecution.close = now;
              refreshGateTradeHistory();
            }
          }
        }
      }

      const testStatus = document.getElementById('testStatus');
      if (testStatus && data.lastTestExecution?.at) {
        const time = new Date(data.lastTestExecution.at).toLocaleTimeString();
        const volume = data.lastTestExecution.volume ?? '--';
        const status = data.lastTestExecution.status ?? 'PENDING';
        testStatus.textContent = `TESTE: ${volume} @ ${time} (${status})`;
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
      updateInput('spreadMinOpen', settings.spreadMinOpen);
      updateInput('spreadMinClose', settings.spreadMinClose);
      updateInput('minLiquidityOpen', settings.minLiquidityOpen);
      updateInput('minLiquidityClose', settings.minLiquidityClose);
      updateInput('autoExecutionCooldownMs', settings.autoExecutionCooldownMs);
      updateInput('refreshIntervalMs', settings.refreshIntervalMs);
      updateInput('submitDelayMs', settings.submitDelayMs);
      updateInput('exposurePerAsset', settings.exposurePerAsset);
      updateInput('exposurePerExchange', settings.exposurePerExchange);
      updateInput('exposureGlobal', settings.exposureGlobal);
      updateInput('autoCloseProfitPercent', settings.autoCloseProfitPercent);
      updateInput('autoCloseProfitUsdt', settings.autoCloseProfitUsdt);
      updateInput('autoCloseMinutes', settings.autoCloseMinutes);
      updateInput('testVolume', settings.testVolume);
      const testBtn = document.getElementById('testBtn');
      if (testBtn) {
        testBtn.dataset.pairGate = data.pairGate || '';
        testBtn.dataset.pairMexc = data.pairMexc || '';
      }
      latestPairs.gate = data.pairGate || latestPairs.gate;
      latestPairs.mexc = data.pairMexc || latestPairs.mexc;
      const applyCheckbox = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        const desired = !!value;
        if (el.dataset.userEdited === 'true') {
          const editedAt = Number(el.dataset.userEditedAt || 0);
          if (el.checked === desired) {
            el.dataset.userEdited = '';
            el.dataset.userEditedAt = '';
          } else if (Date.now() - editedAt < 1500) {
            return;
          } else {
            el.dataset.userEdited = '';
            el.dataset.userEditedAt = '';
          }
        }
        el.checked = desired;
      };
      applyCheckbox('allowPartialExecution', settings.allowPartialExecution);
      applyCheckbox('enableLiveExecution', settings.enableLiveExecution);
      applyCheckbox('syncExecutionEnabled', settings.syncTestExecution);
      applyCheckbox('limitToTopLiquidity', settings.limitToTopLiquidity);
      applyCheckbox('enableAutoRebalance', settings.enableAutoRebalance);
      if (settings.executionModes) {
        applyCheckbox('openEnabled', settings.executionModes.openEnabled);
        applyCheckbox('closeEnabled', settings.executionModes.closeEnabled);
      }

      updatePositionPanel({
        spotVolume: Number(settings.spotVolume),
        futuresContracts: Number(settings.spotVolume)
      });
      updateExposurePanel(settings);
    }

    if (msg.type === 'DOM_BOOK' && msg.payload?.source === 'mexc') {
      const askPrice = Number(msg.payload.askPrice);
      const bidPrice = Number(msg.payload.bidPrice);
      const askVolume = Number(msg.payload.askVolume);
      const bidVolume = Number(msg.payload.bidVolume);

      const mexcAskPrice = document.getElementById('mexcAskPrice');
      const mexcBidPrice = document.getElementById('mexcBidPrice');
      const mexcAskSize = document.getElementById('mexcAskSize');
      const mexcBidSize = document.getElementById('mexcBidSize');

      if (mexcAskPrice && Number.isFinite(askPrice)) {
        mexcAskPrice.textContent = askPrice.toFixed(11);
        lastDomBookUpdate = Date.now();
        domBookCache.mexc.askPrice = askPrice;
      }
      if (mexcBidPrice && Number.isFinite(bidPrice)) {
        mexcBidPrice.textContent = bidPrice.toFixed(11);
        lastDomBookUpdate = Date.now();
        domBookCache.mexc.bidPrice = bidPrice;
      }
      if (mexcAskSize && Number.isFinite(askVolume)) {
        mexcAskSize.textContent = askVolume.toFixed(4);
        lastDomBookUpdate = Date.now();
        domBookCache.mexc.askVolume = askVolume;
      }
      if (mexcBidSize && Number.isFinite(bidVolume)) {
        mexcBidSize.textContent = bidVolume.toFixed(4);
        lastDomBookUpdate = Date.now();
        domBookCache.mexc.bidVolume = bidVolume;
      }
    }

    if (msg.type === 'EXECUTION_LOG') {
      syncExecutionLog(msg.payload);
    }
  });
})();
