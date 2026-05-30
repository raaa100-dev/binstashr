import { supabase } from './supabaseClient'

// ---- Containers ----
// space: null = personal (only my own, no household); otherwise a household id.
export async function fetchContainers(userId, space) {
  let q = supabase.from('containers').select('*').order('created_at', { ascending: false })
  if (space) q = q.eq('household_id', space)
  else q = q.is('household_id', null).eq('user_id', userId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map(rowToItem)
}

export async function upsertContainer(userId, item, space) {
  const row = {
    id: item.id,
    user_id: item.user_id || userId,
    household_id: space || null,
    name: item.name || 'Untitled',
    location: item.location || '',
    category: item.category || '',
    description: item.description || '',
    expires: item.expires || null,
    photos: item.photos || [],
    contents: item.contents || [],
    history: item.history || [],
  }
  const { error } = await supabase.from('containers').upsert(row)
  if (error) throw error
}

export async function deleteContainer(id) {
  const { error } = await supabase.from('containers').delete().eq('id', id)
  if (error) throw error
}

// Move a container to a different space: targetSpace = null (Personal) or a household id.
export async function moveContainer(id, targetSpace) {
  const { error } = await supabase
    .from('containers')
    .update({ household_id: targetSpace || null })
    .eq('id', id)
  if (error) throw error
}

// Create N blank containers at once (for batch-printing blank QR labels).
export async function createBlankContainers(userId, ids, space) {
  const rows = ids.map((id) => ({
    id, user_id: userId, household_id: space || null,
    name: 'Untitled', location: '', category: '',
    description: '', expires: null, photos: [], contents: [], history: [],
  }))
  const { error } = await supabase.from('containers').insert(rows)
  if (error) throw error
}

function rowToItem(r) {
  return {
    id: r.id,
    user_id: r.user_id,
    household_id: r.household_id || null,
    name: r.name,
    location: r.location || '',
    category: r.category || '',
    description: r.description || '',
    expires: r.expires || '',
    photos: r.photos || [],
    contents: r.contents || [],
    history: r.history || [],
    mapId: r.map_id || null,
    pinX: r.pin_x !== null && r.pin_x !== undefined ? r.pin_x : null,
    pinY: r.pin_y !== null && r.pin_y !== undefined ? r.pin_y : null,
    created: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  }
}

// ---- Settings & plan ----
const TRIAL_DAYS = 14
export const FREE_CONTAINER_LIMIT = 5   // containers allowed after trial on the free tier

export async function fetchSettings(userId) {
  const { data, error } = await supabase
    .from('settings').select('reseller_mode, active_household, plan, trial_ends, default_label_size, terms_version').eq('user_id', userId).maybeSingle()
  if (error) throw error
  // First time we see this user: start their free trial.
  if (!data) {
    const ends = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString()
    try {
      await supabase.from('settings').upsert({
        user_id: userId, plan: 'trial', trial_ends: ends, updated_at: new Date().toISOString(),
      })
    } catch (e) { /* non-fatal */ }
    return { resellerMode: false, activeHousehold: null, plan: 'trial', trialEnds: ends, defaultLabelSize: null, termsVersion: 0 }
  }
  return {
    resellerMode: !!data.reseller_mode,
    activeHousehold: data.active_household || null,
    plan: data.plan || 'trial',
    trialEnds: data.trial_ends || null,
    defaultLabelSize: data.default_label_size || null,
    termsVersion: data.terms_version || 0,
  }
}

export async function saveSettings(userId, { resellerMode, activeHousehold, plan, defaultLabelSize, termsVersion }) {
  const patch = { user_id: userId, updated_at: new Date().toISOString() }
  if (resellerMode !== undefined) patch.reseller_mode = resellerMode
  if (activeHousehold !== undefined) patch.active_household = activeHousehold
  if (plan !== undefined) patch.plan = plan
  if (defaultLabelSize !== undefined) patch.default_label_size = defaultLabelSize
  if (termsVersion !== undefined) { patch.terms_version = termsVersion; patch.terms_agreed_at = new Date().toISOString() }
  const { error } = await supabase.from('settings').upsert(patch)
  if (error) throw error
}

// ---- Households ----
function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

export async function fetchHouseholds(userId) {
  // households I'm a member of
  const { data: mem, error: e1 } = await supabase
    .from('household_members').select('household_id, role').eq('user_id', userId)
  if (e1) throw e1
  if (!mem || !mem.length) return []
  const ids = mem.map((m) => m.household_id)
  const { data: hs, error: e2 } = await supabase
    .from('households').select('*').in('id', ids)
  if (e2) throw e2
  const roleById = Object.fromEntries(mem.map((m) => [m.household_id, m.role]))
  return (hs || []).map((h) => ({ id: h.id, name: h.name, joinCode: h.join_code, ownerId: h.owner_id, role: roleById[h.id] || 'member' }))
}

export async function createHousehold(userId, name) {
  const { data, error } = await supabase
    .from('households')
    .insert({ name: name || 'My household', owner_id: userId, join_code: makeCode() })
    .select().single()
  if (error) throw error
  return { id: data.id, name: data.name, joinCode: data.join_code, ownerId: data.owner_id, role: 'owner' }
}

export async function joinHouseholdByCode(code) {
  const { data, error } = await supabase.rpc('join_household_by_code', { code })
  if (error) throw error
  return data || null   // household id or null
}

export async function fetchMembers(householdId) {
  const { data, error } = await supabase
    .from('household_members').select('user_id, email, role').eq('household_id', householdId)
  if (error) throw error
  return data || []
}

export async function leaveHousehold(userId, householdId) {
  const { error } = await supabase
    .from('household_members').delete().eq('household_id', householdId).eq('user_id', userId)
  if (error) throw error
}

export async function removeMember(householdId, userId) {
  const { error } = await supabase
    .from('household_members').delete().eq('household_id', householdId).eq('user_id', userId)
  if (error) throw error
}

// Promote a member to 'owner' or demote to 'member'.
export async function setMemberRole(householdId, userId, role) {
  const { error } = await supabase
    .from('household_members').update({ role }).eq('household_id', householdId).eq('user_id', userId)
  if (error) throw error
}

export async function deleteHousehold(householdId) {
  const { error } = await supabase.from('households').delete().eq('id', householdId)
  if (error) throw error
}

export async function inviteByEmail(householdId, userId, email) {
  const { error } = await supabase
    .from('household_invites').insert({ household_id: householdId, email: email.trim().toLowerCase(), invited_by: userId })
  if (error) throw error
}

// ---- Maps / floor plans ----
export async function fetchMaps(userId, space) {
  let q = supabase.from('maps').select('*').order('created_at', { ascending: false })
  if (space) q = q.eq('household_id', space)
  else q = q.is('household_id', null).eq('user_id', userId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((m) => ({
    id: m.id, name: m.name, imageUrl: m.image_url,
    width: m.width || 1000, height: m.height || 800,
    householdId: m.household_id || null, userId: m.user_id,
  }))
}

export async function uploadMapImage(userId, blob, ext = 'png') {
  const path = `${userId}/map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('maps').upload(path, blob, {
    contentType: ext === 'svg' ? 'image/svg+xml' : (ext === 'jpg' ? 'image/jpeg' : 'image/png'),
    upsert: false,
  })
  if (error) throw error
  const { data } = supabase.storage.from('maps').getPublicUrl(path)
  return data.publicUrl
}

export async function createMap(userId, { name, imageUrl, width, height, householdId }) {
  const { data, error } = await supabase
    .from('maps')
    .insert({ user_id: userId, household_id: householdId || null, name: name || 'Map', image_url: imageUrl, width, height })
    .select().single()
  if (error) throw error
  return { id: data.id, name: data.name, imageUrl: data.image_url, width: data.width, height: data.height, householdId: data.household_id }
}

export async function deleteMap(mapId) {
  // Clear any container pins that reference it, then delete.
  await supabase.from('containers').update({ map_id: null, pin_x: null, pin_y: null }).eq('map_id', mapId)
  const { error } = await supabase.from('maps').delete().eq('id', mapId)
  if (error) throw error
}

export async function setContainerPin(containerId, mapId, x, y) {
  const { error } = await supabase
    .from('containers')
    .update({ map_id: mapId, pin_x: x, pin_y: y })
    .eq('id', containerId)
  if (error) throw error
}

export async function clearContainerPin(containerId) {
  const { error } = await supabase
    .from('containers')
    .update({ map_id: null, pin_x: null, pin_y: null })
    .eq('id', containerId)
  if (error) throw error
}

// ---- Photos (Supabase Storage) ----
export async function uploadPhoto(userId, blob) {
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage.from('photos').upload(path, blob, {
    contentType: 'image/jpeg', upsert: false,
  })
  if (error) throw error
  const { data } = supabase.storage.from('photos').getPublicUrl(path)
  return data.publicUrl
}

export async function deletePhoto(url) {
  try {
    const marker = '/photos/'
    const i = url.indexOf(marker)
    if (i === -1) return
    const path = url.slice(i + marker.length)
    await supabase.storage.from('photos').remove([path])
  } catch (e) { /* non-fatal */ }
}
