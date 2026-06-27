import QRCode from 'qrcode'
import { jsPDF } from 'jspdf'
import { shortCode } from './utils'

// Label size catalog. Dimensions are in inches.
// For thermal/single-label printers, each label is its own page; for sheets,
// labels flow in a grid that matches Avery layouts.
export const LABEL_SIZES = [
  { id: 'letter',       label: 'Letter sheet (1 big label)', w: 4,      h: 3,      kind: 'sheet',   gridCols: 1, gridRows: 1 },
  { id: 'avery-5160',   label: 'Avery 5160 (1×2-5/8")',      w: 2.625,  h: 1,      kind: 'sheet',   gridCols: 3, gridRows: 10, colGap: 0.125, sheetMarginV: 0.5, sheetMarginH: 0.1875 },
  { id: 'ol800sp',      label: 'OL800SP (2.5×1.563", 18 per sheet)', w: 2.5, h: 1.563, kind: 'sheet', gridCols: 3, gridRows: 6, rowGap: 0.125, sheetMarginV: 0.5, sheetMarginH: 0.5 },
  { id: 'dymo-30252',   label: 'Dymo 30252 (1-1/8×3-1/2")',  w: 3.5,    h: 1.125,  kind: 'roll' },
  { id: 'brother-dk1201', label: 'Brother DK-1201 (1.1×3.5")', w: 3.5,  h: 1.1,    kind: 'roll' },
  { id: '2x4',          label: '2×4" shipping',              w: 4,      h: 2,      kind: 'roll' },
  { id: '4x6',          label: '4×6" thermal',               w: 4,      h: 6,      kind: 'roll' },
]
export const DEFAULT_SIZE = 'avery-5160'

const esc = (s) => (s || '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export async function qrDataUrl(text, size = 220) {
  return QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
}

// Build a single label's inner HTML given the size and content.
function labelHTML(size, qr, lines) {
  // Tune QR size and font for the label dimensions.
  const isTiny = size.w < 3
  const qrPx = isTiny ? (size.h * 72) : Math.min(size.w, size.h) * 60
  const nameSize = isTiny ? '11pt' : '14pt'
  const subSize = isTiny ? '8pt' : '10pt'
  return `
    <div class="lbl" style="width:${size.w}in;height:${size.h}in;">
      <img src="${qr}" style="width:${qrPx}px;height:${qrPx}px;"/>
      <div class="txt">
        ${lines.map((l, i) => `<div style="font-size:${i === 0 ? nameSize : subSize};${i === 0 ? 'font-weight:bold;' : 'color:#555;'}line-height:1.15;">${esc(l)}</div>`).join('')}
      </div>
    </div>`
}

// Generate the print HTML for a list of labels at a chosen size.
// offsets: { x, y } in inches to shift the whole grid.
// scale: { rows } multiplier on each row's height (e.g. 1.01 makes rows 1% taller
// to compensate for printers that compress vertical spacing).
async function buildSheet(labels, sizeId, offsets = { x: 0, y: 0 }, scale = { rows: 1 }) {
  const size = LABEL_SIZES.find((s) => s.id === sizeId) || LABEL_SIZES.find((s) => s.id === DEFAULT_SIZE)
  // pre-generate QR codes
  const labelsWithQR = await Promise.all(labels.map(async (l) => ({ ...l, qr: await qrDataUrl(l.id, 220) })))
  const labelDivs = labelsWithQR.map((l) => labelHTML(size, l.qr, l.lines)).join('')

  // Different CSS depending on sheet vs roll/single
  const pageCss = size.kind === 'roll'
    ? `@page { size: ${size.w}in ${size.h}in; margin: 0; }
       body { margin: 0; padding: 0; }
       .lbl { page-break-after: always; }
       .lbl:last-child { page-break-after: auto; }`
    : (size.gridCols > 1 && size.gridRows > 1)
      ? (() => {
          const colGap = size.colGap || 0
          const rowGap = size.rowGap || 0
          const rowScale = scale.rows || 1
          const effRowH = size.h * rowScale
          const totalW = size.w * size.gridCols + colGap * (size.gridCols - 1)
          const totalH = effRowH * size.gridRows + rowGap * (size.gridRows - 1)
          let mh = size.sheetMarginH !== undefined ? size.sheetMarginH : Math.max(0.25, (8.5 - totalW) / 2)
          let mv = size.sheetMarginV !== undefined ? size.sheetMarginV : Math.max(0.25, (11 - totalH) / 2)
          mh = Math.max(0, mh + (offsets.x || 0))
          mv = Math.max(0, mv + (offsets.y || 0))
          return `@page { size: letter; margin: ${mv}in ${mh}in; }
             body { margin: 0; }
             .sheet { display: grid; grid-template-columns: repeat(${size.gridCols}, ${size.w}in); grid-auto-rows: ${effRowH}in; column-gap: ${colGap}in; row-gap: ${rowGap}in; }
             .lbl { box-sizing: border-box; height: ${effRowH}in; }`
        })()
      : `@page { size: letter; margin: 0.5in; }
         body { margin: 0; }
         .lbl { margin: 0 auto 0.5in; }`

  return `<!doctype html><html><head><title>Labels</title><style>
    ${pageCss}
    .lbl { display: flex; align-items: center; gap: 0.08in; padding: 0.06in; box-sizing: border-box; overflow: hidden; }
    .lbl img { flex-shrink: 0; }
    .lbl .txt { flex: 1; min-width: 0; overflow: hidden; }
    .lbl .txt div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; -webkit-print-color-adjust: exact; }
  </style></head><body>
    ${size.kind === 'sheet' && size.id !== 'letter' ? `<div class="sheet">${labelDivs}</div>` : labelDivs}
    <script>setTimeout(()=>window.print(),400)<\/script>
  </body></html>`
}

function openPrint(html) {
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to print.'); return }
  w.document.write(html); w.document.close()
}

// ---- PDF generation (preferred path for sheet labels) ----
// Produces a real PDF with inch-precise positioning. Bypasses the browser
// print pipeline entirely, so "fit to page" can't shrink the layout.
async function buildPDF(labels, sizeId, offsets = { x: 0, y: 0 }, rowScale = 1) {
  const size = LABEL_SIZES.find((s) => s.id === sizeId) || LABEL_SIZES.find((s) => s.id === DEFAULT_SIZE)
  const isSheet = size.kind === 'sheet' && (size.gridCols || 1) > 1 && (size.gridRows || 1) > 1

  // Page dimensions
  const pageW = isSheet ? 8.5 : size.w
  const pageH = isSheet ? 11 : size.h

  const doc = new jsPDF({ unit: 'in', format: [pageW, pageH], orientation: pageW > pageH ? 'landscape' : 'portrait' })

  // For sheets, calculate the starting offset (top-left of label grid)
  const colGap = size.colGap || 0
  const rowGap = size.rowGap || 0
  const effRowH = size.h * (rowScale || 1)
  const totalW = size.w * (size.gridCols || 1) + colGap * Math.max(0, (size.gridCols || 1) - 1)
  const totalH = effRowH * (size.gridRows || 1) + rowGap * Math.max(0, (size.gridRows || 1) - 1)
  let startX = size.sheetMarginH !== undefined ? size.sheetMarginH : Math.max(0.25, (pageW - totalW) / 2)
  let startY = size.sheetMarginV !== undefined ? size.sheetMarginV : Math.max(0.25, (pageH - totalH) / 2)
  startX += offsets.x || 0
  startY += offsets.y || 0

  // Pre-generate QR PNGs for every label
  const qrs = await Promise.all(labels.map((l) => QRCode.toDataURL(l.id, { width: 400, margin: 0, errorCorrectionLevel: 'M' })))

  if (isSheet) {
    const cols = size.gridCols, rows = size.gridRows
    let i = 0
    while (i < labels.length) {
      if (i > 0 && i % (cols * rows) === 0) doc.addPage([pageW, pageH], 'portrait')
      const slot = i % (cols * rows)
      const c = slot % cols
      const r = Math.floor(slot / cols)
      const x = startX + c * (size.w + colGap)
      const y = startY + r * (effRowH + rowGap)
      drawLabel(doc, labels[i], qrs[i], x, y, size.w, effRowH)
      i++
    }
  } else {
    // Roll/thermal: one label per page
    for (let i = 0; i < labels.length; i++) {
      if (i > 0) doc.addPage([pageW, pageH], pageW > pageH ? 'landscape' : 'portrait')
      drawLabel(doc, labels[i], qrs[i], 0, 0, size.w, size.h)
    }
  }

  return doc
}

// Draw one label (QR on the left, text lines on the right) into the PDF at the given position.
function drawLabel(doc, label, qrDataUrl, x, y, w, h) {
  const pad = Math.min(w, h) * 0.05      // small inner padding
  const qrSide = Math.min(w, h) - pad * 2
  doc.addImage(qrDataUrl, 'PNG', x + pad, y + pad, qrSide, qrSide, undefined, 'FAST')

  const lines = label.lines || []
  if (!lines.length) return

  const textX = x + pad + qrSide + pad
  const textW = w - (textX - x) - pad
  if (textW <= 0.1) return  // no room for text

  // Font sizes: scale with label height. For 1" tall labels (avery 5160), about 11pt name + 8pt sub.
  // For taller labels, scale up.
  const nameFontPt = Math.max(8, Math.min(16, h * 11))
  const subFontPt  = Math.max(7, Math.min(12, h * 8))
  const lineGap    = nameFontPt / 72 * 1.15   // in inches

  let cursorY = y + pad + nameFontPt / 72   // baseline of first line
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(nameFontPt)
  doc.setTextColor(0, 0, 0)
  const name = truncateToFit(doc, lines[0] || '', textW)
  doc.text(name, textX, cursorY)
  cursorY += lineGap

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(subFontPt)
  doc.setTextColor(85, 85, 85)
  for (let i = 1; i < lines.length; i++) {
    if (cursorY + lineGap > y + h - pad) break
    const sub = truncateToFit(doc, lines[i], textW)
    doc.text(sub, textX, cursorY)
    cursorY += lineGap
  }
}

// Truncate a string so it fits in `widthIn` inches at the current font.
function truncateToFit(doc, s, widthIn) {
  if (!s) return ''
  if (doc.getTextWidth(s) <= widthIn) return s
  // Binary chop with ellipsis
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (doc.getTextWidth(s.slice(0, mid) + '…') <= widthIn) lo = mid
    else hi = mid - 1
  }
  return s.slice(0, lo) + '…'
}

function safeFilename(s) {
  return (s || 'labels').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'labels'
}

// ---- Public PDF download functions ----
export async function downloadLabelPDF(item, sizeId = DEFAULT_SIZE, includeText = true, copies = 1, offsets = { x: 0, y: 0 }, rowScale = 1) {
  const lines = includeText ? [item.name || 'Untitled'] : []
  if (includeText) {
    if (item.category) lines.push(item.category)
    if (item.location) lines.push(item.location)
  }
  const labels = Array.from({ length: copies }, () => ({ id: item.id, lines }))
  const doc = await buildPDF(labels, sizeId, offsets, rowScale)
  doc.save(`${safeFilename(item.name || 'label')}-labels.pdf`)
}

export async function downloadAllPDF(items, sizeId = DEFAULT_SIZE, includeText = true, copies = 1, offsets = { x: 0, y: 0 }, rowScale = 1) {
  if (!items.length) return
  const labels = []
  for (const it of items) {
    const lines = includeText ? [it.name || 'Untitled'] : []
    if (includeText) {
      if (it.category) lines.push(it.category)
      if (it.location) lines.push(it.location)
    }
    for (let n = 0; n < copies; n++) labels.push({ id: it.id, lines })
  }
  const doc = await buildPDF(labels, sizeId, offsets, rowScale)
  doc.save('binstashr-all-labels.pdf')
}

export async function downloadBlanksPDF(ids, sizeId = DEFAULT_SIZE, includeText = true, copies = 1, offsets = { x: 0, y: 0 }, rowScale = 1) {
  if (!ids.length) return
  const labels = []
  for (const id of ids) {
    const label = { id, lines: includeText ? [shortCode(id)] : [] }
    for (let n = 0; n < copies; n++) labels.push(label)
  }
  const doc = await buildPDF(labels, sizeId, offsets, rowScale)
  doc.save('binstashr-blank-labels.pdf')
}

// Print one label for a single container, at the given size.
export async function printLabel(item, sizeId = DEFAULT_SIZE, includeText = true, copies = 1, offsets = { x: 0, y: 0 }, rowScale = 1) {
  const lines = includeText ? [item.name || 'Untitled'] : []
  if (includeText) {
    if (item.category) lines.push(item.category)
    if (item.location) lines.push(item.location)
  }
  const one = { id: item.id, lines }
  const labels = Array.from({ length: copies }, () => one)
  openPrint(await buildSheet(labels, sizeId, offsets, { rows: rowScale }))
}

// Print labels for many containers, at the given size.
export async function printAll(items, sizeId = DEFAULT_SIZE, includeText = true, copies = 1, offsets = { x: 0, y: 0 }, rowScale = 1) {
  if (!items.length) return
  const labels = []
  for (const it of items) {
    const lines = includeText ? [it.name || 'Untitled'] : []
    if (includeText) {
      if (it.category) lines.push(it.category)
      if (it.location) lines.push(it.location)
    }
    for (let n = 0; n < copies; n++) labels.push({ id: it.id, lines })
  }
  openPrint(await buildSheet(labels, sizeId, offsets, { rows: rowScale }))
}

// Print blank labels (just QR + short human-readable code).
export async function printBlanks(ids, sizeId = DEFAULT_SIZE, includeText = true, copies = 1, offsets = { x: 0, y: 0 }, rowScale = 1) {
  if (!ids.length) return
  const labels = []
  for (const id of ids) {
    const label = { id, lines: includeText ? [shortCode(id)] : [] }
    for (let n = 0; n < copies; n++) labels.push(label)
  }
  openPrint(await buildSheet(labels, sizeId, offsets, { rows: rowScale }))
}
