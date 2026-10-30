const express = require('express')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys')
const pino = require('pino')

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000
const BOT_SECRET = process.env.BOT_SECRET || 'laundrysecret123'

let sock = null
let isConnected = false
let currentPairingCode = null

const logger = pino({ level: 'silent' })

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Chrome (Linux)', '', ''],
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      isConnected = false
      console.log(`[WA] Koneksi terputus. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`)

      if (shouldReconnect) {
        setTimeout(startWhatsApp, 3000)
      } else {
        console.log('[WA] Sesi logout. Silakan lakukan pairing ulang.')
      }
    } else if (connection === 'open') {
      isConnected = true
      currentPairingCode = null
      console.log(`[WA] Terhubung sebagai: ${sock?.user?.id || 'Active'}`)
    }
  })
}

startWhatsApp()

// 1. Healthcheck / Anti-Sleep Ping
app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    connected: isConnected,
    number: sock?.user?.id ? sock.user.id.split(':')[0] : null,
    uptime: Math.floor(process.uptime()),
  })
})

// 2. Halaman Pairing Code (Buka dari HP untuk tautkan nomor)
app.get('/pair', async (req, res) => {
  const rawPhone = req.query.phone

  if (isConnected) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Status WhatsApp</title>
        <style>
          body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f0fdf4; margin: 0; padding: 16px; box-sizing: border-box; }
          .card { background: white; padding: 32px; border-radius: 16px; text-align: center; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 400px; width: 100%; }
          .badge { display: inline-block; background: #22c55e; color: white; padding: 6px 16px; border-radius: 999px; font-weight: bold; margin-bottom: 12px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">ONLINE</div>
          <h2>WhatsApp Sudah Terhubung!</h2>
          <p style="color: #64748b;">Nomor: <b>${sock?.user?.id ? sock.user.id.split(':')[0] : 'Aktif'}</b></p>
          <p style="color: #64748b; font-size: 14px;">Bot siap digunakan untuk mengirim nota laundry secara otomatis.</p>
        </div>
      </body>
      </html>
    `)
  }

  if (!rawPhone) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tautkan WhatsApp</title>
        <style>
          body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8fafc; margin: 0; padding: 16px; box-sizing: border-box; }
          .card { background: white; padding: 32px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 400px; width: 100%; text-align: center; }
          input { width: 100%; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 16px; box-sizing: border-box; margin: 12px 0; }
          button { width: 100%; padding: 12px; background: #2563eb; color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 16px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Tautkan Nomor WhatsApp</h2>
          <p style="color: #64748b; font-size: 14px;">Masukkan nomor WhatsApp toko (awali dengan 62):</p>
          <form method="GET" action="/pair">
            <input type="text" name="phone" placeholder="Contoh: 6281234567890" required />
            <button type="submit">Dapatkan Kode 8 Digit</button>
          </form>
        </div>
      </body>
      </html>
    `)
  }

  // Format nomor (hapus karakter selain angka, ganti 08xx jadi 628xx)
  let phone = String(rawPhone).replace(/\D/g, '')
  if (phone.startsWith('0')) phone = '62' + phone.slice(1)

  try {
    const code = await sock.requestPairingCode(phone)
    currentPairingCode = code

    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code

    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kode Pairing WhatsApp</title>
        <style>
          body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8fafc; margin: 0; padding: 16px; box-sizing: border-box; }
          .card { background: white; padding: 32px; border-radius: 16px; text-align: center; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 420px; width: 100%; }
          .code-box { background: #f1f5f9; border: 2px dashed #94a3b8; padding: 16px; border-radius: 12px; font-size: 32px; font-weight: 800; letter-spacing: 4px; color: #0f172a; margin: 20px 0; font-family: monospace; }
          ol { text-align: left; color: #475569; font-size: 14px; line-height: 1.6; padding-left: 20px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Kode Tautan WhatsApp</h2>
          <p style="color: #64748b; font-size: 14px;">Nomor: <b>+${phone}</b></p>
          <div class="code-box">${formattedCode}</div>
          <ol>
            <li>Buka WhatsApp di HP Anda</li>
            <li>Klik menu titik tiga / <b>Setelan</b></li>
            <li>Pilih <b>Perangkat Tertaut</b></li>
            <li>Klik <b>Tautkan Perangkat</b> lalu pilih <b>"Tautkan dengan nomor telepon saja"</b></li>
            <li>Masukkan kode 8 digit di atas</li>
          </ol>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Halaman akan otomatis refresh setelah terhubung.</p>
          <script>
            setInterval(() => {
              fetch('/ping').then(r => r.json()).then(data => {
                if (data.connected) window.location.href = '/pair';
              });
            }, 3000);
          </script>
        </div>
      </body>
      </html>
    `)
  } catch (err) {
    return res.status(500).send(`Gagal meminta kode pairing: ${err.message}. Silakan coba refresh halaman.`)
  }
})

// 3. Endpoint Kirim Pesan Nota (Dipanggil oleh Vercel)
app.post('/send-message', async (req, res) => {
  const secret = req.headers['x-bot-secret'] || req.body.secret
  if (secret !== BOT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Secret key salah' })
  }

  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'WhatsApp bot belum terhubung. Silakan buka /pair untuk menghubungkan nomor.' })
  }

  const { phone, message } = req.body
  if (!phone || !message) {
    return res.status(400).json({ error: 'Parameter phone dan message wajib diisi' })
  }

  let cleanPhone = String(phone).replace(/\D/g, '')
  if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1)
  const jid = `${cleanPhone}@s.whatsapp.net`

  try {
    const result = await sock.sendMessage(jid, { text: message })
    return res.json({
      success: true,
      messageId: result.key.id,
      timestamp: result.messageTimestamp,
    })
  } catch (error) {
    console.error('[WA Error]:', error)
    return res.status(500).json({ error: 'Gagal mengirim pesan: ' + error.message })
  }
})

app.listen(PORT, () => {
  console.log(`[WA Gateway] Berjalan di port ${PORT}`)
})

