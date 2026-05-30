import QRCode from 'qrcode'
import { shortCode } from './utils'

export async function qrDataUrl(text, size = 220) {
  return QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
}

const esc = (s) => (s || '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export async function printLabel(item) {
  const qr = await qrDataUrl(item.id)
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to print.'); return }
  w.document.write(`<html><head><title>Label</title><style>
    body{font-family:sans-serif;text-align:center;padding:24px;}
    .label{border:2px solid #000;border-radius:10px;padding:18px;display:inline-block;max-width:300px;}
    h1{font-size:20px;margin:12px 0 2px;} p{margin:0;font-size:14px;color:#444;}
    .loc{color:#000;font-weight:bold;margin-top:6px;} img{width:200px;height:200px;}
  </style></head><body><div class="label">
    <img src="${qr}"/><h1>${esc(item.name)}</h1><p>${esc(item.category) || ''}</p>
    ${item.location ? `<p class="loc">${esc(item.location)}</p>` : ''}
  </div><script>setTimeout(()=>window.print(),350)<\/script></body></html>`)
  w.document.close()
}

export async function printBlanks(ids) {
  if (!ids.length) return
  const cards = await Promise.all(ids.map(async (id) => {
    const qr = await qrDataUrl(id, 180)
    return `<div class="label"><img src="${qr}"/>
      <div class="code">${shortCode(id)}</div></div>`
  }))
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to print.'); return }
  w.document.write(`<html><head><title>Blank labels</title><style>
    body{font-family:sans-serif;padding:16px;display:flex;flex-wrap:wrap;gap:14px;}
    .label{border:1.5px solid #000;border-radius:8px;padding:12px;width:170px;text-align:center;page-break-inside:avoid;}
    .code{font-size:18px;font-weight:bold;margin-top:8px;letter-spacing:1px;font-family:monospace;}
    img{width:150px;height:150px;}
  </style></head><body>${cards.join('')}<script>setTimeout(()=>window.print(),450)<\/script></body></html>`)
  w.document.close()
}

export async function printAll(items) {
  if (!items.length) return
  const cards = await Promise.all(items.map(async (it) => {
    const qr = await qrDataUrl(it.id, 180)
    return `<div class="label"><img src="${qr}"/>
      <div class="name">${esc(it.name)}</div>
      <div class="cat">${esc(it.category) || ''}</div>
      ${it.location ? `<div class="loc">${esc(it.location)}</div>` : ''}</div>`
  }))
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to print.'); return }
  w.document.write(`<html><head><title>All labels</title><style>
    body{font-family:sans-serif;padding:16px;display:flex;flex-wrap:wrap;gap:14px;}
    .label{border:1.5px solid #000;border-radius:8px;padding:12px;width:190px;text-align:center;page-break-inside:avoid;}
    .name{font-size:15px;font-weight:bold;margin-top:6px;} .cat{font-size:12px;color:#555;}
    .loc{font-size:12px;font-weight:bold;margin-top:3px;} img{width:150px;height:150px;}
  </style></head><body>${cards.join('')}<script>setTimeout(()=>window.print(),450)<\/script></body></html>`)
  w.document.close()
}
