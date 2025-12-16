let ws = null

function connect() {
  ws = new WebSocket('ws://localhost:8787')

  ws.onopen = () => {
    console.log('🟢 Conectado ao CORE')
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)

    if (data.spread != null) {
      document.getElementById('spread').innerText =
        data.spread.toFixed(3) + '%'
    }

    if (data.signal) {
      document.getElementById('arb-panel').style.display = 'block'
    }
  }

  ws.onclose = () => {
    console.log('❌ Bridge desconectada — tentando novamente')
    setTimeout(connect, 2000)
  }
}

connect()
