import React, { useEffect, useRef, useState } from 'react'

// Map viewer: pan, pinch-zoom, and tap-to-drop pin.
// Props:
//   map: { id, imageUrl, width, height }
//   pins: [{ id, name, x, y }]   coordinates are 0..1 fractions
//   onPinTap?: (pinId) => void
//   placingMode?: boolean        if true, the next tap drops a pin
//   onPlace?: (x, y) => void     callback with 0..1 coordinates
export default function MapView({ map, pins = [], onPinTap, placingMode = false, onPlace }) {
  const stageRef = useRef(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const gesture = useRef(null)      // { kind: 'pan'|'pinch', start, ... }
  const tapStart = useRef(null)     // for detecting tap vs drag

  // Fit the image inside the stage on mount and when the map changes.
  useEffect(() => {
    if (!stageRef.current) return
    const stage = stageRef.current.getBoundingClientRect()
    const sX = stage.width / map.width
    const sY = stage.height / map.height
    const scale = Math.min(sX, sY)
    const x = (stage.width - map.width * scale) / 2
    const y = (stage.height - map.height * scale) / 2
    setView({ scale, x, y })
  }, [map.id])

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)) }
  function applyScale(nextScale, anchorX, anchorY) {
    setView((v) => {
      const s = clamp(nextScale, 0.2, 8)
      // Keep the screen point under (anchorX, anchorY) anchored as we scale.
      const k = s / v.scale
      const nx = anchorX - (anchorX - v.x) * k
      const ny = anchorY - (anchorY - v.y) * k
      return { scale: s, x: nx, y: ny }
    })
  }

  function onPointerDown(e) {
    if (!stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId)
    if (gesture.current && gesture.current.pointers) {
      gesture.current.pointers[e.pointerId] = { x: px, y: py }
      if (Object.keys(gesture.current.pointers).length === 2) {
        const [a, b] = Object.values(gesture.current.pointers)
        gesture.current = {
          kind: 'pinch',
          pointers: gesture.current.pointers,
          startDist: Math.hypot(a.x - b.x, a.y - b.y),
          startScale: view.scale,
          centerX: (a.x + b.x) / 2,
          centerY: (a.y + b.y) / 2,
        }
      }
    } else {
      gesture.current = { kind: 'pan', pointers: { [e.pointerId]: { x: px, y: py } }, startX: px, startY: py, startViewX: view.x, startViewY: view.y }
      tapStart.current = { x: px, y: py, t: Date.now() }
    }
  }

  function onPointerMove(e) {
    if (!gesture.current || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (gesture.current.pointers[e.pointerId]) {
      gesture.current.pointers[e.pointerId] = { x: px, y: py }
    }
    if (gesture.current.kind === 'pan') {
      const dx = px - gesture.current.startX
      const dy = py - gesture.current.startY
      setView((v) => ({ ...v, x: gesture.current.startViewX + dx, y: gesture.current.startViewY + dy }))
    } else if (gesture.current.kind === 'pinch') {
      const pts = Object.values(gesture.current.pointers)
      if (pts.length >= 2) {
        const [a, b] = pts
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const next = gesture.current.startScale * (dist / gesture.current.startDist)
        applyScale(next, gesture.current.centerX, gesture.current.centerY)
      }
    }
  }

  function onPointerUp(e) {
    if (!gesture.current) return
    const moved = tapStart.current
      ? Math.hypot(view.x - (gesture.current.startViewX || view.x), view.y - (gesture.current.startViewY || view.y))
      : 999
    const wasTap = tapStart.current && gesture.current.kind === 'pan' &&
      Date.now() - tapStart.current.t < 300 && moved < 6
    if (gesture.current.pointers) delete gesture.current.pointers[e.pointerId]
    if (!gesture.current.pointers || !Object.keys(gesture.current.pointers).length) {
      // Tap-to-place when no pin was tapped
      if (wasTap && placingMode && stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect()
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        // Convert to image coordinates (0..1 fraction)
        const imgX = (px - view.x) / view.scale
        const imgY = (py - view.y) / view.scale
        const fx = imgX / map.width
        const fy = imgY / map.height
        if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) onPlace && onPlace(fx, fy)
      }
      gesture.current = null
      tapStart.current = null
    }
  }

  function onWheel(e) {
    e.preventDefault()
    if (!stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 0.88
    applyScale(view.scale * factor, px, py)
  }

  function zoomBy(factor) {
    if (!stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    applyScale(view.scale * factor, rect.width / 2, rect.height / 2)
  }
  function resetView() {
    const stage = stageRef.current.getBoundingClientRect()
    const sX = stage.width / map.width
    const sY = stage.height / map.height
    const scale = Math.min(sX, sY)
    const x = (stage.width - map.width * scale) / 2
    const y = (stage.height - map.height * scale) / 2
    setView({ scale, x, y })
  }

  const layerStyle = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, width: map.width, height: map.height }

  return (
    <div
      ref={stageRef}
      className="map-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ cursor: placingMode ? 'crosshair' : 'grab' }}
    >
      <div className="layer" style={layerStyle}>
        <img className="bg" src={map.imageUrl} alt="" draggable="false"
          width={map.width} height={map.height}
          onError={(e) => { e.target.style.background = '#eee' }} />
        {pins.map((p) => (
          <div key={p.id} className={`pin ${p.placing ? 'placing' : ''}`}
            style={{ left: `${p.x * map.width}px`, top: `${p.y * map.height}px`, transform: `scale(${1 / view.scale})`, transformOrigin: 'center bottom' }}
            onClick={(e) => { e.stopPropagation(); onPinTap && onPinTap(p.id) }}
            title={p.name}>
            <svg viewBox="0 0 24 28" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0c-6 0-10 4.3-10 10 0 7.5 10 18 10 18s10-10.5 10-18C22 4.3 18 0 12 0z" fill={p.color || '#0f6e56'} stroke="#fff" strokeWidth="1.5"/>
              <circle cx="12" cy="10" r="4" fill="#fff"/>
            </svg>
          </div>
        ))}
      </div>
      <div className="map-controls">
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in">＋</button>
        <button onClick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
        <button onClick={resetView} aria-label="Fit map" style={{ fontSize: 14 }}>⛶</button>
      </div>
    </div>
  )
}
