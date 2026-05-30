export const STATUSES = ['In stock', 'Listed', 'Sold', 'Shipped']

export function uid() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

import { FREE_FOR_ALL } from './config'

// Effective plan state, accounting for an expired trial.
// Returns { state, trialDaysLeft, isPaid, fullAccess }
// states: 'trial' | 'active' (paid) | 'comp' (free access granted by you) | 'free' (expired/limited)
export function planState(plan, trialEnds) {
  // Global free-for-all override: while true, treat every account as comp.
  if (FREE_FOR_ALL) return { state: 'comp', trialDaysLeft: 0, isPaid: true, fullAccess: true }
  if (plan === 'comp') return { state: 'comp', trialDaysLeft: 0, isPaid: true, fullAccess: true }
  if (plan === 'active') return { state: 'active', trialDaysLeft: 0, isPaid: true, fullAccess: true }
  if (plan === 'trial' && trialEnds) {
    const ms = new Date(trialEnds).getTime() - Date.now()
    if (ms > 0) {
      return { state: 'trial', trialDaysLeft: Math.ceil(ms / 86400000), isPaid: false, fullAccess: true }
    }
  }
  // trial missing or expired, and not paid
  return { state: 'free', trialDaysLeft: 0, isPaid: false, fullAccess: false }
}

// Short, human-readable code shown on labels so blanks are tellable apart.
// Derived from the id so it's stable; e.g. "B-7QX4".
export function shortCode(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const base = h.toString(36).toUpperCase().padStart(4, '0').slice(-4)
  return 'B-' + base
}

// Expiration status for a yyyy-mm-dd date string.
// Returns null (no date), 'expired', 'soon' (<=14 days), or 'ok'.
export function expStatus(dateStr, soonDays = 14) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d)) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((d - today) / 86400000)
  if (days < 0) return 'expired'
  if (days <= soonDays) return 'soon'
  return 'ok'
}

export function expLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d)) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((d - today) / 86400000)
  const nice = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  if (days < 0) return `Expired ${nice}`
  if (days === 0) return `Expires today`
  if (days <= 14) return `Expires ${nice} (${days}d)`
  return `Expires ${nice}`
}

// Soonest upcoming/overdue expiration across a container (item-level + container-level).
export function soonestExp(it) {
  const dates = []
  if (it.expires) dates.push(it.expires)
  for (const c of it.contents || []) if (c.expires) dates.push(c.expires)
  if (!dates.length) return null
  return dates.sort()[0]
}

// Flatten every dated thing (items + container-level dates) across all containers
// that is expired or expiring within `soonDays`. Sorted soonest-first.
export function collectExpiring(items, soonDays = 30) {
  const out = []
  for (const it of items) {
    if (it.expires) {
      const st = expStatus(it.expires, soonDays)
      if (st === 'expired' || st === 'soon')
        out.push({ kind: 'container', containerId: it.id, containerName: it.name, location: it.location, name: '(whole container)', expires: it.expires, status: st })
    }
    ;(it.contents || []).forEach((c, idx) => {
      if (!c.expires) return
      const st = expStatus(c.expires, soonDays)
      if (st === 'expired' || st === 'soon')
        out.push({ kind: 'item', containerId: it.id, containerName: it.name, location: it.location, name: c.name, qty: c.qty, index: idx, expires: c.expires, status: st })
    })
  }
  return out.sort((a, b) => a.expires.localeCompare(b.expires))
}

export function num(n) {
  const v = parseFloat(n)
  return isNaN(v) ? 0 : v
}

export function money(n) {
  const v = parseFloat(n)
  if (isNaN(v)) return ''
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function containerValue(it) {
  return (it.contents || []).reduce((s, c) => s + num(c.value) * (num(c.qty) || 1), 0)
}

export function feeSum(h) {
  return num(h.sellerFee) + num(h.ccFee) + num(h.shipping) + num(h.packing)
}

export function containerProfit(it) {
  let p = 0
  for (const c of it.contents || []) {
    if (c.status === 'Sold' || c.status === 'Shipped')
      p += (num(c.sale) - num(c.cost)) * (num(c.qty) || 1)
  }
  for (const h of it.history || []) {
    if (h.reason === 'sold')
      p += (num(h.sale) - num(h.cost)) * (num(h.qty) || 1) - feeSum(h)
  }
  return p
}

export function statusClass(s) {
  return ({ 'In stock': 'stock', Listed: 'listed', Sold: 'sold', Shipped: 'shipped' }[s] || 'stock')
}

// Collect all sold items from every container's history, with computed profit.
// Returns { sales: [...], totals: {revenue, cost, profit, count} } for a time window.
// windowDays: null = all time.
export function salesSummary(items, windowDays = null) {
  const cutoff = windowDays ? Date.now() - windowDays * 86400000 : 0
  const sales = []
  for (const it of items) {
    for (const h of it.history || []) {
      if (h.reason !== 'sold') continue
      if (cutoff && (h.pulledAt || 0) < cutoff) continue
      const qty = num(h.qty) || 1
      const revenue = num(h.sale) * qty
      const cost = num(h.cost) * qty
      const fees = feeSum(h)
      sales.push({
        name: h.name, qty, revenue, cost, fees,
        sellerFee: num(h.sellerFee), ccFee: num(h.ccFee), shipping: num(h.shipping), packing: num(h.packing),
        profit: revenue - cost - fees,
        marketplace: h.marketplace || '', sku: h.sku || '', soldAt: h.pulledAt || 0,
        containerName: it.name,
      })
    }
  }
  sales.sort((a, b) => b.soldAt - a.soldAt)
  const totals = sales.reduce((t, s) => ({
    revenue: t.revenue + s.revenue, cost: t.cost + s.cost, fees: t.fees + s.fees,
    profit: t.profit + s.profit, count: t.count + s.qty,
  }), { revenue: 0, cost: 0, fees: 0, profit: 0, count: 0 })
  return { sales, totals }
}

// ---- CSV import ----

// Parse a CSV string into an array of rows (each row = array of strings).
// Handles quoted fields with commas and escaped quotes.
export function parseCSV(text) {
  const rows = []
  let row = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQuotes = false
      else cur += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(cur); cur = '' }
      else if (c === '\n' || c === '\r') {
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = '' }
        if (c === '\r' && text[i + 1] === '\n') i++
      } else cur += c
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((v) => (v || '').trim() !== ''))
}

// Take parsed CSV rows + a column mapping and produce container objects ready to save.
// Mapping maps our field names to column indexes (or -1 for unset):
//   container, location, category, description, item, qty, value, expires
// Rows are grouped by container name. Multiple rows with the same container name
// become one container with multiple items.
export function buildContainersFromCSV(rows, mapping, hasHeader = true) {
  const data = hasHeader ? rows.slice(1) : rows
  const get = (row, key) => {
    const i = mapping[key]
    if (i === undefined || i < 0 || i >= row.length) return ''
    return (row[i] || '').trim()
  }
  const byContainer = new Map()
  for (const row of data) {
    let cName = get(row, 'container')
    const itemName = get(row, 'item')
    // If neither name is set, skip this row.
    if (!cName && !itemName) continue
    // If only an item name exists, group it under a default container.
    if (!cName) cName = 'Imported items'
    if (!byContainer.has(cName)) {
      byContainer.set(cName, {
        name: cName,
        location: get(row, 'location'),
        category: get(row, 'category'),
        description: get(row, 'description'),
        expires: get(row, 'expires'),
        contents: [],
        photos: [],
      })
    }
    const c = byContainer.get(cName)
    if (itemName) {
      const item = { name: itemName }
      const qty = get(row, 'qty')
      const value = get(row, 'value')
      const itemExp = get(row, 'expires')
      if (qty) item.qty = parseInt(qty) || 1
      if (value) item.value = parseFloat(value)
      if (itemExp && !c.expires) item.expires = itemExp
      c.contents.push(item)
    }
  }
  return Array.from(byContainer.values())
}

// Try to guess which column is which based on the header row.
// Returns a mapping object.
export function guessMapping(headerRow) {
  const m = { container: -1, location: -1, category: -1, description: -1, item: -1, qty: -1, value: -1, expires: -1 }
  if (!headerRow) return m
  const lower = headerRow.map((h) => (h || '').toLowerCase().trim())
  const find = (keywords) => {
    for (let i = 0; i < lower.length; i++) {
      for (const k of keywords) if (lower[i].includes(k)) return i
    }
    return -1
  }
  m.container = find(['container', 'bin', 'box'])
  m.location = find(['location', 'where', 'place', 'shelf', 'room'])
  m.category = find(['category', 'type', 'group'])
  m.description = find(['description', 'notes', 'note', 'desc'])
  m.item = find(['item', 'product', 'name', 'thing'])
  m.qty = find(['qty', 'quantity', 'count', 'amount'])
  m.value = find(['value', 'cost', 'price', 'worth', 'paid'])
  m.expires = find(['expir', 'expiry', 'best by', 'use by'])
  return m
}

export function exportSalesCSV(items, windowLabel) {
  const { sales, totals } = salesSummary(items, null)
  const headers = ['Date', 'Item', 'Container', 'Qty', 'Marketplace', 'SKU',
    'Revenue', 'Cost', 'Seller fee', 'Card fee', 'Shipping', 'Packing', 'Total fees', 'Net profit']
  const rows = [headers]
  for (const s of sales) {
    rows.push([
      s.soldAt ? new Date(s.soldAt).toLocaleDateString() : '', s.name, s.containerName, s.qty,
      s.marketplace, s.sku, s.revenue.toFixed(2), s.cost.toFixed(2),
      s.sellerFee.toFixed(2), s.ccFee.toFixed(2), s.shipping.toFixed(2), s.packing.toFixed(2),
      s.fees.toFixed(2), s.profit.toFixed(2),
    ])
  }
  rows.push([])
  rows.push(['TOTALS', '', '', totals.count, '', '', totals.revenue.toFixed(2), totals.cost.toFixed(2),
    '', '', '', '', totals.fees.toFixed(2), totals.profit.toFixed(2)])
  const csv = rows.map((r) => r.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'binstashr-sales.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Resize + compress an image File to a JPEG data URL, capped at maxPx on the long edge.
export function shrinkImage(file, maxPx = 1000, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        let { width: w, height: h } = img
        if (w > h && w > maxPx) { h = (h * maxPx) / w; w = maxPx }
        else if (h > maxPx) { w = (w * maxPx) / h; h = maxPx }
        const cv = document.createElement('canvas')
        cv.width = w; cv.height = h
        cv.getContext('2d').drawImage(img, 0, 0, w, h)
        cv.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
      }
      img.onerror = reject
      img.src = e.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function exportCSV(items, resellerMode) {
  const headers = ['Container', 'Location', 'Category', 'Description', 'Item', 'Qty',
    resellerMode ? 'Cost' : 'Value', 'Sale', 'Marketplace', 'SKU', 'Status', 'Expires']
  const rows = [headers]
  for (const it of items) {
    if (!it.contents || !it.contents.length) {
      rows.push([it.name, it.location, it.category, it.description, '', '', '', '', '', '', '', it.expires || ''])
      continue
    }
    for (const c of it.contents) {
      rows.push([it.name, it.location || '', it.category || '', it.description || '',
        c.name || '', c.qty || 1, resellerMode ? (c.cost || '') : (c.value || ''),
        c.sale || '', c.marketplace || '', c.sku || '', c.status || '', c.expires || ''])
    }
  }
  const csv = rows.map((r) => r.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'binstashr.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
