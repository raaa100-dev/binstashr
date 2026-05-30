import React, { useEffect, useState, useRef } from 'react'
import { supabase } from './supabaseClient'
import Auth from './Auth.jsx'
import {
  fetchContainers, upsertContainer, deleteContainer, moveContainer,
  fetchSettings, saveSettings, uploadPhoto, deletePhoto, FREE_CONTAINER_LIMIT,
  createBlankContainers,
  fetchHouseholds, createHousehold, joinHouseholdByCode,
  fetchMembers, leaveHousehold, removeMember, setMemberRole, deleteHousehold, inviteByEmail,
} from './data'
import {
  STATUSES, uid, num, money, containerValue, containerProfit,
  statusClass, shrinkImage, exportCSV, shortCode, expStatus, expLabel, soonestExp, collectExpiring, salesSummary, exportSalesCSV, planState,
} from './utils'
import { qrDataUrl, printLabel, printAll, printBlanks } from './print'
import { Html5Qrcode } from 'html5-qrcode'

const MAX_PHOTOS = 2

export default function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session); setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!authReady) return <div className="app"><div className="full-center"><div className="spinner" /></div></div>
  if (!session) return <Auth />
  return <Main user={session.user} />
}

function Main({ user }) {
  const [items, setItems] = useState([])
  const [resellerMode, setResellerMode] = useState(false)
  const [households, setHouseholds] = useState([])
  const [space, setSpace] = useState(null)        // null = personal; else household id
  const [plan, setPlan] = useState({ state: 'trial', trialDaysLeft: 14, isPaid: false, fullAccess: true })
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list')
  const [editing, setEditing] = useState(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('recent')
  const [toast, setToast] = useState('')

  function flash(t) { setToast(t); setTimeout(() => setToast(''), 1800) }

  // Initial load: settings + households, then containers for the active space.
  useEffect(() => {
    (async () => {
      try {
        const [s, hs] = await Promise.all([fetchSettings(user.id), fetchHouseholds(user.id)])
        setResellerMode(s.resellerMode)
        setHouseholds(hs)
        setPlan(planState(s.plan, s.trialEnds))
        const validSpace = s.activeHousehold && hs.some((h) => h.id === s.activeHousehold) ? s.activeHousehold : null
        setSpace(validSpace)
        const list = await fetchContainers(user.id, validSpace)
        setItems(list)
      } catch (e) { flash('Could not load data') }
      finally { setLoading(false) }
    })()
  }, [user.id])

  // Reload containers whenever the active space changes (after initial load).
  const didInit = useRef(false)
  useEffect(() => {
    if (!didInit.current) { didInit.current = true; return }
    (async () => {
      setLoading(true)
      try {
        const list = await fetchContainers(user.id, space)
        setItems(list)
        await saveSettings(user.id, { activeHousehold: space })
      } catch (e) { flash('Could not switch space') }
      finally { setLoading(false) }
    })()
  }, [space])

  async function reloadHouseholds() {
    try { setHouseholds(await fetchHouseholds(user.id)) } catch (e) {}
  }

  function openDetail(id) { setEditing(items.find((i) => i.id === id)); setView('detail') }
  function goList() { setView('list'); setEditing(null) }

  // True if a free (expired-trial) user is at their container cap.
  function atContainerLimit() {
    return !plan.fullAccess && items.length >= FREE_CONTAINER_LIMIT
  }

  function newItem() {
    if (atContainerLimit()) { setView('upgrade'); return }
    setEditing({ id: uid(), name: '', location: '', category: '', description: '', contents: [], photos: [], created: Date.now() })
    setView('form')
  }

  async function toggleReseller() {
    // Reseller mode is a full-access feature.
    if (!plan.fullAccess && !resellerMode) { setView('upgrade'); return }
    const next = !resellerMode
    setResellerMode(next)
    try { await saveSettings(user.id, { resellerMode: next }) } catch (e) { flash('Could not save setting') }
  }

  async function saveItem(item) {
    try {
      await upsertContainer(user.id, item, space)
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === item.id)
        if (idx >= 0) { const c = [...prev]; c[idx] = item; return c }
        return [item, ...prev]
      })
      setEditing(item); setView('detail'); flash('Saved')
    } catch (e) { flash('Save failed') }
  }

  async function quickAddItem(container, newItem) {
    const updated = { ...container, contents: [...(container.contents || []), newItem] }
    try {
      await upsertContainer(user.id, updated, space)
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === updated.id)
        if (idx >= 0) { const c = [...prev]; c[idx] = updated; return c }
        return [updated, ...prev]
      })
      setEditing(updated)
      flash('Item added')
      return updated
    } catch (e) { flash('Could not add item'); return null }
  }

  // Remove or archive a single item from a container's contents.
  // mode: 'remove' = delete outright; otherwise log to history with the given reason.
  // extra: optional fields to merge (e.g. { sale } captured at sell time).
  async function pullItem(container, index, mode, extra) {
    const contents = [...(container.contents || [])]
    const pulled = contents[index]
    if (!pulled) return
    contents.splice(index, 1)
    let history = container.history || []
    if (mode !== 'remove') {
      history = [{ ...pulled, ...(extra || {}), pulledAt: Date.now(), reason: mode }, ...history]
    }
    const updated = { ...container, contents, history }
    try {
      await upsertContainer(user.id, updated, space)
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === updated.id)
        if (idx >= 0) { const c = [...prev]; c[idx] = updated; return c }
        return prev
      })
      setEditing(updated)
      flash(mode === 'remove' ? 'Item removed' : `Marked ${mode}`)
      return updated
    } catch (e) { flash('Could not update'); return null }
  }

  async function batchCreate(count) {
    if (!plan.fullAccess && items.length + count > FREE_CONTAINER_LIMIT) {
      setView('upgrade'); return null
    }
    const ids = Array.from({ length: count }, () => uid())
    try {
      await createBlankContainers(user.id, ids, space)
      const now = Date.now()
      const blanks = ids.map((id, i) => ({
        id, name: 'Untitled', location: '', category: '', description: '',
        expires: '', photos: [], contents: [], history: [], created: now - i,
      }))
      setItems((prev) => [...blanks, ...prev])
      flash(`Created ${count} container${count > 1 ? 's' : ''}`)
      return ids
    } catch (e) { flash('Could not create containers'); return null }
  }

  async function moveItem(item, targetSpace) {
    if ((targetSpace || null) === (space || null)) return
    try {
      await moveContainer(item.id, targetSpace)
      // It's leaving the space we're currently viewing, so drop it from the list.
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      goList()
      const dest = targetSpace ? (households.find((h) => h.id === targetSpace)?.name || 'household') : 'Personal'
      flash(`Moved to ${dest}`)
    } catch (e) { flash('Could not move') }
  }

  async function removeItem(item) {
    if (!confirm('Delete this container?')) return
    try {
      for (const p of item.photos || []) await deletePhoto(p)
      await deleteContainer(item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      goList(); flash('Deleted')
    } catch (e) { flash('Delete failed') }
  }

  if (loading) return <div className="app"><div className="full-center"><div className="spinner" /><p className="muted">Loading your inventory…</p></div></div>

  // Phase-one stand-in for Stripe: flips the account to paid. Stripe will call this later.
  async function simulateUpgrade() {
    try {
      await saveSettings(user.id, { plan: 'active' })
      setPlan(planState('active', null))
      flash('Upgraded — full access unlocked')
      goList()
    } catch (e) { flash('Could not upgrade') }
  }

  const common = { items, resellerMode, user, flash }
  return (
    <div className="app">
      {view === 'list' && <ListView {...common} {...{ query, setQuery, sortBy, setSortBy, openDetail, newItem, setView, households, space, setSpace, plan, signOut: () => supabase.auth.signOut() }} />}
      {view === 'form' && <FormView {...common} editing={editing} setEditing={setEditing} onSave={saveItem} onBack={() => (items.find((i) => i.id === editing.id) ? setView('detail') : goList())} />}
      {view === 'detail' && <DetailView {...common} item={editing} onEdit={() => setView('form')} onDelete={() => removeItem(editing)} onBack={goList} onQuickAdd={() => setView('quickadd')} onPull={pullItem} onMove={moveItem} households={households} space={space} />}
      {view === 'scan' && <ScanView items={items} resellerMode={resellerMode} onFound={openDetail} onBack={goList} flash={flash} onQuickAdd={quickAddItem} />}
      {view === 'quickadd' && <QuickAddView container={editing} resellerMode={resellerMode} onAdd={quickAddItem} onDone={() => setView('detail')} onBack={() => setView('detail')} />}
      {view === 'batch' && <BatchView onCreate={batchCreate} onBack={goList} />}
      {view === 'expiring' && <ExpiringView items={items} resellerMode={resellerMode} onOpen={openDetail} onPull={pullItem} onBack={goList} />}
      {view === 'sales' && <SalesView items={items} onBack={goList} />}
      {view === 'households' && <HouseholdsView user={user} households={households} space={space} setSpace={setSpace} reload={reloadHouseholds} onBack={goList} flash={flash} plan={plan} onUpgrade={() => setView('upgrade')} />}
      {view === 'upgrade' && <UpgradeView plan={plan} itemCount={items.length} onUpgrade={simulateUpgrade} onBack={goList} />}
      {view === 'settings' && <SettingsView resellerMode={resellerMode} toggleReseller={toggleReseller} onBack={goList} signOut={() => supabase.auth.signOut()} email={user.email} plan={plan} onUpgrade={() => setView('upgrade')} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/* ---------------- List ---------------- */
function ListView({ items, resellerMode, query, setQuery, sortBy, setSortBy, openDetail, newItem, setView, households, space, setSpace, plan }) {
  const q = query.trim().toLowerCase()
  let results = items.map((it) => ({ it, hit: null }))
  if (q) {
    results = []
    for (const it of items) {
      const fields = [it.name, it.category, it.location, it.description].map((x) => (x || '').toLowerCase())
      const hits = (it.contents || []).filter((c) => (c.name || '').toLowerCase().includes(q)).map((c) => c.name)
      if (fields.some((f) => f.includes(q)) || hits.length) results.push({ it, hit: hits.length ? hits : null })
    }
  }
  results.sort((a, b) => {
    if (sortBy === 'recent') return (b.it.created || 0) - (a.it.created || 0)
    if (sortBy === 'name') return (a.it.name || '').localeCompare(b.it.name || '')
    if (sortBy === 'location') return (a.it.location || '').localeCompare(b.it.location || '')
    if (sortBy === 'value') return containerValue(b.it) - containerValue(a.it)
    return 0
  })
  const total = resellerMode
    ? items.reduce((s, it) => s + containerProfit(it), 0)
    : items.reduce((s, it) => s + containerValue(it), 0)
  const expiringCount = collectExpiring(items, 30).length
  const activeName = space ? (households.find((h) => h.id === space)?.name || 'Household') : 'Personal'

  return (
    <>
      <div className="topbar">
        <h1>{activeName}</h1>
        <button className="iconbtn" aria-label="Settings" onClick={() => setView('settings')}>⚙</button>
      </div>

      {plan && plan.state === 'trial' && (
        <button onClick={() => setView('upgrade')}
          style={{ width: '100%', textAlign: 'left', border: '1px solid var(--border-strong)', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 'var(--radius)', padding: '11px 15px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <span style={{ flex: 1, fontSize: 14 }}>Free trial — {plan.trialDaysLeft} day{plan.trialDaysLeft !== 1 ? 's' : ''} left</span>
          <span style={{ fontSize: 13, color: 'var(--brand)' }}>Upgrade ›</span>
        </button>
      )}
      {plan && plan.state === 'free' && (
        <button onClick={() => setView('upgrade')}
          style={{ width: '100%', textAlign: 'left', border: '1px solid var(--brand)', background: 'var(--brand-bg)', color: 'var(--brand-text)', borderRadius: 'var(--radius)', padding: '11px 15px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔓</span>
          <span style={{ flex: 1, fontSize: 14 }}>Free plan · {items.length}/{FREE_CONTAINER_LIMIT} containers used</span>
          <span style={{ fontSize: 13 }}>Upgrade ›</span>
        </button>
      )}

      <div className="row" style={{ marginBottom: 14, alignItems: 'center' }}>
        <select value={space || ''} onChange={(e) => setSpace(e.target.value || null)} aria-label="Switch space">
          <option value="">🔒 Personal</option>
          {households.map((h) => <option key={h.id} value={h.id}>🏠 {h.name}</option>)}
        </select>
        <button className="iconbtn" title="Manage households" aria-label="Manage households" onClick={() => setView('households')}>👥</button>
      </div>

      {items.length > 0 && (
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="stat"><p className="label">Containers</p><p className="value">{items.length}</p></div>
          <div className="stat"><p className="label">{resellerMode ? 'Profit' : 'Total value'}</p><p className="value">{money(total) || '$0.00'}</p></div>
        </div>
      )}

      {expiringCount > 0 && (
        <button onClick={() => setView('expiring')}
          style={{ width: '100%', textAlign: 'left', border: '1px solid var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 'var(--radius)', padding: '12px 15px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>⏰</span>
          <span style={{ flex: 1 }}>{expiringCount} item{expiringCount > 1 ? 's' : ''} expiring soon or expired</span>
          <span>›</span>
        </button>
      )}

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={newItem}>＋ New</button>
        <button className="btn" onClick={() => setView('scan')}>▢ Scan</button>
      </div>
      <button className="btn ghost" onClick={() => setView('batch')} style={{ marginBottom: 14 }}>
        ⧉ Print blank labels (set up bins later)
      </button>
      {resellerMode && (
        <button className="btn" onClick={() => setView('sales')} style={{ marginBottom: 14, display: 'flex', justifyContent: 'center', gap: 7 }}>
          📊 Sales summary
        </button>
      )}

      {items.length > 0 && (
        <>
          <div className="search" style={{ marginBottom: 10 }}>
            <span className="ico">⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an item, location, or box…" />
          </div>
          <div className="row" style={{ marginBottom: 16, alignItems: 'center' }}>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="recent">Most recent</option>
              <option value="name">Name A–Z</option>
              <option value="location">Location</option>
              <option value="value">Highest value</option>
            </select>
            <button className="iconbtn" title="Print all labels" onClick={() => printAll(items)}>🖨</button>
            <button className="iconbtn" title="Export CSV" onClick={() => exportCSV(items, resellerMode)}>⤓</button>
          </div>
        </>
      )}

      {!items.length && <div className="full-center muted center"><div style={{ fontSize: 40 }}>📦</div><p>No containers yet.<br />Create your first one above.</p></div>}
      {items.length > 0 && !results.length && <p className="center muted" style={{ padding: '2rem 0' }}>No matches for “{query}”.</p>}

      {results.map(({ it, hit }) => {
        const cv = containerValue(it)
        const se = soonestExp(it)
        const st = expStatus(se)
        return (
          <div key={it.id} className="listcard" onClick={() => openDetail(it.id)}>
            {it.photos && it.photos[0]
              ? <img className="thumb" src={it.photos[0]} alt="" />
              : <div className="thumb placeholder">📦</div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="ellip" style={{ fontWeight: 500, margin: 0 }}>{it.name || 'Untitled'}</p>
              <p className="ellip muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
                {it.location ? `📍 ${it.location}` : 'No location'} · {it.contents ? it.contents.length : 0} items{cv ? ` · ${money(cv)}` : ''}
              </p>
              {hit && <p className="ellip" style={{ fontSize: 12, color: 'var(--brand)', margin: '3px 0 0' }}>↳ {hit.join(', ')}</p>}
              {(st === 'expired' || st === 'soon') && (
                <span className={`pill ${st}`} style={{ marginTop: 4, display: 'inline-block' }}>{expLabel(se)}</span>
              )}
            </div>
            <span className="muted">›</span>
          </div>
        )
      })}
    </>
  )
}

/* ---------------- Form ---------------- */
function FormView({ editing, setEditing, onSave, onBack, resellerMode, user, flash }) {
  const [it, setIt] = useState(editing)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const set = (k, v) => setIt((p) => ({ ...p, [k]: v }))
  const setContent = (i, k, v) => setIt((p) => { const c = [...p.contents]; c[i] = { ...c[i], [k]: v }; return { ...p, contents: c } })
  const addContent = () => setIt((p) => ({ ...p, contents: [...(p.contents || []), { name: '', qty: 1, status: 'In stock' }] }))
  const removeContent = (i) => setIt((p) => ({ ...p, contents: p.contents.filter((_, j) => j !== i) }))

  async function onPhoto(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    if ((it.photos || []).length >= MAX_PHOTOS) return
    setUploading(true)
    try {
      const blob = await shrinkImage(file)
      const url = await uploadPhoto(user.id, blob)
      setIt((p) => ({ ...p, photos: [...(p.photos || []), url] }))
    } catch (err) { flash('Photo upload failed') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }
  async function removePhoto(i) {
    const url = it.photos[i]
    setIt((p) => ({ ...p, photos: p.photos.filter((_, j) => j !== i) }))
    deletePhoto(url)
  }

  function save() {
    const cleaned = { ...it, contents: (it.contents || []).filter((c) => (c.name || '').trim()), name: (it.name || '').trim() || 'Untitled' }
    onSave(cleaned)
  }

  const isNew = !editing.name && !editing.contents.length
  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1>{isNew ? 'New container' : 'Edit container'}</h1>
      </div>

      <label className="field">Name</label>
      <input value={it.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Garage bin A" style={{ marginBottom: 14 }} />
      <label className="field">Location</label>
      <input value={it.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Garage → Shelf 3" style={{ marginBottom: 14 }} />
      <label className="field">Category</label>
      <input value={it.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Holiday decorations" style={{ marginBottom: 14 }} />
      <label className="field">Description</label>
      <textarea value={it.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional notes" style={{ marginBottom: 14 }} />
      <label className="field">Container expiration (optional)</label>
      <input type="date" value={it.expires || ''} onChange={(e) => set('expires', e.target.value)} style={{ marginBottom: 14 }} />

      <label className="field">Photos (up to {MAX_PHOTOS})</label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {(it.photos || []).map((p, i) => (
          <div key={i} style={{ position: 'relative', width: 84, height: 84 }}>
            <img src={p} alt={`Photo ${i + 1}`} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 9, border: '1px solid var(--border)' }} />
            <button className="iconbtn" aria-label="Remove photo" onClick={() => removePhoto(i)}
              style={{ position: 'absolute', top: -10, right: -10, width: 26, height: 26, borderRadius: '50%', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 14 }}>✕</button>
          </div>
        ))}
        {(it.photos || []).length < MAX_PHOTOS && (
          <button className="iconbtn" aria-label="Add photo" disabled={uploading} onClick={() => fileRef.current && fileRef.current.click()}
            style={{ width: 84, height: 84, flexDirection: 'column', gap: 4, borderStyle: 'dashed' }}>
            {uploading ? <div className="spinner" /> : <><span style={{ fontSize: 22 }}>📷</span><span style={{ fontSize: 11 }}>Add</span></>}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPhoto} />
      </div>

      <label className="field">Inventory contents{resellerMode ? ' (with sales tracking)' : ''}</label>
      {(it.contents || []).map((c, i) => (
        <div key={i} className="itemrow">
          <div className="row" style={{ alignItems: 'center', marginBottom: resellerMode || true ? 8 : 0 }}>
            <input value={c.name} onChange={(e) => setContent(i, 'name', e.target.value)} placeholder="Item name" />
            <input type="number" min="1" value={c.qty || 1} onChange={(e) => setContent(i, 'qty', e.target.value)} aria-label="Quantity" style={{ width: 64 }} />
            <button className="iconbtn" aria-label="Remove" onClick={() => removeContent(i)}>🗑</button>
          </div>
          {resellerMode ? (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <input type="number" step="0.01" value={c.cost ?? ''} onChange={(e) => setContent(i, 'cost', e.target.value)} placeholder="Cost / paid $" />
                <input type="number" step="0.01" value={c.sale ?? ''} onChange={(e) => setContent(i, 'sale', e.target.value)} placeholder="Sale $" />
              </div>
              <div className="row" style={{ marginBottom: 8 }}>
                <input value={c.marketplace || ''} onChange={(e) => setContent(i, 'marketplace', e.target.value)} placeholder="Marketplace" />
                <input value={c.sku || ''} onChange={(e) => setContent(i, 'sku', e.target.value)} placeholder="SKU" />
              </div>
              <select value={c.status || 'In stock'} onChange={(e) => setContent(i, 'status', e.target.value)}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </>
          ) : (
            <input type="number" step="0.01" value={c.value ?? ''} onChange={(e) => setContent(i, 'value', e.target.value)} placeholder="Value $ (optional)" />
          )}
          <label className="field" style={{ marginTop: 8 }}>Expiration (optional)</label>
          <input type="date" value={c.expires || ''} onChange={(e) => setContent(i, 'expires', e.target.value)} />
        </div>
      ))}
      <button className="btn" onClick={addContent} style={{ marginBottom: 22 }}>＋ Add item</button>
      <button className="btn primary" onClick={save}>Save container</button>
    </>
  )
}

/* ---------------- Detail ---------------- */
function DetailView({ item, resellerMode, onEdit, onDelete, onBack, onQuickAdd, onPull, onMove, households, space }) {
  const [qr, setQr] = useState('')
  const [pullIdx, setPullIdx] = useState(null)   // index of item being pulled (shows action sheet)
  const [showMove, setShowMove] = useState(false)
  const [sellIdx, setSellIdx] = useState(null)   // index in sell-price entry mode
  const [sellPrice, setSellPrice] = useState('')
  const [sellCost, setSellCost] = useState('')
  const [fees, setFees] = useState({ sellerFee: '', ccFee: '', shipping: '', packing: '' })
  const [showFees, setShowFees] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  useEffect(() => { qrDataUrl(item.id).then(setQr) }, [item.id])
  const cv = containerValue(item)
  const profit = containerProfit(item)
  const cExp = expStatus(item.expires)

  function resetSell() {
    setSellIdx(null); setSellPrice(''); setSellCost(''); setPullIdx(null)
    setFees({ sellerFee: '', ccFee: '', shipping: '', packing: '' }); setShowFees(false)
  }
  function confirmSell(i, c) {
    const sale = sellPrice === '' ? c.sale : sellPrice
    const cost = sellCost === '' ? c.cost : sellCost
    onPull(item, i, 'sold', {
      sale, cost,
      sellerFee: fees.sellerFee, ccFee: fees.ccFee, shipping: fees.shipping, packing: fees.packing,
    })
    resetSell()
  }
  const feeTotal = num(fees.sellerFee) + num(fees.ccFee) + num(fees.shipping) + num(fees.packing)

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1>Container</h1>
      </div>

      <div className="qrwrap" style={{ marginBottom: 14 }}>
        {qr ? <img src={qr} alt="QR code" /> : <div className="spinner" />}
        <p className="mono" style={{ marginTop: 10 }}>{item.id}</p>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => printLabel(item)}>🖨 Print label</button>
        <button className="btn" onClick={onEdit}>✎ Edit</button>
      </div>
      <button className="btn primary" onClick={onQuickAdd} style={{ marginBottom: 12 }}>＋ Add item to this container</button>
      {(households.length > 0 || space) && (
        <>
          <button className="btn" onClick={() => setShowMove(!showMove)} style={{ marginBottom: showMove ? 10 : 16, justifyContent: 'space-between' }}>
            <span>↪ Move to another space</span>
            <span className="muted">{showMove ? '▲' : '▼'}</span>
          </button>
          {showMove && (
            <div className="card" style={{ marginBottom: 16, padding: 12 }}>
              <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Move “{item.name}” to:</p>
              {space && (
                <button className="btn" style={{ marginBottom: 8 }} onClick={() => { onMove(item, null); setShowMove(false) }}>🔒 Personal</button>
              )}
              {households.filter((h) => h.id !== space).map((h) => (
                <button key={h.id} className="btn" style={{ marginBottom: 8 }} onClick={() => { onMove(item, h.id); setShowMove(false) }}>🏠 {h.name}</button>
              ))}
              <button className="btn ghost" onClick={() => setShowMove(false)}>Cancel</button>
            </div>
          )}
        </>
      )}

      <h2 style={{ fontSize: 18, marginBottom: 8 }}>{item.name}</h2>
      {item.location && <div className="badge brand" style={{ marginBottom: 12 }}>📍 {item.location}</div>}
      {item.expires && <div style={{ marginBottom: 12 }}><span className={`pill ${cExp}`}>{expLabel(item.expires)}</span></div>}
      <p className="muted" style={{ margin: '0 0 12px' }}>{item.category || 'No category'}</p>

      {item.photos && item.photos.length > 0 && (
        <div className="row" style={{ marginBottom: 16 }}>
          {item.photos.map((p, i) => (
            <a key={i} href={p} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0 }}>
              <img src={p} alt="Container" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 9, border: '1px solid var(--border)' }} />
            </a>
          ))}
        </div>
      )}

      {item.description && <p style={{ marginBottom: 16, lineHeight: 1.6 }}>{item.description}</p>}

      {resellerMode ? (
        <div className="row" style={{ marginBottom: 16 }}>
          <div className="stat"><p className="label">Value</p><p className="value" style={{ fontSize: 20 }}>{money(cv) || '$0.00'}</p></div>
          <div className="stat"><p className="label">Profit</p><p className="value" style={{ fontSize: 20, color: profit >= 0 ? 'var(--ok-text)' : 'var(--danger)' }}>{money(profit) || '$0.00'}</p></div>
        </div>
      ) : (cv > 0 && (
        <div className="stat" style={{ marginBottom: 16 }}><p className="label">Total value</p><p className="value" style={{ fontSize: 20 }}>{money(cv)}</p></div>
      ))}

      <p className="muted" style={{ fontWeight: 500, fontSize: 13, margin: '0 0 6px' }}>Contents ({item.contents ? item.contents.length : 0})</p>
      <div style={{ marginBottom: 22 }}>
        {(!item.contents || !item.contents.length) && <p className="muted" style={{ fontSize: 14 }}>No items listed</p>}
        {(item.contents || []).map((c, i) => {
          const iExp = expStatus(c.expires)
          return (
          <div key={i} style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 14 }}>{c.name}{c.qty > 1 ? ` ×${c.qty}` : ''}</span>
              {resellerMode
                ? <span className={`pill ${statusClass(c.status || 'In stock')}`}>{c.status || 'In stock'}</span>
                : (c.value ? <span className="muted" style={{ fontSize: 13 }}>{money(num(c.value) * (num(c.qty) || 1))}</span> : null)}
              <button className="iconbtn" aria-label="Pull item" title="Pull / use / sell" style={{ width: 32, height: 32, fontSize: 15 }} onClick={() => setPullIdx(pullIdx === i ? null : i)}>↗</button>
            </div>
            {(c.expires || (resellerMode && (c.cost || c.sale || c.marketplace || c.sku))) && (
              <p className="muted" style={{ fontSize: 12, margin: '3px 0 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {c.expires && <span className={`pill ${iExp}`}>{expLabel(c.expires)}</span>}
                {resellerMode && (c.cost || c.sale || c.marketplace || c.sku) && (
                  <span>{c.cost ? `cost ${money(c.cost)}` : ''}{c.sale ? ` · sale ${money(c.sale)}` : ''}{c.marketplace ? ` · ${c.marketplace}` : ''}{c.sku ? ` · ${c.sku}` : ''}</span>
                )}
              </p>
            )}
            {pullIdx === i && (
              <div className="card" style={{ marginTop: 8, padding: 12 }}>
                {sellIdx === i ? (
                  <>
                    <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>Record sale of “{c.name}”</p>
                    <label className="field">Sold for $</label>
                    <input type="number" step="0.01" autoFocus value={sellPrice}
                      onChange={(e) => setSellPrice(e.target.value)} placeholder={c.sale ? `${c.sale}` : 'Sale price'}
                      style={{ marginBottom: 10 }} />
                    <label className="field">What you paid $ (cost)</label>
                    <input type="number" step="0.01" value={sellCost}
                      onChange={(e) => setSellCost(e.target.value)} placeholder={c.cost ? `${c.cost}` : 'Cost'}
                      style={{ marginBottom: 10 }} />

                    <button className="btn ghost" onClick={() => setShowFees(!showFees)}
                      style={{ justifyContent: 'space-between', marginBottom: showFees ? 10 : 10 }}>
                      <span>Selling fees{feeTotal > 0 ? ` (${money(feeTotal)})` : ' (optional)'}</span>
                      <span className="muted">{showFees ? '▲' : '▼'}</span>
                    </button>
                    {showFees && (
                      <div style={{ marginBottom: 10 }}>
                        <div className="row" style={{ marginBottom: 8 }}>
                          <div style={{ flex: 1 }}><label className="field">Seller / marketplace fee $</label>
                            <input type="number" step="0.01" value={fees.sellerFee} onChange={(e) => setFees({ ...fees, sellerFee: e.target.value })} /></div>
                          <div style={{ flex: 1 }}><label className="field">Card processing fee $</label>
                            <input type="number" step="0.01" value={fees.ccFee} onChange={(e) => setFees({ ...fees, ccFee: e.target.value })} /></div>
                        </div>
                        <div className="row">
                          <div style={{ flex: 1 }}><label className="field">Shipping $</label>
                            <input type="number" step="0.01" value={fees.shipping} onChange={(e) => setFees({ ...fees, shipping: e.target.value })} /></div>
                          <div style={{ flex: 1 }}><label className="field">Packing materials $</label>
                            <input type="number" step="0.01" value={fees.packing} onChange={(e) => setFees({ ...fees, packing: e.target.value })} /></div>
                        </div>
                      </div>
                    )}

                    <div className="stat" style={{ marginBottom: 10 }}>
                      <p className="label">Net profit (sale − cost − fees)</p>
                      <p className="value" style={{ fontSize: 20, color: (num(sellPrice || c.sale) - num(sellCost || c.cost) - feeTotal) >= 0 ? 'var(--ok-text)' : 'var(--danger)' }}>
                        {money(num(sellPrice || c.sale) - num(sellCost || c.cost) - feeTotal)}
                      </p>
                    </div>
                    <div className="row">
                      <button className="btn primary" onClick={() => confirmSell(i, c)}>Confirm sale</button>
                      <button className="btn ghost" onClick={resetSell}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Pull “{c.name}” out — what happened to it?</p>
                    <div className="row" style={{ marginBottom: 8 }}>
                      <button className="btn" onClick={() => { onPull(item, i, 'used'); setPullIdx(null) }}>Used</button>
                      <button className="btn" onClick={() => { setSellIdx(i); setSellPrice(c.sale ?? ''); setSellCost(c.cost ?? '') }}>Sold</button>
                    </div>
                    <div className="row">
                      <button className="btn danger" onClick={() => { onPull(item, i, 'remove'); setPullIdx(null) }}>Remove</button>
                      <button className="btn ghost" onClick={() => setPullIdx(null)}>Cancel</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )})}
      </div>

      {(item.history && item.history.length > 0) && (
        <div style={{ marginBottom: 22 }}>
          <button className="btn ghost" onClick={() => setShowHistory(!showHistory)} style={{ justifyContent: 'space-between' }}>
            <span>Pulled / used / sold ({item.history.length})</span>
            <span className="muted">{showHistory ? '▲' : '▼'}</span>
          </button>
          {showHistory && (
            <div style={{ marginTop: 8 }}>
              {item.history.map((h, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{h.name}{h.qty > 1 ? ` ×${h.qty}` : ''}{h.reason === 'sold' && h.sale ? ` · ${money(h.sale)}` : ''}</span>
                  <span className={`pill ${h.reason === 'sold' ? 'sold' : 'used'}`}>{h.reason}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{h.pulledAt ? new Date(h.pulledAt).toLocaleDateString() : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button className="btn danger" onClick={onDelete}>🗑 Delete container</button>
    </>
  )
}

/* ---------------- Scan ---------------- */
function ScanView({ items, resellerMode, onFound, onBack, flash, onQuickAdd }) {
  const [err, setErr] = useState('')
  const [notFound, setNotFound] = useState('')
  const [matched, setMatched] = useState(null)   // container found by scan, awaiting choice
  const [adding, setAdding] = useState(false)     // showing quick-add form for matched

  useEffect(() => {
    if (matched || adding) return   // camera off once we've matched
    let scanner
    const id = 'qr-reader'
    const start = async () => {
      try {
        scanner = new Html5Qrcode(id)
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text) => {
            const found = items.find((i) => i.id === text)
            stop().then(() => { if (found) setMatched(found); else setNotFound(text) })
          },
          () => {}
        )
      } catch (e) {
        setErr('Could not access the camera. Pick a container from the list instead.')
      }
    }
    const stop = async () => {
      try { if (scanner && scanner.isScanning) await scanner.stop() } catch (e) {}
      try { if (scanner) scanner.clear() } catch (e) {}
    }
    start()
    return () => { stop() }
  }, [items, matched, adding])

  function rescan() { setMatched(null); setNotFound(''); setAdding(false) }

  if (adding && matched) {
    return (
      <QuickAddView
        container={matched}
        resellerMode={resellerMode}
        onAdd={onQuickAdd}
        onBack={() => setAdding(false)}
        onDone={() => { setAdding(false); }}
        afterAddLabel="Scan another container"
        onAfterAll={rescan}
        embeddedTitle={`Add to “${matched.name}”`}
      />
    )
  }

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1>Scan a code</h1>
      </div>

      {matched ? (
        <div className="full-center center" style={{ gap: 18 }}>
          <div style={{ fontSize: 36 }}>✅</div>
          <div>
            <p style={{ fontWeight: 500, margin: 0, fontSize: 18 }}>{matched.name}</p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {matched.location ? `📍 ${matched.location} · ` : ''}{(matched.contents || []).length} items
            </p>
          </div>
          <div style={{ width: '100%', maxWidth: 320 }}>
            <button className="btn primary" style={{ marginBottom: 10 }} onClick={() => setAdding(true)}>＋ Add an item here</button>
            <button className="btn" style={{ marginBottom: 10 }} onClick={() => onFound(matched.id)}>Open container</button>
            <button className="btn ghost" onClick={rescan}>Scan another</button>
          </div>
        </div>
      ) : !notFound ? (
        <>
          <div id="qr-reader" style={{ width: '100%', borderRadius: 14, overflow: 'hidden', background: '#000' }} />
          <p className="center muted" style={{ fontSize: 13, marginTop: 12 }}>
            {err || 'Point your camera at a container’s QR code.'}
          </p>
        </>
      ) : (
        <div className="full-center center muted">
          <div style={{ fontSize: 36 }}>❔</div>
          <p>Scanned code <span className="mono">{notFound}</span><br />doesn’t match any container.</p>
          <button className="btn" style={{ width: 'auto' }} onClick={rescan}>Scan again</button>
        </div>
      )}
    </>
  )
}

/* ---------------- Quick add item ---------------- */
function QuickAddView({ container, resellerMode, onAdd, onBack, onDone, afterAddLabel, onAfterAll, embeddedTitle }) {
  const [c, setC] = useState({ name: '', qty: 1, status: 'In stock' })
  const [justAdded, setJustAdded] = useState(0)   // count added this session
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setC((p) => ({ ...p, [k]: v }))

  async function add(stayOnScreen) {
    if (!(c.name || '').trim()) return
    setBusy(true)
    const ok = await onAdd(container, { ...c, name: c.name.trim() })
    setBusy(false)
    if (!ok) return
    setJustAdded((n) => n + 1)
    setC({ name: '', qty: 1, status: 'In stock' })
    if (!stayOnScreen) onDone()
  }

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>{embeddedTitle || `Add to “${container.name}”`}</h1>
      </div>

      {container.location && <div className="badge brand" style={{ marginBottom: 14 }}>📍 {container.location}</div>}
      {justAdded > 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 14 }}>
          Added {justAdded} item{justAdded > 1 ? 's' : ''} so far. Container now has {(container.contents || []).length}.
        </p>
      )}

      <label className="field">Item name</label>
      <input value={c.name} autoFocus onChange={(e) => set('name', e.target.value)}
        placeholder="e.g. Cordless drill" style={{ marginBottom: 14 }}
        onKeyDown={(e) => e.key === 'Enter' && add(true)} />

      <div className="row" style={{ marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="field">Quantity</label>
          <input type="number" min="1" value={c.qty} onChange={(e) => set('qty', e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field">Expiration (optional)</label>
          <input type="date" value={c.expires || ''} onChange={(e) => set('expires', e.target.value)} />
        </div>
      </div>
      {!resellerMode && (
        <div style={{ marginBottom: 14 }}>
          <label className="field">Value $ (optional)</label>
          <input type="number" step="0.01" value={c.value ?? ''} onChange={(e) => set('value', e.target.value)} />
        </div>
      )}

      {resellerMode && (
        <>
          <div className="row" style={{ marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="field">Cost / paid $</label>
              <input type="number" step="0.01" value={c.cost ?? ''} onChange={(e) => set('cost', e.target.value)} placeholder="What you paid" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field">Sale $ (if listed)</label>
              <input type="number" step="0.01" value={c.sale ?? ''} onChange={(e) => set('sale', e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="field">Marketplace</label>
              <input value={c.marketplace || ''} onChange={(e) => set('marketplace', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field">SKU</label>
              <input value={c.sku || ''} onChange={(e) => set('sku', e.target.value)} />
            </div>
          </div>
          <label className="field">Status</label>
          <select value={c.status} onChange={(e) => set('status', e.target.value)} style={{ marginBottom: 14 }}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </>
      )}

      <button className="btn primary" disabled={busy} onClick={() => add(true)} style={{ marginBottom: 10 }}>
        {busy ? 'Adding…' : '＋ Add & keep going'}
      </button>
      <button className="btn" onClick={() => add(false)} style={{ marginBottom: 10 }}>Add & finish</button>
      {onAfterAll && <button className="btn ghost" onClick={onAfterAll}>{afterAddLabel || 'Done'}</button>}
    </>
  )
}


/* ---------------- Expiring dashboard ---------------- */
function ExpiringView({ items, resellerMode, onOpen, onPull, onBack }) {
  const [days, setDays] = useState(30)
  const list = collectExpiring(items, days)
  const expired = list.filter((x) => x.status === 'expired')
  const soon = list.filter((x) => x.status === 'soon')

  function pullByRef(ref, mode) {
    const container = items.find((i) => i.id === ref.containerId)
    if (!container) return
    onPull(container, ref.index, mode)
  }

  const Section = ({ title, rows, tone }) => (
    rows.length > 0 && (
      <>
        <p style={{ fontWeight: 500, fontSize: 14, margin: '16px 0 8px', color: tone }}>{title} ({rows.length})</p>
        {rows.map((x, i) => (
          <div key={i} className="card" style={{ marginBottom: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 15 }}>{x.name}{x.qty > 1 ? ` ×${x.qty}` : ''}</span>
              <span className={`pill ${x.status}`}>{expLabel(x.expires)}</span>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
              in <strong>{x.containerName}</strong>{x.location ? ` · 📍 ${x.location}` : ''}
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => onOpen(x.containerId)}>Open box</button>
              {x.kind === 'item' && <button className="btn" onClick={() => pullByRef(x, 'used')}>Mark used</button>}
            </div>
          </div>
        ))}
      </>
    )
  )

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Expiring soon</h1>
      </div>

      <label className="field">Show items expiring within</label>
      <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} style={{ marginBottom: 8 }}>
        <option value={7}>7 days</option>
        <option value={14}>14 days</option>
        <option value={30}>30 days</option>
        <option value={60}>60 days</option>
        <option value={90}>90 days</option>
      </select>

      {!list.length && (
        <div className="full-center center muted">
          <div style={{ fontSize: 36 }}>✅</div>
          <p>Nothing expired or expiring in this window.</p>
        </div>
      )}

      <Section title="Expired" rows={expired} tone="var(--danger)" />
      <Section title="Expiring soon" rows={soon} tone="var(--warn-text)" />
    </>
  )
}

/* ---------------- Sales summary (reseller) ---------------- */
function SalesView({ items, onBack }) {
  const [windowDays, setWindowDays] = useState(30)
  const opts = [{ d: 7, l: '7 days' }, { d: 30, l: '30 days' }, { d: 90, l: '90 days' }, { d: 365, l: '1 year' }, { d: null, l: 'All time' }]
  const { sales, totals } = salesSummary(items, windowDays)

  // group revenue by marketplace
  const byMarket = {}
  for (const s of sales) {
    const k = s.marketplace || 'Unspecified'
    byMarket[k] = (byMarket[k] || 0) + s.revenue
  }
  const markets = Object.entries(byMarket).sort((a, b) => b[1] - a[1])

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Sales summary</h1>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {opts.map((o) => (
          <button key={o.l} className={`btn ${windowDays === o.d ? 'primary' : ''}`}
            style={{ width: 'auto', padding: '7px 14px' }} onClick={() => setWindowDays(o.d)}>{o.l}</button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="stat"><p className="label">Revenue</p><p className="value" style={{ fontSize: 22 }}>{money(totals.revenue) || '$0.00'}</p></div>
        <div className="stat"><p className="label">Item cost</p><p className="value" style={{ fontSize: 22 }}>{money(totals.cost) || '$0.00'}</p></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="stat"><p className="label">Selling fees</p><p className="value" style={{ fontSize: 22 }}>{money(totals.fees) || '$0.00'}</p></div>
        <div className="stat"><p className="label">Items sold</p><p className="value" style={{ fontSize: 22 }}>{totals.count}</p></div>
      </div>
      <div className="stat" style={{ marginBottom: 16 }}>
        <p className="label">Net profit (revenue − cost − fees)</p>
        <p className="value" style={{ fontSize: 26, color: totals.profit >= 0 ? 'var(--ok-text)' : 'var(--danger)' }}>{money(totals.profit) || '$0.00'}</p>
      </div>

      <button className="btn" onClick={() => exportSalesCSV(items)} style={{ marginBottom: 18, justifyContent: 'center', gap: 7 }}>
        ⤓ Download sales CSV (all sales)
      </button>

      {markets.length > 0 && (
        <>
          <p className="muted" style={{ fontWeight: 500, fontSize: 13, margin: '0 0 8px' }}>Revenue by marketplace</p>
          <div className="card" style={{ marginBottom: 18, padding: '8px 14px' }}>
            {markets.map(([m, v], i) => (
              <div key={m} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < markets.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 14 }}>{m}</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{money(v)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="muted" style={{ fontWeight: 500, fontSize: 13, margin: '0 0 8px' }}>Sold items ({sales.length})</p>
      {!sales.length && <p className="muted" style={{ fontSize: 14 }}>No sales recorded in this period. Mark an item “Sold” when you pull it to log it here.</p>}
      {sales.map((s, i) => (
        <div key={i} className="card" style={{ marginBottom: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 15 }}>{s.name}{s.qty > 1 ? ` ×${s.qty}` : ''}</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: s.profit >= 0 ? 'var(--ok-text)' : 'var(--danger)' }}>{s.profit >= 0 ? '+' : ''}{money(s.profit)}</span>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '5px 0 0' }}>
            {money(s.revenue)} revenue{s.cost ? ` · ${money(s.cost)} cost` : ''}{s.fees ? ` · ${money(s.fees)} fees` : ''}{s.marketplace ? ` · ${s.marketplace}` : ''}
            {s.soldAt ? ` · ${new Date(s.soldAt).toLocaleDateString()}` : ''}
          </p>
        </div>
      ))}
    </>
  )
}

/* ---------------- Batch blank labels ---------------- */
function BatchView({ onCreate, onBack }) {
  const [count, setCount] = useState(10)
  const [busy, setBusy] = useState(false)
  const [createdIds, setCreatedIds] = useState(null)

  async function make() {
    const n = Math.max(1, Math.min(100, parseInt(count) || 1))
    setBusy(true)
    const ids = await onCreate(n)
    setBusy(false)
    if (ids) setCreatedIds(ids)
  }

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Print blank labels</h1>
      </div>

      {!createdIds ? (
        <>
          <p className="muted" style={{ fontSize: 14, marginTop: 0, lineHeight: 1.6 }}>
            Make a batch of empty containers and print their QR codes now. Stick them on
            your bins, then scan each one later to set its location and add items — no need
            to fill anything in first.
          </p>
          <label className="field" style={{ marginTop: 8 }}>How many?</label>
          <input type="number" min="1" max="100" value={count}
            onChange={(e) => setCount(e.target.value)} style={{ marginBottom: 16 }} />
          <button className="btn primary" disabled={busy} onClick={make}>
            {busy ? 'Creating…' : `Create ${Math.max(1, Math.min(100, parseInt(count) || 1))} blank containers`}
          </button>
        </>
      ) : (
        <div className="center" style={{ paddingTop: 8 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <p style={{ marginTop: 0 }}>{createdIds.length} blank containers created.</p>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>
            Each label shows a short code (like {shortCode(createdIds[0])}) so you can tell
            them apart. Print them, stick them on, and scan to set up each bin.
          </p>
          <button className="btn primary" style={{ marginBottom: 10 }} onClick={() => printBlanks(createdIds)}>🖨 Print these labels</button>
          <button className="btn" onClick={onBack}>Done</button>
        </div>
      )}
    </>
  )
}

/* ---------------- Households ---------------- */
function HouseholdsView({ user, households, space, setSpace, reload, onBack, flash, plan, onUpgrade }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [manage, setManage] = useState(null)   // household being managed
  const [members, setMembers] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')

  async function create() {
    if (!name.trim()) return
    if (plan && !plan.fullAccess) { onUpgrade(); return }
    setBusy(true)
    try { const h = await createHousehold(user.id, name.trim()); await reload(); setName(''); setSpace(h.id); flash('Household created') }
    catch (e) { flash('Could not create') } finally { setBusy(false) }
  }
  async function join() {
    if (!code.trim()) return
    setBusy(true)
    try {
      const hid = await joinHouseholdByCode(code.trim().toUpperCase())
      if (!hid) { flash('No household with that code'); setBusy(false); return }
      await reload(); setCode(''); setSpace(hid); flash('Joined household')
    } catch (e) { flash('Could not join') } finally { setBusy(false) }
  }
  async function openManage(h) {
    setManage(h)
    try { setMembers(await fetchMembers(h.id)) } catch (e) { setMembers([]) }
  }
  async function invite() {
    if (!inviteEmail.trim()) return
    try { await inviteByEmail(manage.id, user.id, inviteEmail); setInviteEmail(''); flash('Invite noted — also share the join code') }
    catch (e) { flash('Could not invite') }
  }
  async function kick(uid2) {
    try { await removeMember(manage.id, uid2); setMembers(await fetchMembers(manage.id)); flash('Member removed') }
    catch (e) { flash('Could not remove') }
  }
  async function changeRole(uid2, role) {
    try { await setMemberRole(manage.id, uid2, role); setMembers(await fetchMembers(manage.id)); flash(role === 'owner' ? 'Promoted to owner' : 'Set to member') }
    catch (e) { flash('Could not change role') }
  }
  async function leave(h) {
    if (!confirm(`Leave “${h.name}”?`)) return
    try { await leaveHousehold(user.id, h.id); if (space === h.id) setSpace(null); await reload(); setManage(null); flash('Left household') }
    catch (e) { flash('Could not leave') }
  }
  async function destroy(h) {
    if (!confirm(`Delete “${h.name}” for everyone? This cannot be undone.`)) return
    try { await deleteHousehold(h.id); if (space === h.id) setSpace(null); await reload(); setManage(null); flash('Household deleted') }
    catch (e) { flash('Could not delete') }
  }

  if (manage) {
    const isOwner = manage.role === 'owner'
    return (
      <>
        <div className="topbar">
          <button className="iconbtn" aria-label="Back" onClick={() => setManage(null)}>‹</button>
          <h1 style={{ fontSize: 18 }}>{manage.name}</h1>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Join code — share this so others can join</p>
          <p style={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 600, letterSpacing: 2, margin: '6px 0 0' }}>{manage.joinCode}</p>
        </div>

        <label className="field">Invite by email (optional)</label>
        <div className="row" style={{ marginBottom: 18 }}>
          <input type="email" value={inviteEmail} autoCapitalize="none" onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@example.com" />
          <button className="btn" style={{ width: 'auto' }} onClick={invite}>Invite</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 18, lineHeight: 1.5 }}>
          Email invites are recorded, but the reliable way in is the join code above — send it by text or however you like, and they enter it to join.
        </p>

        <p className="muted" style={{ fontWeight: 500, fontSize: 13, margin: '0 0 8px' }}>Members ({members.length})</p>
        {members.map((m) => (
          <div key={m.user_id} className="listcard" style={{ padding: '11px 14px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="ellip" style={{ margin: 0, fontSize: 14 }}>{m.email || m.user_id.slice(0, 8)}</p>
              <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{m.role}{m.user_id === user.id ? ' · you' : ''}</p>
            </div>
            {isOwner && m.user_id !== user.id && (
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {m.role === 'owner'
                  ? <button className="btn ghost" style={{ width: 'auto', padding: '6px 10px' }} onClick={() => changeRole(m.user_id, 'member')}>Make member</button>
                  : <button className="btn ghost" style={{ width: 'auto', padding: '6px 10px' }} onClick={() => changeRole(m.user_id, 'owner')}>Make owner</button>}
                <button className="btn ghost" style={{ width: 'auto', padding: '6px 10px', color: 'var(--danger)' }} onClick={() => kick(m.user_id)}>Remove</button>
              </div>
            )}
          </div>
        ))}

        <div style={{ marginTop: 18 }}>
          {!isOwner && <button className="btn danger" onClick={() => leave(manage)}>Leave household</button>}
          {isOwner && <button className="btn danger" onClick={() => destroy(manage)}>Delete household</button>}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Households</h1>
      </div>

      <p className="muted" style={{ fontSize: 14, marginTop: 0, lineHeight: 1.6 }}>
        A household is a shared space — everyone in it sees and edits the same containers.
        Your personal inventory always stays private and separate.
      </p>

      {households.length > 0 && (
        <>
          <p className="muted" style={{ fontWeight: 500, fontSize: 13, margin: '14px 0 8px' }}>Your households</p>
          {households.map((h) => (
            <div key={h.id} className="listcard" onClick={() => openManage(h)} style={{ cursor: 'pointer' }}>
              <div className="thumb placeholder">🏠</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="ellip" style={{ fontWeight: 500, margin: 0 }}>{h.name}</p>
                <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{h.role} · code {h.joinCode}</p>
              </div>
              <span className="muted">›</span>
            </div>
          ))}
        </>
      )}

      <div className="card" style={{ margin: '18px 0 14px' }}>
        <p style={{ fontWeight: 500, margin: '0 0 10px' }}>Create a household</p>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Smith family" />
          <button className="btn primary" style={{ width: 'auto' }} disabled={busy} onClick={create}>Create</button>
        </div>
      </div>

      <div className="card">
        <p style={{ fontWeight: 500, margin: '0 0 10px' }}>Join with a code</p>
        <div className="row">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ENTER CODE" style={{ textTransform: 'uppercase', letterSpacing: 1 }} />
          <button className="btn" style={{ width: 'auto' }} disabled={busy} onClick={join}>Join</button>
        </div>
      </div>
    </>
  )
}

/* ---------------- Upgrade / paywall ---------------- */
function UpgradeView({ plan, itemCount, onUpgrade, onBack }) {
  const features = [
    'Unlimited containers',
    'Reseller mode & sales tracking',
    'Shared households & inviting family',
    'Expiration dashboard & CSV exports',
    'Batch label printing',
  ]
  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Upgrade</h1>
      </div>

      {plan && plan.state === 'trial' && (
        <p className="muted" style={{ marginTop: 0 }}>You have {plan.trialDaysLeft} day{plan.trialDaysLeft !== 1 ? 's' : ''} left in your free trial. Upgrade any time to keep full access.</p>
      )}
      {plan && plan.state === 'free' && (
        <p className="muted" style={{ marginTop: 0 }}>Your free trial has ended. The free plan includes up to {FREE_CONTAINER_LIMIT} containers. Upgrade for unlimited and all features.</p>
      )}

      <div className="card" style={{ margin: '8px 0 14px', border: '2px solid var(--brand)' }}>
        <p style={{ fontWeight: 500, margin: 0, fontSize: 16 }}>BinStashR Plus</p>
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>Everything, unlimited.</p>
        {features.map((f) => (
          <p key={f} style={{ margin: '6px 0', fontSize: 14, display: 'flex', gap: 8 }}><span style={{ color: 'var(--brand)' }}>✓</span>{f}</p>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <div className="stat" style={{ textAlign: 'center' }}><p className="label">Monthly</p><p className="value" style={{ fontSize: 22 }}>$4.99</p></div>
        <div className="stat" style={{ textAlign: 'center' }}><p className="label">Yearly (save ~30%)</p><p className="value" style={{ fontSize: 22 }}>$39.99</p></div>
      </div>

      <button className="btn primary" onClick={onUpgrade} style={{ marginBottom: 10 }}>Upgrade now</button>
      <p className="muted center" style={{ fontSize: 12, lineHeight: 1.6 }}>
        Payment isn’t connected yet — this button currently unlocks full access for testing. Card billing via Stripe is the next step.
      </p>
    </>
  )
}

/* ---------------- Settings ---------------- */
function SettingsView({ resellerMode, toggleReseller, onBack, signOut, email, plan, onUpgrade }) {
  const planLabel = plan ? ({ trial: `Free trial · ${plan.trialDaysLeft}d left`, active: 'Plus (paid) · active', comp: 'Complimentary access', free: 'Free plan' }[plan.state] || plan.state) : ''
  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1>Settings</h1>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 500, margin: 0 }}>Plan</p>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>{planLabel}</p>
          </div>
          {plan && !plan.isPaid && <button className="btn primary" style={{ width: 'auto' }} onClick={onUpgrade}>Upgrade</button>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 500, margin: 0 }}>Reseller mode</p>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0', lineHeight: 1.5 }}>
              Adds cost, sale price, marketplace, SKU and status to each item, plus a profit summary. Turn off for simple home organizing.
            </p>
          </div>
          <button className={`toggle ${resellerMode ? 'on' : ''}`} aria-label="Toggle reseller mode" onClick={toggleReseller}>
            <span className="knob" />
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Signed in as</p>
        <p style={{ margin: '4px 0 0' }}>{email}</p>
      </div>

      <button className="btn" onClick={signOut}>Sign out</button>
      <p className="center muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
        Your data is saved to the cloud and syncs across devices when you’re signed in. Use the export button on the main screen for a CSV backup anytime.
      </p>
    </>
  )
}
