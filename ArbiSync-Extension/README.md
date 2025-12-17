# Arbitrage Assistant (Gate SPOT + MEXC Futures)

Arbitrage Assistant é um conjunto simples de **core Node.js** e **extensão Chrome** que monitora, em tempo real, oportunidades de arbitragem entre o par configurado na Gate (spot) e na MEXC (futuros). O core coleta cotações via WebSocket, calcula o spread e sinaliza quando a diferença mínima definida é atingida. A extensão injeta um painel nas páginas da Gate/MEXC e exibe os dados recebidos do core.

## Estrutura do projeto
- `core/`: serviços Node.js que coletam preços, calculam o spread e expõem um WebSocket interno (`ws://localhost:8787`) consumido pela extensão.
- `extension/`: extensão Chrome MV3 com scripts de conteúdo para Gate e MEXC, além do painel web acessível em `extension/overlay/`.
- `config.js` e `core/config.js`: parâmetros do par monitorado e thresholds do detector de arbitragem.

## Pré-requisitos
- Node.js 18+ (para suporte a ES Modules e WebSocket nativo).
- Navegador Chromium com suporte a extensões em modo desenvolvedor (Chrome/Edge/Brave).

## Instalação
1. Instale as dependências do core:
   ```bash
   npm install
   ```

2. (Opcional) Ajuste os pares e thresholds em `core/config.js`:
   - `PAIR_GATE`: par SPOT na Gate (`"WMTX_USDT"` por padrão).
   - `PAIR_MEXC`: par FUTUROS na MEXC.
   - `SPREAD_MIN`: spread mínimo em porcentagem para sinalizar.
   - `COOLDOWN_MS` e `PERSISTENCE_MS`: controle de frequência e persistência do sinal.

## Executando o core
No diretório raiz do projeto, rode:
```bash
node core/index.js
```
O core iniciará os WebSockets da Gate e MEXC, calculará o spread e manterá o bridge WebSocket ativo em `ws://localhost:8787` para consumo pela extensão.

## Carregando a extensão
1. Abra o menu de extensões do navegador e ative o **Modo desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione a pasta `extension/`.
3. A extensão injeta um painel nas páginas `gate.io`, `gate.com` e `mexc.com`. Certifique-se de que o core esteja em execução para que o painel exiba os dados e habilite o botão de confirmação quando o sinal de arbitragem for verdadeiro.

## Fluxo de funcionamento
1. **Feeds de preço** (`core/priceFeeds.js`):
   - Gate SPOT: assina `spot.tickers` e lê `lowest_ask`.
   - MEXC Futures: assina `sub.ticker` e lê `bid`.
2. **Engine** (`core/arbitrageEngine.js`): calcula o spread e sinaliza quando o valor ultrapassa `SPREAD_MIN` pelo tempo definido em `PERSISTENCE_MS`, respeitando o `COOLDOWN_MS`.
3. **Bridge** (`core/bridge.js`): transmite estado (askGate, bidMexc, spread e sinal) via WebSocket para a extensão.
4. **Extensão** (`extension/background.js` + `content_*.js`): conecta ao bridge, injeta painel e atualiza os valores exibidos na página.

## Dicas e problemas comuns
- Se o painel mostrar "CORE: desconectado", confira se o core está rodando e se a porta `8787` está livre.
- O overlay é injetado apenas nas páginas com URLs suportadas; abra uma aba da Gate ou MEXC após carregar a extensão.
- A MEXC e a Gate podem aplicar limites de conexão; se desconectar, o core tenta reconectar automaticamente após alguns segundos.
