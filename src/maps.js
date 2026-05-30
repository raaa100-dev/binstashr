// Helpers to turn uploaded files into something we can store and display
// as a floor plan map: SVG passes through, images pass through (and we read
// their dimensions), PDFs get their first page rendered to a PNG.

import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

// Read an image File and return { blob, ext, width, height }.
function readImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const ext = file.type === 'image/png' ? 'png' : (file.type === 'image/jpeg' ? 'jpg' : 'png')
      resolve({ blob: file, ext, width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

// Read an SVG file: pass it through, and read its width/height by parsing.
function readSVG(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      // Try to find width/height or viewBox in the SVG
      let width = 1000, height = 800
      const vbMatch = text.match(/viewBox\s*=\s*["']([^"']+)["']/i)
      if (vbMatch) {
        const parts = vbMatch[1].split(/[\s,]+/).map(Number)
        if (parts.length === 4) { width = parts[2]; height = parts[3] }
      } else {
        const wMatch = text.match(/<svg[^>]*\swidth\s*=\s*["']?(\d+)/i)
        const hMatch = text.match(/<svg[^>]*\sheight\s*=\s*["']?(\d+)/i)
        if (wMatch) width = parseInt(wMatch[1])
        if (hMatch) height = parseInt(hMatch[1])
      }
      resolve({ blob: file, ext: 'svg', width, height })
    }
    reader.onerror = reject
    reader.readAsText(file)
  })
}

// Render first page of a PDF to a PNG blob.
async function readPDF(file) {
  const arrayBuf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: arrayBuf }).promise
  const page = await doc.getPage(1)
  // Render at a reasonable resolution — high enough to read text on a floor plan,
  // capped so storage size stays sane.
  const viewport = page.getViewport({ scale: 2 })
  const targetMaxSide = 2400
  const longest = Math.max(viewport.width, viewport.height)
  const scale = longest > targetMaxSide ? (2 * targetMaxSide / longest) : 2
  const finalVp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = finalVp.width
  canvas.height = finalVp.height
  const ctx = canvas.getContext('2d')
  // White background so transparent areas don't go black on screens
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport: finalVp }).promise
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png', 0.9))
  return { blob, ext: 'png', width: canvas.width, height: canvas.height }
}

// Dispatch on file type.
export async function processMapFile(file) {
  const name = file.name.toLowerCase()
  if (file.type === 'image/svg+xml' || name.endsWith('.svg')) return readSVG(file)
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return readPDF(file)
  if (file.type.startsWith('image/')) return readImageDimensions(file)
  throw new Error('Unsupported file type — please upload SVG, PDF, PNG, or JPG.')
}
