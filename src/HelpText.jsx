import React from 'react'
import { COMPANY_NAME, SUPPORT_EMAIL } from './config'

export function HelpText() {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.65 }}>
      <p style={{ marginTop: 0 }}>Welcome to {COMPANY_NAME}. Here's a quick guide to everything you can do.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>📦 Creating a container</h3>
      <p>Tap the green <strong>+ Add</strong> button in the bottom bar. Give it a name (like “Garage bin A”), a location (like “Garage → Shelf 3”), and optionally a category and description. Add photos so you remember what's inside without opening the bin. Then add inventory items one by one — each one can have a quantity, optional value, and optional expiration date. Save it, and the app generates a unique QR code for that bin.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>🖨 Printing labels</h3>
      <p>Open any container's detail screen and tap <strong>Print label</strong>. A size picker opens with a live preview — pick the size that matches your label paper or label printer (Avery 5160 sheets, Dymo or Brother thermal labels, 4×6 thermal, etc.). Tick “Remember as my default size” to skip the picker next time. Stick the printed label on the actual bin, and you're done.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>▢ Scanning a bin</h3>
      <p>Tap the <strong>Scan</strong> tab and point your camera at any label you've printed. The app opens that container's contents instantly. If you want to add an item to the bin you just scanned, tap “Add an item here” right from the scan result — no need to navigate anywhere.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>🔍 Finding things</h3>
      <p>On the main list, type any word into the search bar — name, location, category, or even the name of an item inside a bin. The matching bin shows up and tells you exactly which item matched and where the bin lives. This is the “I need the drill bits” superpower.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>⧉ Setting up many bins at once</h3>
      <p>Open the <strong>More</strong> tab → <strong>Print blank labels</strong>. Choose how many empty containers you want (say 10), and the app creates them and prints their QR codes. Stick the labels on your actual bins, then scan each one to set its location and add inventory on the spot. Faster than typing everything in first.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>⏰ Expiration tracking</h3>
      <p>When you add or edit an item, set an optional expiration date. The app surfaces a red alert on the main screen the moment anything is expired or expiring within two weeks. Tap it to open the <strong>Expiring soon</strong> dashboard — a triage view across every bin, sorted by what's expiring first, with one-tap “Mark used.” Great for pantry, medicine, and warranties.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>📤 Pulling items out</h3>
      <p>On a container's detail, each item has a small arrow icon. Tap it and choose what happened to that item: <strong>Used</strong>, <strong>Sold</strong>, or <strong>Remove</strong>. Used and Sold keep a record in the bin's history; Remove deletes the item with no trace. If you choose Sold, the app captures the price and any selling fees right there so your profit tracking stays accurate.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>📊 Reseller mode</h3>
      <p>In <strong>Settings → Reseller mode</strong>, turn the toggle on. Each item gains cost, sale price, marketplace, SKU, and status (In stock / Listed / Sold / Shipped). A new “Sales summary” entry appears in the More menu with revenue, item cost, total fees, net profit, items sold, a breakdown by marketplace, and a downloadable CSV of every sale for taxes. Turn the toggle off any time to hide the reseller fields and return to simple home-organizing mode.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>👥 Sharing with family (Households)</h3>
      <p>The space switcher at the top of the main list flips between your <strong>Personal</strong> inventory (private to you) and any <strong>Household</strong> you've joined (shared with everyone in it). To set one up, open More → Households → Create a household. The household gets a short join code; share that with anyone you want to add, and they enter it under “Join with a code.” Owners can also promote members to co-owners. Move a container from Personal to a shared household at any time using the “↪ Move to another space” button on its detail page.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>♻ Reprinting a label</h3>
      <p>If a label rubs off or you change a bin's title, just open the container and tap <strong>Print label</strong> again. The QR code is the same as before, so any scan will still find the same bin — and now your new title appears on the fresh label. You can also do this in bulk for many bins via More → Print blank labels (for new ones) or by reprinting bins individually as needed.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>⤓ Backing up your data</h3>
      <p>From the main list, tap the export icon next to the sort dropdown to download a CSV of every container and item. Reseller mode adds a separate “Download sales CSV” inside the Sales summary screen for tax records. The data also syncs to the cloud automatically across your devices.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>📱 Installing on your phone</h3>
      <p>For best use, install the app to your home screen so it acts like a native app. On iPhone, tap the Share button in Safari and choose “Add to Home Screen.” On Android, tap the three-dot menu in Chrome and choose “Install app” or “Add to Home screen.” The camera scanner needs this for best performance.</p>

      <h3 style={{ marginTop: 22, fontSize: 16 }}>💬 Need more help?</h3>
      <p>Reach us at {SUPPORT_EMAIL}.</p>
    </div>
  )
}
