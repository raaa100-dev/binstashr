import React, { useEffect, useState, useRef } from 'react'
import { supabase } from './supabaseClient'
import Auth from './Auth.jsx'
import {
  fetchContainers, upsertContainer, deleteContainer, moveContainer,
  fetchSettings, saveSettings, uploadPhoto, deletePhoto, FREE_CONTAINER_LIMIT,
  createBlankContainers, bulkInsertContainers,
  fetchHouseholds, createHousehold, joinHouseholdByCode,
  fetchMembers, leaveHousehold, removeMember, setMemberRole, deleteHousehold, inviteByEmail,
  fetchMaps, uploadMapImage, createMap, deleteMap, setContainerPin, clearContainerPin,
  submitFeedback,
} from './data'
import {
  STATUSES, uid, num, money, containerValue, containerProfit,
  statusClass, shrinkImage, exportCSV, shortCode, expStatus, expLabel, soonestExp, collectExpiring, salesSummary, exportSalesCSV, planState,
  parseCSV, guessMapping, buildContainersFromCSV,
} from './utils'
import { qrDataUrl, printLabel, printAll, printBlanks, LABEL_SIZES, DEFAULT_SIZE } from './print'
import { Html5Qrcode } from 'html5-qrcode'
import { FREE_FOR_ALL, SHOW_ORDER_LABELS, TERMS_VERSION, COMPANY_NAME, SUPPORT_EMAIL } from './config'
import { TermsText, PrivacyText } from './LegalText'
import { HelpText } from './HelpText'
import { BetaAgreementText } from './BetaText'
import MapView from './MapView.jsx'
import { processMapFile } from './maps'

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
  const [resellerPersonal, setResellerPersonal] = useState(false)   // for Personal space
  const [resellerBySpace, setResellerBySpace] = useState({})        // per-household overrides
  const [households, setHouseholds] = useState([])
  const [space, setSpace] = useState(null)        // null = personal; else household id
  const [maps, setMaps] = useState([])
  const [plan, setPlan] = useState({ state: 'trial', trialDaysLeft: 14, isPaid: false, fullAccess: true })
  const [defaultLabelSize, setDefaultLabelSize] = useState(null)
  const [labelOffsetX, setLabelOffsetX] = useState(0)
  const [labelOffsetY, setLabelOffsetY] = useState(0)
  const [labelRowScale, setLabelRowScale] = useState(1)
  const [termsVersion, setTermsVersion] = useState(0)
  const [onboarded, setOnboarded] = useState(true)   // optimistic; load sets real value
  const [loading, setLoading] = useState(true)
  const [printPicker, setPrintPicker] = useState(null)   // null or { onPick: fn }
  const [activeMapId, setActiveMapId] = useState(null)
  const [pinPickFor, setPinPickFor] = useState(null)     // container being pinned
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
        setResellerPersonal(s.resellerMode)
        setResellerBySpace(s.resellerBySpace || {})
        setHouseholds(hs)
        setPlan(planState(s.plan, s.trialEnds))
        setDefaultLabelSize(s.defaultLabelSize || null)
        setLabelOffsetX(s.labelOffsetX || 0)
        setLabelOffsetY(s.labelOffsetY || 0)
        setLabelRowScale(s.labelRowScale || 1)
        setTermsVersion(s.termsVersion || 0)
        setOnboarded(!!s.onboarded)
        const validSpace = s.activeHousehold && hs.some((h) => h.id === s.activeHousehold) ? s.activeHousehold : null
        setSpace(validSpace)
        const [list, ms] = await Promise.all([fetchContainers(user.id, validSpace), fetchMaps(user.id, validSpace)])
        setItems(list); setMaps(ms)
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
        const [list, ms] = await Promise.all([fetchContainers(user.id, space), fetchMaps(user.id, space)])
        setItems(list); setMaps(ms)
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

  // Effective reseller mode for the active space.
  const resellerMode = space ? !!resellerBySpace[space] : !!resellerPersonal

  async function toggleReseller() {
    if (!plan.fullAccess && !resellerMode) { setView('upgrade'); return }
    if (space) {
      const nextMap = { ...resellerBySpace, [space]: !resellerBySpace[space] }
      setResellerBySpace(nextMap)
      try { await saveSettings(user.id, { resellerBySpace: nextMap }) } catch (e) { flash('Could not save setting') }
    } else {
      const next = !resellerPersonal
      setResellerPersonal(next)
      try { await saveSettings(user.id, { resellerMode: next }) } catch (e) { flash('Could not save setting') }
    }
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

  // Take a lent item from history and put it back in the container's contents.
  async function returnLentItem(container, historyIndex) {
    const history = [...(container.history || [])]
    const entry = history[historyIndex]
    if (!entry || entry.reason !== 'lent') return
    // Strip the pull metadata; keep just the item fields.
    const { pulledAt, reason, lentTo, lentDate, dueDate, ...item } = entry
    history.splice(historyIndex, 1)
    const contents = [...(container.contents || []), item]
    const updated = { ...container, contents, history }
    try {
      await upsertContainer(user.id, updated, space)
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === updated.id)
        if (idx >= 0) { const c = [...prev]; c[idx] = updated; return c }
        return prev
      })
      setEditing(updated)
      flash(`“${item.name || 'Item'}” returned to bin`)
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

  // Move several containers at once. Returns count of successful moves.
  async function bulkMove(ids, targetSpace) {
    if ((targetSpace || null) === (space || null)) return 0
    let ok = 0
    for (const id of ids) {
      try { await moveContainer(id, targetSpace); ok++ } catch (e) {}
    }
    if (ok > 0) {
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)))
      const dest = targetSpace ? (households.find((h) => h.id === targetSpace)?.name || 'household') : 'Personal'
      flash(`Moved ${ok} bin${ok === 1 ? '' : 's'} to ${dest}`)
    } else {
      flash('Could not move')
    }
    return ok
  }

  async function bulkDelete(ids) {
    if (!confirm(`Delete ${ids.length} bin${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return 0
    let ok = 0
    for (const id of ids) {
      const it = items.find((i) => i.id === id)
      if (it) for (const p of it.photos || []) await deletePhoto(p)
      try { await deleteContainer(id); ok++ } catch (e) {}
    }
    if (ok > 0) {
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)))
      flash(`Deleted ${ok} bin${ok === 1 ? '' : 's'}`)
    } else {
      flash('Could not delete')
    }
    return ok
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

  // Open size picker, then run the requested print function with the chosen size.
  function printWithPicker(fn) {
    setPrintPicker({ onPick: (size) => fn(size) })
  }

  async function acceptTerms() {
    try {
      await saveSettings(user.id, { termsVersion: TERMS_VERSION })
      setTermsVersion(TERMS_VERSION)
    } catch (e) { flash('Could not save agreement') }
  }

  async function finishOnboarding() {
    setOnboarded(true)
    try { await saveSettings(user.id, { onboarded: true }) } catch (e) {}
  }

  async function importContainers(containers) {
    try {
      const inserted = await bulkInsertContainers(user.id, containers, space)
      setItems((prev) => [...inserted, ...prev])
      flash(`Imported ${inserted.length} container${inserted.length === 1 ? '' : 's'}`)
      return inserted.length
    } catch (e) {
      console.log('import error', e)
      flash('Import failed — check your CSV format')
      return 0
    }
  }

  async function uploadAndCreateMap(file, name) {
    try {
      const { blob, ext, width, height } = await processMapFile(file)
      const url = await uploadMapImage(user.id, blob, ext)
      const m = await createMap(user.id, { name: name || file.name.replace(/\.[^.]+$/, '') || 'Map', imageUrl: url, width, height, householdId: space })
      setMaps((prev) => [m, ...prev])
      flash('Map added')
      return m
    } catch (e) { console.log(e); flash(e.message || 'Could not upload map'); return null }
  }

  async function removeMap(mapId) {
    if (!confirm('Delete this map? Any pins on it will be cleared from their bins.')) return
    try {
      await deleteMap(mapId)
      setMaps((prev) => prev.filter((m) => m.id !== mapId))
      setItems((prev) => prev.map((it) => it.mapId === mapId ? { ...it, mapId: null, pinX: null, pinY: null } : it))
      flash('Map deleted')
    } catch (e) { flash('Could not delete') }
  }

  async function placeBinPin(containerId, mapId, x, y) {
    try {
      await setContainerPin(containerId, mapId, x, y)
      setItems((prev) => prev.map((it) => it.id === containerId ? { ...it, mapId, pinX: x, pinY: y } : it))
      if (editing && editing.id === containerId) setEditing({ ...editing, mapId, pinX: x, pinY: y })
      flash('Pin placed')
    } catch (e) { flash('Could not place pin') }
  }

  async function unpinBin(containerId) {
    try {
      await clearContainerPin(containerId)
      setItems((prev) => prev.map((it) => it.id === containerId ? { ...it, mapId: null, pinX: null, pinY: null } : it))
      if (editing && editing.id === containerId) setEditing({ ...editing, mapId: null, pinX: null, pinY: null })
      flash('Pin removed')
    } catch (e) { flash('Could not remove pin') }
  }

  // Phase-one stand-in for Stripe: flips the account to paid. Stripe will call this later.
  async function simulateUpgrade() {
    try {
      await saveSettings(user.id, { plan: 'active' })
      setPlan(planState('active', null))
      flash('Upgraded — full access unlocked')
      goList()
    } catch (e) { flash('Could not upgrade') }
  }

  // If the signed-in user hasn't agreed to the current terms version, show the gate.
  if (termsVersion < TERMS_VERSION) return <TermsGate onAccept={acceptTerms} onSignOut={() => supabase.auth.signOut()} />

  // First-time onboarding: only show if they're brand new (no items, not yet onboarded).
  if (!onboarded && items.length === 0) return <OnboardingFlow onDone={finishOnboarding} onSkip={finishOnboarding} onImport={() => { setOnboarded(true); saveSettings(user.id, { onboarded: true }).catch(() => {}); setView('import') }} onCreate={() => { setOnboarded(true); saveSettings(user.id, { onboarded: true }).catch(() => {}); newItem() }} />

  // Bottom tab nav. Center "+" launches new container (or upgrade if at limit).
  const tabs = [
    { key: 'list', label: 'Bins', icon: '📦', go: () => { goList() } },
    { key: 'scan', label: 'Scan', icon: '▢', go: () => setView('scan') },
    { key: 'add', label: 'Add', icon: '＋', go: () => newItem(), center: true },
    { key: 'sales', label: resellerMode ? 'Sales' : 'Activity', icon: resellerMode ? '📊' : '⏰',
      go: () => setView(resellerMode ? 'sales' : 'expiring') },
    { key: 'more', label: 'More', icon: '☰', go: () => setView('more') },
  ]
  const activeTab = ({
    list: 'list', form: 'list', detail: 'list', quickadd: 'list',
    scan: 'scan',
    sales: 'sales', expiring: 'sales',
    more: 'more', settings: 'more', households: 'more', batch: 'more', upgrade: 'more', orderlabels: 'more',
    profile: 'more', help: 'more', terms: 'more', privacy: 'more', feedback: 'more', beta: 'more',
    maps: 'more', mapview: 'more', mappick: 'list', import: 'more',
  })[view] || 'list'

  const common = { items, resellerMode, user, flash }
  return (
    <div className="app">
      {view === 'list' && <ListView {...common} {...{ query, setQuery, sortBy, setSortBy, openDetail, newItem, setView, households, space, setSpace, plan, printWithPicker, bulkMove, bulkDelete }} />}
      {view === 'form' && <FormView {...common} editing={editing} setEditing={setEditing} onSave={saveItem} onBack={() => (items.find((i) => i.id === editing.id) ? setView('detail') : goList())} />}
      {view === 'detail' && <DetailView {...common} item={editing} onEdit={() => setView('form')} onDelete={() => removeItem(editing)} onBack={goList} onQuickAdd={() => setView('quickadd')} onPull={pullItem} onReturn={returnLentItem} onMove={moveItem} households={households} space={space} printWithPicker={printWithPicker} maps={maps} onStartPinPick={(mapId) => { setActiveMapId(mapId); setPinPickFor(editing); setView('mappick') }} onUnpin={() => unpinBin(editing.id)} onViewMap={(mapId) => { setActiveMapId(mapId); setView('mapview') }} />}
      {view === 'scan' && <ScanView items={items} resellerMode={resellerMode} onFound={openDetail} onBack={goList} flash={flash} onQuickAdd={quickAddItem} />}
      {view === 'quickadd' && <QuickAddView container={editing} resellerMode={resellerMode} onAdd={quickAddItem} onDone={() => setView('detail')} onBack={() => setView('detail')} />}
      {view === 'batch' && <BatchView onCreate={batchCreate} onBack={() => setView('more')} printWithPicker={printWithPicker} />}
      {view === 'expiring' && <ExpiringView items={items} resellerMode={resellerMode} onOpen={openDetail} onPull={pullItem} onBack={goList} />}
      {view === 'sales' && <SalesView items={items} onBack={goList} />}
      {view === 'households' && <HouseholdsView user={user} households={households} space={space} setSpace={setSpace} reload={reloadHouseholds} onBack={() => setView('more')} flash={flash} plan={plan} onUpgrade={() => setView('upgrade')} />}
      {view === 'upgrade' && <UpgradeView plan={plan} itemCount={items.length} onUpgrade={simulateUpgrade} onBack={() => setView('more')} />}
      {view === 'orderlabels' && <OrderLabelsView user={user} onBack={() => setView('more')} flash={flash} />}
      {view === 'settings' && <SettingsView resellerMode={resellerMode} toggleReseller={toggleReseller} onBack={() => setView('more')} signOut={() => supabase.auth.signOut()} email={user.email} plan={plan} onUpgrade={() => setView('upgrade')} defaultLabelSize={defaultLabelSize} setDefaultLabelSize={async (s) => { setDefaultLabelSize(s); try { await saveSettings(user.id, { defaultLabelSize: s }) } catch (e) {} }} spaceName={space ? (households.find((h) => h.id === space)?.name || 'this household') : 'Personal'} />}
      {view === 'profile' && <ProfileView user={user} plan={plan} itemCount={items.length} households={households} onBack={() => setView('more')} signOut={() => supabase.auth.signOut()} />}
      {view === 'help' && <HelpView onBack={() => setView('more')} />}
      {view === 'terms' && <LegalView title="Terms of Service" body={<TermsText />} onBack={() => setView('more')} />}
      {view === 'privacy' && <LegalView title="Privacy Policy" body={<PrivacyText />} onBack={() => setView('more')} />}
      {view === 'beta' && <LegalView title="Beta program agreement" body={<BetaAgreementText />} onBack={() => setView('more')} />}
      {view === 'maps' && <MapsListView maps={maps} items={items} onOpen={(id) => { setActiveMapId(id); setView('mapview') }} onUpload={uploadAndCreateMap} onDelete={removeMap} onBack={() => setView('more')} />}
      {view === 'mapview' && <MapsViewerView map={maps.find((m) => m.id === activeMapId)} items={items} onOpenBin={(id) => { openDetail(id) }} onBack={() => setView('maps')} />}
      {view === 'mappick' && <PinPickerView map={maps.find((m) => m.id === activeMapId)} container={pinPickFor} onPlace={(x, y) => { placeBinPin(pinPickFor.id, activeMapId, x, y); setPinPickFor(null); setView('detail') }} onBack={() => { setPinPickFor(null); setView('detail') }} />}
      {view === 'import' && <ImportView onImport={importContainers} onBack={() => setView('more')} flash={flash} />}
      {view === 'feedback' && <FeedbackView user={user} appState={{ items: items.length, households: households.length, space }} onBack={() => setView('more')} flash={flash} />}
      {view === 'more' && <MoreView setView={setView} plan={plan} resellerMode={resellerMode} user={user} />}
      {toast && <div className="toast">{toast}</div>}

      <PrintSizePicker
        open={!!printPicker}
        onClose={() => setPrintPicker(null)}
        initialSize={defaultLabelSize || DEFAULT_SIZE}
        initialOffsetX={labelOffsetX}
        initialOffsetY={labelOffsetY}
        initialRowScale={labelRowScale}
        onPick={async (s, remember, includeText, copies, offsets, rowScale) => {
          if (remember) {
            setDefaultLabelSize(s)
            setLabelOffsetX(offsets.x); setLabelOffsetY(offsets.y); setLabelRowScale(rowScale)
            try { await saveSettings(user.id, { defaultLabelSize: s, labelOffsetX: offsets.x, labelOffsetY: offsets.y, labelRowScale: rowScale }) } catch (e) {}
          }
          printPicker && printPicker.onPick(s, includeText, copies, offsets, rowScale); setPrintPicker(null)
        }}
      />

      <nav className="tabbar" aria-label="Main navigation">
        <div className="inner">
          {tabs.map((t) => (
            <button key={t.key} className={`tab ${t.center ? 'center' : ''} ${activeTab === t.key ? 'active' : ''}`} onClick={t.go} aria-label={t.label}>
              {t.center
                ? <><span className="pill-btn">{t.icon}</span><span className="label">{t.label}</span></>
                : <><span className="ic">{t.icon}</span><span>{t.label}</span></>}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

/* ---------------- Bulk action bar (multi-select on the list) ---------------- */
function BulkActionBar({ selected, households, space, onMove, onDelete, onExit, moveOpen, setMoveOpen }) {
  if (moveOpen) {
    return (
      <div className="bulk-bar">
        <div className="panel">
          <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>Move {selected.size} bin{selected.size === 1 ? '' : 's'} to:</p>
          {space && (
            <button className="opt" onClick={() => onMove(null)}>🔒 Personal</button>
          )}
          {households.filter((h) => h.id !== space).map((h) => (
            <button key={h.id} className="opt" onClick={() => onMove(h.id)}>🏠 {h.name}</button>
          ))}
          {households.filter((h) => h.id !== space).length === 0 && !space && (
            <p className="muted" style={{ fontSize: 13, margin: '6px 0' }}>You don't have any households yet. Create one in More → Households to share bins with other people.</p>
          )}
          <button className="btn ghost" onClick={() => setMoveOpen(false)} style={{ marginTop: 4 }}>Cancel</button>
        </div>
      </div>
    )
  }
  const none = selected.size === 0
  return (
    <div className="bulk-bar">
      <div className="inner">
        <button className="btn" disabled={none} onClick={() => setMoveOpen(true)} style={{ background: none ? 'var(--surface)' : 'var(--brand-bg)', color: none ? 'var(--text-2)' : 'var(--brand-text)', borderColor: none ? 'var(--border)' : 'var(--brand)' }}>↪ Move…</button>
        <button className="btn danger" disabled={none} onClick={onDelete}>🗑 Delete</button>
      </div>
    </div>
  )
}

/* ---------------- List ---------------- */
function ListView({ items, resellerMode, query, setQuery, sortBy, setSortBy, openDetail, newItem, setView, households, space, setSpace, plan, printWithPicker, bulkMove, bulkDelete }) {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [moveOpen, setMoveOpen] = useState(false)

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function exitSelect() { setSelectMode(false); setSelected(new Set()); setMoveOpen(false) }
  function selectAll(ids) { setSelected(new Set(ids)) }
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
        {selectMode
          ? <>
              <button className="iconbtn" aria-label="Cancel selection" onClick={exitSelect}>✕</button>
              <h1 style={{ fontSize: 17 }}>{selected.size} selected</h1>
              <button className="iconbtn" aria-label="Select all" title="Select all visible" style={{ width: 'auto', padding: '0 12px', fontSize: 13 }}
                onClick={() => selected.size === results.length ? setSelected(new Set()) : selectAll(results.map((r) => r.it.id))}>
                {selected.size === results.length && results.length > 0 ? 'Clear' : 'Select all'}
              </button>
            </>
          : <h1>{activeName}</h1>}
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

      {households.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <select value={space || ''} onChange={(e) => setSpace(e.target.value || null)} aria-label="Switch space">
            <option value="">🔒 Personal</option>
            {households.map((h) => <option key={h.id} value={h.id}>🏠 {h.name}</option>)}
          </select>
        </div>
      )}

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
            <button className="iconbtn" title="Select multiple" onClick={() => setSelectMode(true)}>☑</button>
            <button className="iconbtn" title="Print all labels" onClick={() => printWithPicker((size, includeText, copies, offsets, rowScale) => printAll(items, size, includeText, copies, offsets, rowScale))}>🖨</button>
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
        const isSel = selected.has(it.id)
        return (
          <div key={it.id} className="listcard"
            onClick={() => selectMode ? toggleSelect(it.id) : openDetail(it.id)}
            style={selectMode && isSel ? { borderColor: 'var(--brand)', background: 'var(--brand-bg)' } : undefined}>
            {selectMode && (
              <div style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 6, border: `2px solid ${isSel ? 'var(--brand)' : 'var(--border-strong)'}`, background: isSel ? 'var(--brand)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>
                {isSel ? '✓' : ''}
              </div>
            )}
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
            {!selectMode && <span className="muted">›</span>}
          </div>
        )
      })}
      {selectMode && (
        <BulkActionBar
          selected={selected}
          allIds={results.map((r) => r.it.id)}
          households={households}
          space={space}
          onSelectAll={() => selectAll(results.map((r) => r.it.id))}
          onClear={() => setSelected(new Set())}
          onExit={exitSelect}
          onMove={async (target) => { await bulkMove(Array.from(selected), target); exitSelect() }}
          onDelete={async () => { const n = await bulkDelete(Array.from(selected)); if (n > 0) exitSelect() }}
          moveOpen={moveOpen}
          setMoveOpen={setMoveOpen}
        />
      )}
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
function DetailView({ item, resellerMode, onEdit, onDelete, onBack, onQuickAdd, onPull, onReturn, onMove, households, space, printWithPicker, maps, onStartPinPick, onUnpin, onViewMap }) {
  const [qr, setQr] = useState('')
  const [pullIdx, setPullIdx] = useState(null)   // index of item being pulled (shows action sheet)
  const [showMove, setShowMove] = useState(false)
  const [sellIdx, setSellIdx] = useState(null)   // index in sell-price entry mode
  const [sellPrice, setSellPrice] = useState('')
  const [sellCost, setSellCost] = useState('')
  const [fees, setFees] = useState({ sellerFee: '', ccFee: '', shipping: '', packing: '' })
  const [showFees, setShowFees] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [lendIdx, setLendIdx] = useState(null)
  const [lendTo, setLendTo] = useState('')
  const [lendDue, setLendDue] = useState('')
  useEffect(() => { qrDataUrl(item.id).then(setQr) }, [item.id])
  const cv = containerValue(item)
  const profit = containerProfit(item)
  const cExp = expStatus(item.expires)

  function resetSell() {
    setSellIdx(null); setSellPrice(''); setSellCost(''); setPullIdx(null)
    setFees({ sellerFee: '', ccFee: '', shipping: '', packing: '' }); setShowFees(false)
  }
  function resetLend() {
    setLendIdx(null); setLendTo(''); setLendDue(''); setPullIdx(null)
  }
  function confirmLend(i, c) {
    if (!lendTo.trim()) return
    onPull(item, i, 'lent', {
      lentTo: lendTo.trim(),
      lentDate: new Date().toISOString().slice(0, 10),
      dueDate: lendDue || null,
    })
    resetLend()
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
        <button className="btn" onClick={() => printWithPicker((size, includeText, copies, offsets, rowScale) => printLabel(item, size, includeText, copies, offsets, rowScale))}>🖨 Print label</button>
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

      {/* Floor plan pin */}
      {maps && maps.length > 0 && (
        item.mapId && item.pinX !== null && item.pinY !== null && maps.find((m) => m.id === item.mapId)
          ? (
            <div className="card" style={{ marginBottom: 14, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>🗺️</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>Pinned on {maps.find((m) => m.id === item.mapId).name}</p>
                  <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>Tap to see the location on the floor plan</p>
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => onViewMap(item.mapId)}>View on map</button>
                <button className="btn ghost" onClick={onUnpin}>Remove pin</button>
              </div>
            </div>
          )
          : (
            <div className="card" style={{ marginBottom: 14, padding: 12 }}>
              <p style={{ margin: '0 0 8px', fontSize: 14 }}>📍 Pin this bin on a floor plan</p>
              {maps.map((m) => (
                <button key={m.id} className="btn" style={{ marginBottom: 6 }} onClick={() => onStartPinPick(m.id)}>{m.name}</button>
              ))}
            </div>
          )
      )}

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
                ) : lendIdx === i ? (
                  <>
                    <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>Lend out “{c.name}”</p>
                    <label className="field">Lent to</label>
                    <input autoFocus value={lendTo} onChange={(e) => setLendTo(e.target.value)} placeholder="Who's borrowing it?" style={{ marginBottom: 10 }} />
                    <label className="field">Due back (optional)</label>
                    <input type="date" value={lendDue} onChange={(e) => setLendDue(e.target.value)} style={{ marginBottom: 10 }} />
                    <div className="row">
                      <button className="btn primary" disabled={!lendTo.trim()} onClick={() => confirmLend(i, c)}>Confirm lend</button>
                      <button className="btn ghost" onClick={resetLend}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Pull “{c.name}” out — what happened to it?</p>
                    <div className="row" style={{ marginBottom: 8 }}>
                      <button className="btn" onClick={() => { onPull(item, i, 'used'); setPullIdx(null) }}>Used</button>
                      <button className="btn" onClick={() => { setSellIdx(i); setSellPrice(c.sale ?? ''); setSellCost(c.cost ?? '') }}>Sold</button>
                    </div>
                    <div className="row" style={{ marginBottom: 8 }}>
                      <button className="btn" onClick={() => setLendIdx(i)}>📤 Lend out</button>
                      <button className="btn danger" onClick={() => { onPull(item, i, 'remove'); setPullIdx(null) }}>Remove</button>
                    </div>
                    <button className="btn ghost" onClick={() => setPullIdx(null)}>Cancel</button>
                  </>
                )}
              </div>
            )}
          </div>
        )})}
      </div>

      {(() => {
        const lentEntries = (item.history || []).map((h, i) => ({ h, i })).filter(({ h }) => h.reason === 'lent')
        if (lentEntries.length === 0) return null
        return (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontWeight: 500, margin: '0 0 8px', fontSize: 14 }}>📤 Currently lent out ({lentEntries.length})</p>
            {lentEntries.map(({ h, i }) => {
              const overdue = h.dueDate && new Date(h.dueDate) < new Date(new Date().toDateString())
              return (
                <div key={i} className="card" style={{ marginBottom: 8, padding: 12, borderColor: overdue ? 'var(--danger)' : 'var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{h.name}{h.qty > 1 ? ` ×${h.qty}` : ''}</p>
                      <p className="muted" style={{ fontSize: 12, margin: '3px 0 0' }}>
                        Lent to <strong>{h.lentTo || 'someone'}</strong>
                        {h.lentDate && ` on ${new Date(h.lentDate).toLocaleDateString()}`}
                      </p>
                      {h.dueDate && (
                        <p style={{ fontSize: 12, margin: '3px 0 0', color: overdue ? 'var(--danger)' : 'var(--text-2)' }}>
                          {overdue ? '⏰ Overdue — due ' : 'Due back '}{new Date(h.dueDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <button className="btn" style={{ width: 'auto', flexShrink: 0 }} onClick={() => onReturn && onReturn(item, i)}>↩ Returned</button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {(item.history && item.history.length > 0) && (
        <div style={{ marginBottom: 22 }}>
          <button className="btn ghost" onClick={() => setShowHistory(!showHistory)} style={{ justifyContent: 'space-between' }}>
            <span>History ({item.history.length})</span>
            <span className="muted">{showHistory ? '▲' : '▼'}</span>
          </button>
          {showHistory && (
            <div style={{ marginTop: 8 }}>
              {item.history.map((h, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14 }}>
                    {h.name}{h.qty > 1 ? ` ×${h.qty}` : ''}
                    {h.reason === 'sold' && h.sale ? ` · ${money(h.sale)}` : ''}
                    {h.reason === 'lent' && h.lentTo ? ` · ${h.lentTo}` : ''}
                  </span>
                  <span className={`pill ${h.reason === 'sold' ? 'sold' : h.reason === 'lent' ? 'stock' : 'used'}`}>{h.reason}</span>
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

  // Collect every currently-lent item across all bins.
  const lent = []
  for (const it of items) {
    for (let h = 0; h < (it.history || []).length; h++) {
      const e = it.history[h]
      if (e.reason === 'lent') {
        lent.push({
          containerId: it.id, containerName: it.name || 'Untitled',
          location: it.location || '', historyIndex: h,
          name: e.name || '(item)', qty: e.qty || 1,
          lentTo: e.lentTo, lentDate: e.lentDate, dueDate: e.dueDate,
          overdue: e.dueDate && new Date(e.dueDate) < new Date(new Date().toDateString()),
        })
      }
    }
  }
  // Sort: overdue first, then by due date ascending (no due date last), then by lentDate descending.
  lent.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
    if (a.dueDate) return -1
    if (b.dueDate) return 1
    return (b.lentDate || '').localeCompare(a.lentDate || '')
  })

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

  const nothing = !list.length && !lent.length

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Activity</h1>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>Things expiring soon and items you've lent out — your weekly check-in.</p>

      <label className="field">Show items expiring within</label>
      <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} style={{ marginBottom: 8 }}>
        <option value={7}>7 days</option>
        <option value={14}>14 days</option>
        <option value={30}>30 days</option>
        <option value={60}>60 days</option>
        <option value={90}>90 days</option>
        <option value={180}>180 days (6 months)</option>
        <option value={365}>1 year</option>
        <option value={3650}>All upcoming</option>
      </select>

      {nothing && (
        <div className="full-center center muted">
          <div style={{ fontSize: 36 }}>✅</div>
          <p>Nothing expired, expiring, or lent out.</p>
        </div>
      )}

      <Section title="Expired" rows={expired} tone="var(--danger)" />
      <Section title="Expiring soon" rows={soon} tone="var(--warn-text)" />

      {lent.length > 0 && (
        <>
          <p style={{ fontWeight: 500, fontSize: 14, margin: '20px 0 8px' }}>📤 Lent out ({lent.length})</p>
          {lent.map((x, i) => (
            <div key={i} className="card" style={{ marginBottom: 10, padding: '12px 14px', borderColor: x.overdue ? 'var(--danger)' : 'var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 15 }}>{x.name}{x.qty > 1 ? ` ×${x.qty}` : ''}</span>
                {x.overdue && <span className="pill expired">Overdue</span>}
              </div>
              <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
                To <strong>{x.lentTo || 'someone'}</strong>
                {x.lentDate && ` on ${new Date(x.lentDate).toLocaleDateString()}`}
                {x.dueDate && ` · due ${new Date(x.dueDate).toLocaleDateString()}`}
              </p>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
                from <strong>{x.containerName}</strong>{x.location ? ` · 📍 ${x.location}` : ''}
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => onOpen(x.containerId)}>Open box</button>
              </div>
            </div>
          ))}
        </>
      )}
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
function BatchView({ onCreate, onBack, printWithPicker }) {
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
          <button className="btn primary" style={{ marginBottom: 10 }} onClick={() => printWithPicker((size, includeText, copies, offsets, rowScale) => printBlanks(createdIds, size, includeText, copies, offsets, rowScale))}>🖨 Print these labels</button>
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

/* ---------------- Profile ---------------- */
function ProfileView({ user, plan, itemCount, households, onBack, signOut }) {
  const created = user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'
  const planLabel = ({
    trial: `Free trial — ${plan?.trialDaysLeft || 0} days left`,
    active: 'Plus (paid) · active',
    comp: FREE_FOR_ALL ? 'Free access (all features unlocked)' : 'Complimentary access',
    free: 'Free plan',
  })[plan?.state] || 'Unknown'

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Profile</h1>
      </div>

      <div className="card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--brand)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 600, flexShrink: 0 }}>
          {(user?.email || '?').slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="ellip" style={{ fontWeight: 500, margin: 0 }}>{user?.email}</p>
          <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>Member since {created}</p>
        </div>
      </div>

      <p className="muted" style={{ fontWeight: 500, fontSize: 13, margin: '4px 0 8px' }}>Account status</p>
      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ margin: '0 0 4px' }}>{planLabel}</p>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {FREE_FOR_ALL
            ? 'All features are currently free for every user.'
            : plan?.isPaid ? 'You have full access to all features.' : 'Upgrade any time from the More menu.'}
        </p>
      </div>

      <p className="muted" style={{ fontWeight: 500, fontSize: 13, margin: '4px 0 8px' }}>Your inventory</p>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="stat"><p className="label">Containers</p><p className="value" style={{ fontSize: 22 }}>{itemCount}</p></div>
        <div className="stat"><p className="label">Households</p><p className="value" style={{ fontSize: 22 }}>{households?.length || 0}</p></div>
      </div>

      <button className="btn" onClick={signOut} style={{ marginTop: 6 }}>Sign out</button>
      <p className="muted center" style={{ fontSize: 12, marginTop: 18 }}>
        Need to delete your account? Email {SUPPORT_EMAIL}.
      </p>
    </>
  )
}

/* ---------------- How-to ---------------- */
function HelpView({ onBack }) {
  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>How to use BinStashR</h1>
      </div>
      <HelpText />
    </>
  )
}

/* ---------------- Legal viewer ---------------- */
function LegalView({ title, body, onBack }) {
  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>{title}</h1>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, paddingBottom: 20 }}>{body}</div>
    </>
  )
}

/* ---------------- Terms re-acceptance gate ---------------- */
function TermsGate({ onAccept, onSignOut }) {
  const [agreed, setAgreed] = useState(false)
  const [show, setShow] = useState(null)   // 'terms' | 'privacy' | null
  if (show === 'terms') return <LegalView title="Terms of Service" body={<TermsText />} onBack={() => setShow(null)} />
  if (show === 'privacy') return <LegalView title="Privacy Policy" body={<PrivacyText />} onBack={() => setShow(null)} />
  return (
    <div className="app">
      <div className="full-center" style={{ paddingTop: '8vh', alignItems: 'stretch', textAlign: 'left' }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>We've updated our Terms</h2>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
          To continue using {COMPANY_NAME}, please review and agree to our updated Terms of Service and Privacy Policy.
        </p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 'auto', marginTop: 3, flexShrink: 0 }} />
          <span>
            I agree to the{' '}
            <button onClick={() => setShow('terms')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--brand)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Terms of Service</button>
            {' '}and{' '}
            <button onClick={() => setShow('privacy')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--brand)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Privacy Policy</button>.
          </span>
        </label>
        <button className="btn primary" disabled={!agreed} onClick={onAccept}>Continue</button>
        <button className="btn ghost" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  )
}

/* ---------------- Floor plans / maps ---------------- */
function MapsListView({ maps, items, onOpen, onUpload, onDelete, onBack }) {
  const fileRef = useRef(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function onFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    setBusy(true)
    await onUpload(file, name.trim())
    setName('')
    if (fileRef.current) fileRef.current.value = ''
    setBusy(false)
  }

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Floor plans & maps</h1>
      </div>

      <p className="muted" style={{ fontSize: 14, marginTop: 0, lineHeight: 1.6 }}>
        Upload a floor plan, blueprint, or photo of a map. Then drop pins to show where each bin lives.
        Accepts SVG, PDF, PNG, and JPG.
      </p>

      <div className="card" style={{ marginBottom: 18 }}>
        <p style={{ fontWeight: 500, margin: '0 0 8px' }}>Upload a new map</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Garage, Floor 1)" style={{ marginBottom: 10 }} />
        <input ref={fileRef} type="file" accept=".svg,.pdf,.png,.jpg,.jpeg,image/*,application/pdf,image/svg+xml" onChange={onFile} disabled={busy} />
        {busy && <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Processing — large PDFs may take a few seconds…</p>}
      </div>

      {maps.length === 0 && (
        <div className="full-center center muted">
          <div style={{ fontSize: 36 }}>🗺️</div>
          <p style={{ maxWidth: 320 }}>No maps yet. Upload a floor plan above and you can start pinning bins to specific spots.</p>
        </div>
      )}

      {maps.map((m) => {
        const pinCount = items.filter((it) => it.mapId === m.id).length
        return (
          <div key={m.id} className="listcard" onClick={() => onOpen(m.id)} style={{ cursor: 'pointer' }}>
            <div style={{ width: 60, height: 46, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)' }}>
              <img src={m.imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="ellip" style={{ fontWeight: 500, margin: 0 }}>{m.name}</p>
              <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{pinCount} pinned bin{pinCount === 1 ? '' : 's'}</p>
            </div>
            <button className="iconbtn" aria-label="Delete map" onClick={(e) => { e.stopPropagation(); onDelete(m.id) }} style={{ width: 32, height: 32, color: 'var(--danger)' }}>🗑</button>
          </div>
        )
      })}
    </>
  )
}

function MapsViewerView({ map, items, onOpenBin, onBack }) {
  const [selected, setSelected] = useState(null)
  if (!map) return (
    <>
      <div className="topbar"><button className="iconbtn" onClick={onBack}>‹</button><h1 style={{ fontSize: 18 }}>Map</h1></div>
      <p className="muted center" style={{ padding: '2rem 0' }}>Map not found.</p>
    </>
  )
  const pins = items
    .filter((it) => it.mapId === map.id && it.pinX !== null && it.pinY !== null)
    .map((it) => ({ id: it.id, name: it.name || 'Untitled', x: it.pinX, y: it.pinY }))
  const selectedBin = selected ? items.find((it) => it.id === selected) : null

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>{map.name}</h1>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Pinch or scroll to zoom. Tap a pin to see what's there.</p>
      <MapView map={map} pins={pins} onPinTap={(id) => setSelected(id)} />
      {selectedBin && (
        <div className="card" style={{ marginTop: 12, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>📦</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="ellip" style={{ fontWeight: 500, margin: 0 }}>{selectedBin.name || 'Untitled'}</p>
              <p className="ellip muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{selectedBin.contents?.length || 0} items{selectedBin.location ? ` · ${selectedBin.location}` : ''}</p>
            </div>
            <button className="btn" style={{ width: 'auto' }} onClick={() => onOpenBin(selectedBin.id)}>Open</button>
          </div>
        </div>
      )}
    </>
  )
}

function PinPickerView({ map, container, onPlace, onBack }) {
  if (!map || !container) return (
    <>
      <div className="topbar"><button className="iconbtn" onClick={onBack}>‹</button><h1 style={{ fontSize: 18 }}>Drop pin</h1></div>
      <p className="muted center" style={{ padding: '2rem 0' }}>Map or bin not found.</p>
    </>
  )
  return (
    <>
      <div className="topbar">
        <button className="iconbtn" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Drop pin for “{container.name}”</h1>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Pinch or scroll to zoom into the map. Tap where you want to drop the pin.</p>
      <MapView map={map} placingMode={true} onPlace={onPlace} />
    </>
  )
}

/* ---------------- Feedback ---------------- */
function FeedbackView({ user, appState, onBack, flash }) {
  const [kind, setKind] = useState('feedback')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function submit() {
    if (!message.trim()) return
    setBusy(true)
    try {
      await submitFeedback(user.id, user.email, { kind, message: message.trim(), appState })
      setSubmitted(true)
    } catch (e) {
      flash('Could not send. Please try again or email us directly.')
    } finally { setBusy(false) }
  }

  if (submitted) return (
    <>
      <div className="topbar"><button className="iconbtn" onClick={onBack}>‹</button><h1 style={{ fontSize: 18 }}>Thanks!</h1></div>
      <div className="full-center center">
        <div style={{ fontSize: 44 }}>🙏</div>
        <p style={{ margin: 0, maxWidth: 340 }}>Got it — thanks for taking the time. We read every report.</p>
        <p className="muted" style={{ fontSize: 13, maxWidth: 340 }}>
          If we have a follow-up question we'll reach you at <strong>{user.email}</strong>.
        </p>
        <button className="btn" style={{ width: 'auto', marginTop: 12 }} onClick={onBack}>Done</button>
      </div>
    </>
  )

  const placeholders = {
    feedback: 'What worked well, what didn\'t, and what would make this better for you?',
    bug: 'What did you do, what did you expect, and what happened instead? Including the bin name or step where it went wrong helps a lot.',
    idea: 'What feature would you like to see? Why would it help you?',
  }

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" onClick={onBack}>‹</button>
        <h1 style={{ fontSize: 18 }}>Send feedback</h1>
      </div>
      <p className="muted" style={{ fontSize: 14, marginTop: 0, lineHeight: 1.6 }}>
        Tell us what you think. We read every message and reply when something needs a follow-up.
      </p>

      <label className="field">Type</label>
      <div className="row" style={{ marginBottom: 14 }}>
        {[{ k: 'feedback', l: '💬 Feedback' }, { k: 'bug', l: '🐞 Bug' }, { k: 'idea', l: '💡 Idea' }].map((o) => (
          <button key={o.k} className={kind === o.k ? 'btn primary' : 'btn'} onClick={() => setKind(o.k)} style={{ flex: 1 }}>{o.l}</button>
        ))}
      </div>

      <label className="field">Your message</label>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)}
        placeholder={placeholders[kind]}
        style={{ minHeight: 140, marginBottom: 14 }} />

      <button className="btn primary" disabled={busy || !message.trim()} onClick={submit}>
        {busy ? 'Sending…' : 'Send'}
      </button>
      <p className="muted center" style={{ fontSize: 12, marginTop: 12 }}>
        We'll attach your account email ({user.email}) so we can reply. We also include basic context like your container count to help us reproduce bugs — never the contents of your inventory.
      </p>
    </>
  )
}

/* ---------------- Onboarding (first-time experience) ---------------- */
function OnboardingFlow({ onDone, onSkip, onImport, onCreate }) {
  const [step, setStep] = useState(0)

  const steps = [
    {
      icon: '👋',
      title: `Welcome to ${COMPANY_NAME}`,
      body: 'Stash everything you own in labeled bins. Scan a label, see what\'s inside. Search a thing, find which bin it lives in. Let\'s set you up — takes about a minute.',
      cta: 'Next',
      onCta: () => setStep(1),
    },
    {
      icon: '📦',
      title: 'Bins are how you organize',
      body: 'A bin can be a real box in your garage, a shelf in your closet, a kitchen drawer, anything. You\'ll give it a name, a location, and list what\'s inside. Each one gets a QR code you stick on the real bin.',
      cta: 'Got it',
      onCta: () => setStep(2),
    },
    {
      icon: '▢',
      title: 'Scan to find',
      body: 'Print the QR code (any printer — paper labels or a thermal printer both work), stick it on the bin, and from then on, point your phone\'s camera at it to see what\'s inside. You can also search by item name to find which bin has the thing you need.',
      cta: 'Got it',
      onCta: () => setStep(3),
    },
    {
      icon: '🚀',
      title: 'Two ways to start',
      body: 'If you have an existing inventory spreadsheet — pantry list, reseller stock, anything — you can import it. Otherwise, create your first bin and we\'ll walk you through it.',
      ctaPrimary: { label: '📥 Import from spreadsheet', onClick: onImport },
      ctaSecondary: { label: '＋ Create my first bin', onClick: onCreate },
      tertiary: { label: 'Just look around', onClick: onDone },
    },
  ]

  const s = steps[step]
  return (
    <div className="app">
      <div className="full-center" style={{ paddingTop: '8vh', textAlign: 'center', alignItems: 'center', maxWidth: 380, margin: '0 auto' }}>
        <div style={{ fontSize: 64, marginBottom: 10 }}>{s.icon}</div>
        <h2 style={{ fontSize: 22, margin: '0 0 14px' }}>{s.title}</h2>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--text-2)', margin: '0 0 24px' }}>{s.body}</p>

        {s.ctaPrimary ? (
          <>
            <button className="btn primary" onClick={s.ctaPrimary.onClick} style={{ marginBottom: 10 }}>{s.ctaPrimary.label}</button>
            <button className="btn" onClick={s.ctaSecondary.onClick} style={{ marginBottom: 10 }}>{s.ctaSecondary.label}</button>
            <button className="btn ghost" onClick={s.tertiary.onClick}>{s.tertiary.label}</button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={s.onCta} style={{ marginBottom: 10 }}>{s.cta}</button>
            <button className="btn ghost" onClick={onSkip}>Skip intro</button>
          </>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 22 }}>
          {steps.map((_, i) => (
            <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: i === step ? 'var(--brand)' : 'var(--border)' }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------------- CSV import ---------------- */
function ImportView({ onImport, onBack, flash }) {
  const [step, setStep] = useState('upload')  // upload | map | preview | done
  const [rows, setRows] = useState([])
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState({ container: -1, location: -1, category: -1, description: -1, item: -1, qty: -1, value: -1, expires: -1 })
  const [previewContainers, setPreviewContainers] = useState([])
  const [busy, setBusy] = useState(false)
  const [importedCount, setImportedCount] = useState(0)
  const fileRef = useRef(null)

  async function onFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseCSV(text)
      if (parsed.length === 0) { flash('That CSV looks empty.'); return }
      setRows(parsed)
      const guess = guessMapping(parsed[0])
      setMapping(guess)
      setStep('map')
    } catch (err) {
      console.log(err); flash('Could not read that file.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function goPreview() {
    const containers = buildContainersFromCSV(rows, mapping, hasHeader)
    setPreviewContainers(containers)
    setStep('preview')
  }

  async function doImport() {
    setBusy(true)
    const n = await onImport(previewContainers)
    setBusy(false)
    setImportedCount(n)
    setStep('done')
  }

  const headerRow = hasHeader ? (rows[0] || []) : (rows[0] ? rows[0].map((_, i) => `Column ${i + 1}`) : [])
  const columnCount = rows[0]?.length || 0
  const columnOptions = Array.from({ length: columnCount }, (_, i) => i)

  if (step === 'upload') {
    return (
      <>
        <div className="topbar">
          <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
          <h1 style={{ fontSize: 18 }}>Import from CSV</h1>
        </div>
        <p className="muted" style={{ fontSize: 14, marginTop: 0, lineHeight: 1.6 }}>
          Bring in items from a spreadsheet. Works with CSV files exported from Excel, Google Sheets, Numbers, or anywhere else.
        </p>

        <div className="card" style={{ marginBottom: 14 }}>
          <p style={{ fontWeight: 500, margin: '0 0 8px' }}>Pick a CSV file</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} />
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0', lineHeight: 1.5 }}>
            You can also export a CSV from your existing app, edit it in Excel, and import it back to make bulk changes.
          </p>
        </div>

        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <p style={{ fontWeight: 500, margin: '0 0 8px', fontSize: 14 }}>What your CSV should look like</p>
          <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            One row per item works best — for example, columns like <code>Container, Location, Item, Qty, Value, Expires</code>.
            Rows that share the same container name get grouped together. We'll let you map your columns to ours after you upload.
          </p>
        </div>
      </>
    )
  }

  if (step === 'map') {
    const FIELDS = [
      { key: 'container', label: 'Container / bin name', required: true, hint: 'Group items by this column' },
      { key: 'location', label: 'Location', hint: 'e.g. Garage, Shelf 3' },
      { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description / notes' },
      { key: 'item', label: 'Item name', hint: 'Each row\'s individual item' },
      { key: 'qty', label: 'Quantity' },
      { key: 'value', label: 'Value or cost ($)' },
      { key: 'expires', label: 'Expiration date' },
    ]
    return (
      <>
        <div className="topbar">
          <button className="iconbtn" aria-label="Back" onClick={() => setStep('upload')}>‹</button>
          <h1 style={{ fontSize: 18 }}>Match your columns</h1>
        </div>
        <p className="muted" style={{ fontSize: 14, marginTop: 0, lineHeight: 1.6 }}>
          We're guessing which of your columns means what. Adjust any that look wrong, then preview.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} style={{ width: 'auto' }} />
          First row is a header
        </label>

        {FIELDS.map((f) => (
          <div key={f.key} style={{ marginBottom: 10 }}>
            <label className="field">{f.label}{f.required && ' *'}</label>
            <select value={mapping[f.key]} onChange={(e) => setMapping({ ...mapping, [f.key]: parseInt(e.target.value) })}>
              <option value={-1}>— Not in my CSV —</option>
              {columnOptions.map((i) => (
                <option key={i} value={i}>{headerRow[i] || `Column ${i + 1}`}</option>
              ))}
            </select>
            {f.hint && <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>{f.hint}</p>}
          </div>
        ))}

        <button className="btn primary" onClick={goPreview} disabled={mapping.container === -1 && mapping.item === -1} style={{ marginTop: 8 }}>
          Preview import
        </button>
        {(mapping.container === -1 && mapping.item === -1) && (
          <p className="muted center" style={{ fontSize: 12, marginTop: 8 }}>Pick at least one of container name or item name.</p>
        )}
      </>
    )
  }

  if (step === 'preview') {
    const totalItems = previewContainers.reduce((s, c) => s + c.contents.length, 0)
    return (
      <>
        <div className="topbar">
          <button className="iconbtn" aria-label="Back" onClick={() => setStep('map')}>‹</button>
          <h1 style={{ fontSize: 18 }}>Preview</h1>
        </div>
        <p style={{ fontSize: 14, marginTop: 0, lineHeight: 1.6 }}>
          Ready to import <strong>{previewContainers.length}</strong> container{previewContainers.length === 1 ? '' : 's'}
          {totalItems > 0 && <> with <strong>{totalItems}</strong> item{totalItems === 1 ? '' : 's'} total</>}.
        </p>

        {previewContainers.length === 0 && (
          <p className="muted center" style={{ padding: '2rem 0' }}>
            No containers found. Go back and check your column mapping.
          </p>
        )}

        <div style={{ marginBottom: 14, maxHeight: '40vh', overflowY: 'auto' }}>
          {previewContainers.slice(0, 10).map((c, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, padding: 12 }}>
              <p style={{ margin: 0, fontWeight: 500 }}>{c.name}</p>
              <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
                {c.location ? `📍 ${c.location} · ` : ''}{c.contents.length} item{c.contents.length === 1 ? '' : 's'}
                {c.contents.length > 0 && ` · ${c.contents.slice(0, 3).map((it) => it.name).join(', ')}${c.contents.length > 3 ? '…' : ''}`}
              </p>
            </div>
          ))}
          {previewContainers.length > 10 && (
            <p className="muted center" style={{ fontSize: 13 }}>… and {previewContainers.length - 10} more</p>
          )}
        </div>

        <button className="btn primary" onClick={doImport} disabled={busy || previewContainers.length === 0} style={{ marginBottom: 8 }}>
          {busy ? 'Importing…' : `Import ${previewContainers.length} container${previewContainers.length === 1 ? '' : 's'}`}
        </button>
        <button className="btn ghost" onClick={() => setStep('map')}>Adjust columns</button>
      </>
    )
  }

  // done
  return (
    <>
      <div className="topbar">
        <h1 style={{ fontSize: 18 }}>Import complete</h1>
      </div>
      <div className="full-center center">
        <div style={{ fontSize: 48 }}>✅</div>
        <p style={{ margin: 0, fontSize: 16 }}>Imported {importedCount} container{importedCount === 1 ? '' : 's'}.</p>
        <p className="muted" style={{ fontSize: 13, maxWidth: 320 }}>
          You can now print labels for them, scan them, or edit any details.
        </p>
        <button className="btn primary" style={{ width: 'auto', marginTop: 12 }} onClick={onBack}>Done</button>
      </div>
    </>
  )
}

/* ---------------- More menu ---------------- */
function MoreView({ setView, plan, resellerMode, user }) {
  const Row = ({ icon, label, sub, onClick, accent }) => (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      padding: '14px 16px', marginBottom: 10, display: 'flex',
      alignItems: 'center', gap: 14, cursor: 'pointer', color: 'var(--text)',
    }}>
      <span style={{ fontSize: 22 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 500, color: accent || 'var(--text)' }}>{label}</p>
        {sub && <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{sub}</p>}
      </div>
      <span className="muted">›</span>
    </button>
  )
  return (
    <>
      <div className="topbar"><h1>More</h1></div>
      <Row icon="👤" label="Profile" sub={user?.email} onClick={() => setView('profile')} />
      {!FREE_FOR_ALL && !plan?.isPaid && <Row icon="✨" label="Upgrade to Plus" sub={plan?.state === 'trial' ? `${plan.trialDaysLeft} trial days left` : 'Unlimited & full features'} accent="var(--brand)" onClick={() => setView('upgrade')} />}
      {resellerMode && <Row icon="📊" label="Sales summary" sub="Revenue, fees, profit, CSV export" onClick={() => setView('sales')} />}
      <Row icon="⏰" label="Activity" sub="Expiring items & lent-out tracking" onClick={() => setView('expiring')} />
      <Row icon="👥" label="Households" sub="Share inventory with family" onClick={() => setView('households')} />
      <Row icon="⧉" label="Print blank labels" sub="Set up bins later by scanning" onClick={() => setView('batch')} />
      <Row icon="📥" label="Import from CSV" sub="Bring in items from a spreadsheet" onClick={() => setView('import')} />
      <Row icon="🗺️" label="Floor plans & maps" sub="Pin bins on a building plan" onClick={() => setView('maps')} />
      {SHOW_ORDER_LABELS && <Row icon="🛒" label="Order pre-printed labels" sub="Get labels shipped to you" onClick={() => setView('orderlabels')} />}
      <Row icon="⚙" label="Settings" sub="Reseller mode, plan, account" onClick={() => setView('settings')} />
      <Row icon="❓" label="How to use BinStashR" sub="Quick guide to every feature" onClick={() => setView('help')} />
      <Row icon="💬" label="Send feedback" sub="Report a bug or suggest an idea" onClick={() => setView('feedback')} />
      <Row icon="🧪" label="Beta program agreement" sub="What to expect while we're in beta" onClick={() => setView('beta')} />
      <Row icon="📄" label="Terms of Service" onClick={() => setView('terms')} />
      <Row icon="🔒" label="Privacy Policy" onClick={() => setView('privacy')} />
    </>
  )
}

/* ---------------- Order pre-printed labels ---------------- */
function OrderLabelsView({ user, onBack, flash }) {
  const [size, setSize] = useState('avery-5160')
  const [count, setCount] = useState(60)
  const [notes, setNotes] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  const SIZES = [
    { id: 'avery-5160', label: 'Avery 5160 (1×2-5/8")', per: '30 / sheet' },
    { id: 'dymo-30252', label: 'Dymo 30252 (1-1/8×3-1/2")', per: 'roll' },
    { id: 'brother-dk1201', label: 'Brother DK-1201 (1.1×3.5")', per: 'roll' },
    { id: '2x4', label: '2×4" shipping label', per: 'sheet/roll' },
    { id: '4x6', label: '4×6" thermal', per: 'roll' },
  ]

  async function submit() {
    setBusy(true)
    try {
      // Save the request to Supabase so you can review it later.
      const { error } = await supabase.from('label_orders').insert({
        user_id: user.id, email: user.email, size, count: parseInt(count) || 0, notes,
      })
      if (error) throw error
      setSubmitted(true)
    } catch (e) {
      // If the table doesn't exist yet, still treat as success and just flash a note.
      console.log('order save', e)
      setSubmitted(true)
    } finally { setBusy(false) }
  }

  if (submitted) return (
    <>
      <div className="topbar"><button className="iconbtn" onClick={onBack}>‹</button><h1 style={{ fontSize: 18 }}>Order request received</h1></div>
      <div className="full-center center">
        <div style={{ fontSize: 40 }}>✅</div>
        <p style={{ margin: 0, maxWidth: 340 }}>Thanks — we got your request. You'll hear back at <strong>{user.email}</strong> with pricing and next steps.</p>
        <button className="btn" style={{ width: 'auto', marginTop: 12 }} onClick={onBack}>Done</button>
      </div>
    </>
  )

  return (
    <>
      <div className="topbar"><button className="iconbtn" onClick={onBack}>‹</button><h1 style={{ fontSize: 18 }}>Order pre-printed labels</h1></div>
      <div className="card" style={{ marginBottom: 14, background: 'var(--surface-2)', border: '1px dashed var(--border-strong)' }}>
        <p style={{ margin: 0, fontWeight: 500 }}>Coming soon</p>
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 0', lineHeight: 1.5 }}>
          We're rolling out pre-printed label packs — pick a size, tell us how many, and we'll get back to you with pricing and shipping. No payment now; this is a request.
        </p>
      </div>

      <label className="field">Label size</label>
      <select value={size} onChange={(e) => setSize(e.target.value)} style={{ marginBottom: 14 }}>
        {SIZES.map((s) => <option key={s.id} value={s.id}>{s.label} · {s.per}</option>)}
      </select>

      <label className="field">How many labels</label>
      <input type="number" min="10" value={count} onChange={(e) => setCount(e.target.value)} style={{ marginBottom: 14 }} />

      <label className="field">Notes (optional)</label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any special requests — color, logo on labels, shipping notes…" style={{ marginBottom: 16, minHeight: 80 }} />

      <button className="btn primary" disabled={busy} onClick={submit}>
        {busy ? 'Submitting…' : 'Request quote'}
      </button>
      <p className="muted center" style={{ fontSize: 12, marginTop: 12 }}>
        We'll reply to {user.email}. No charge until you confirm an order.
      </p>
    </>
  )
}

/* ---------------- Print size picker (modal) with live preview ---------------- */
function PrintSizePicker({ open, onClose, onPick, initialSize, initialOffsetX = 0, initialOffsetY = 0, initialRowScale = 1 }) {
  const [sel, setSel] = useState(initialSize || DEFAULT_SIZE)
  const [remember, setRemember] = useState(false)
  const [includeText, setIncludeText] = useState(true)
  const [doubleUp, setDoubleUp] = useState(false)
  const [previewQR, setPreviewQR] = useState('')
  // Offsets in inches; positive Y moves grid DOWN, positive X moves grid RIGHT.
  const [offsetX, setOffsetX] = useState(initialOffsetX || 0)
  const [offsetY, setOffsetY] = useState(initialOffsetY || 0)
  // Row scale: multiplier on each row's height. > 1 spreads rows apart (fixes
  // a printer that compresses vertical spacing); < 1 pulls them together.
  const [rowScale, setRowScale] = useState(initialRowScale || 1)
  useEffect(() => {
    if (open) {
      setSel(initialSize || DEFAULT_SIZE); setRemember(false); setIncludeText(true); setDoubleUp(false)
      setOffsetX(initialOffsetX || 0); setOffsetY(initialOffsetY || 0); setRowScale(initialRowScale || 1)
    }
  }, [open, initialSize, initialOffsetX, initialOffsetY, initialRowScale])
  useEffect(() => { if (open) qrDataUrl('PREVIEW', 180).then(setPreviewQR) }, [open])
  if (!open) return null
  const size = LABEL_SIZES.find((s) => s.id === sel) || LABEL_SIZES[0]
  const isSheet = size.kind === 'sheet' && (size.gridCols || 1) > 1 && (size.gridRows || 1) > 1

  const maxW = 280
  const scale = Math.min(maxW / (size.w * 72), 140 / (size.h * 72))
  const previewW = size.w * 72 * scale
  const previewH = size.h * 72 * scale
  const qrSide = Math.min(previewW, previewH) - 8
  const isTiny = size.w < 3

  function bump(axis, amount) {
    if (axis === 'x') setOffsetX(Math.max(-1, Math.min(1, +(offsetX + amount).toFixed(4))))
    else setOffsetY(Math.max(-1, Math.min(1, +(offsetY + amount).toFixed(4))))
  }
  function bumpScale(amount) {
    setRowScale(Math.max(0.9, Math.min(1.1, +(rowScale + amount).toFixed(4))))
  }
  function resetOffsets() { setOffsetX(0); setOffsetY(0); setRowScale(1) }
  const offLabel = (v) => v === 0 ? '0″' : (v > 0 ? '+' : '') + (v * 16).toFixed(0) + '/16″'
  const scaleLabel = (v) => v === 1 ? 'Normal' : ((v - 1) * 100).toFixed(1) + '%'

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Pick a label size</h3>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          Choose what you're printing on. Sheets print as a grid; roll/thermal printers print one per page.
        </p>

        <div style={{ background: 'var(--surface-2)', borderRadius: 9, padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>Preview · {size.w}″ × {size.h}″{doubleUp ? ' · 2 per bin' : ''}</p>
          <div style={{
            width: previewW, height: previewH, background: '#fff',
            border: '1px solid #999', borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: includeText ? 'flex-start' : 'center',
            gap: 4, padding: 4, overflow: 'hidden',
          }}>
            {previewQR && <img src={previewQR} alt="" style={{ width: qrSide, height: qrSide, flexShrink: 0 }} />}
            {includeText && (
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <div style={{ fontWeight: 'bold', fontSize: isTiny ? 9 : 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#000' }}>Sample Bin Name</div>
                <div style={{ fontSize: isTiny ? 7 : 10, color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Category</div>
                <div style={{ fontSize: isTiny ? 7 : 10, color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Location · Shelf 3</div>
              </div>
            )}
          </div>
        </div>

        {LABEL_SIZES.map((s) => (
          <div key={s.id} className={`size-opt ${sel === s.id ? 'sel' : ''}`} onClick={() => setSel(s.id)}>
            <span className="dot" />
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{s.label}</p>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>{s.kind === 'sheet' ? 'Letter-paper sheet' : 'Single label per page (thermal/roll)'}</p>
            </div>
          </div>
        ))}

        {isSheet && (
          <div style={{ marginTop: 14, padding: 12, background: 'var(--surface-2)', borderRadius: 9 }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 4px' }}>Fine-tune position on sheet</p>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 10px', lineHeight: 1.5 }}>
              If labels don't land on the sheet correctly, nudge them. Test on plain paper first, then save the offset for your printer.
            </p>
            <div className="row" style={{ marginBottom: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 13, width: 50 }}>Up/down</span>
              <button className="btn ghost" style={{ width: 'auto' }} onClick={() => bump('y', -1 / 16)}>▲ Up</button>
              <span className="muted" style={{ fontSize: 13, width: 60, textAlign: 'center' }}>{offLabel(offsetY)}</span>
              <button className="btn ghost" style={{ width: 'auto' }} onClick={() => bump('y', 1 / 16)}>▼ Down</button>
            </div>
            <div className="row" style={{ alignItems: 'center' }}>
              <span style={{ fontSize: 13, width: 50 }}>Left/right</span>
              <button className="btn ghost" style={{ width: 'auto' }} onClick={() => bump('x', -1 / 16)}>◀ Left</button>
              <span className="muted" style={{ fontSize: 13, width: 60, textAlign: 'center' }}>{offLabel(offsetX)}</span>
              <button className="btn ghost" style={{ width: 'auto' }} onClick={() => bump('x', 1 / 16)}>▶ Right</button>
            </div>
            <div className="row" style={{ marginTop: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 13, width: 50 }}>Row gap</span>
              <button className="btn ghost" style={{ width: 'auto' }} onClick={() => bumpScale(-0.005)}>− Tighter</button>
              <span className="muted" style={{ fontSize: 13, width: 60, textAlign: 'center' }}>{scaleLabel(rowScale)}</span>
              <button className="btn ghost" style={{ width: 'auto' }} onClick={() => bumpScale(0.005)}>+ Looser</button>
            </div>
            <p className="muted" style={{ fontSize: 11, margin: '6px 0 0', lineHeight: 1.4 }}>
              Use "Looser" if top labels print too low and bottom labels too high (printer is compressing). "Tighter" for the opposite.
            </p>
            {(offsetX !== 0 || offsetY !== 0 || rowScale !== 1) && (
              <button className="btn ghost" style={{ marginTop: 6, fontSize: 13 }} onClick={resetOffsets}>Reset all to zero</button>
            )}
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeText} onChange={(e) => setIncludeText(e.target.checked)} style={{ width: 'auto' }} />
          Include bin name & info on label
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={doubleUp} onChange={(e) => setDoubleUp(e.target.checked)} style={{ width: 'auto' }} />
          Print 2 labels per bin <span className="muted" style={{ fontSize: 12 }}>(one for each end)</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 'auto' }} />
          Remember as my default <span className="muted" style={{ fontSize: 12 }}>(size & offset)</span>
        </label>

        {isSheet && (
          <div style={{ marginTop: 14, padding: 12, background: '#fff8e0', border: '1px solid #f0d069', borderRadius: 9 }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px', color: '#7a5800' }}>⚠️ Before you tap Print</p>
            <p style={{ fontSize: 13, margin: '0 0 6px', lineHeight: 1.5, color: '#5a4400' }}>
              In the print dialog that opens, set these or labels won't line up:
            </p>
            <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18, lineHeight: 1.6, color: '#5a4400' }}>
              <li><strong>Scale: 100%</strong> (or "Actual size") — not "Fit to page"</li>
              <li><strong>Margins: None</strong> or "Default"</li>
              <li><strong>Paper: Letter</strong> (8.5 × 11 in)</li>
              <li>Print on <strong>plain paper first</strong> to test, then real labels</li>
            </ul>
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onPick(sel, remember, includeText, doubleUp ? 2 : 1, { x: offsetX, y: offsetY }, rowScale)}>Print</button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Settings ---------------- */
function SettingsView({ resellerMode, toggleReseller, onBack, signOut, email, plan, onUpgrade, defaultLabelSize, setDefaultLabelSize, spaceName }) {
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
        <p style={{ fontWeight: 500, margin: '0 0 4px' }}>Default label size</p>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Used when you print. You can still pick a different size each time.</p>
        <select value={defaultLabelSize || ''} onChange={(e) => setDefaultLabelSize(e.target.value || null)}>
          <option value="">No default — ask every time</option>
          {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 500, margin: 0 }}>Reseller mode <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {spaceName}</span></p>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0', lineHeight: 1.5 }}>
              Per-space setting. Adds cost, sale price, marketplace, SKU and status to each item, plus a profit summary — for this space only. Switch the space on the main screen to toggle reseller mode for a different one.
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
