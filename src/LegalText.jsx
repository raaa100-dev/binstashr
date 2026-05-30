import React from 'react'
import { COMPANY_NAME, SUPPORT_EMAIL } from './config'

// NOTE TO THE OPERATOR (not shown to users):
// The text below is a reasonable starter document that reflects how this app
// actually works. It is NOT a substitute for legal advice. Before opening the
// app to paying or sensitive users, have an actual attorney review and revise
// it for your jurisdiction and business model. The TERMS_VERSION in config.js
// tracks which version each user has agreed to.

export function TermsText() {
  return (
    <div>
      <p><em>Last updated: 2026. This is a starter agreement and may be updated as the service evolves.</em></p>

      <h3 style={{ marginTop: 18 }}>1. What this service is</h3>
      <p>{COMPANY_NAME} (“we,” “us,” “the Service”) is an inventory tracking application. It lets you create labeled containers, generate QR codes, scan them with your camera, and optionally share inventory with people you invite to a household. You use it at your own discretion.</p>

      <h3 style={{ marginTop: 18 }}>2. Your account</h3>
      <p>To use the Service you create an account with an email address and password. You are responsible for keeping your password confidential and for everything that happens under your account. You agree to provide accurate information when registering, and you must be at least the age of majority in your jurisdiction (typically 18) to create an account.</p>

      <h3 style={{ marginTop: 18 }}>3. Acceptable use</h3>
      <p>You agree not to use the Service to store, share, or transmit unlawful content; to attempt to gain unauthorized access to other accounts or the underlying systems; to interfere with the Service's normal operation; or to use it for any purpose prohibited by law. We may suspend or terminate accounts that violate these rules.</p>

      <h3 style={{ marginTop: 18 }}>4. Your content</h3>
      <p>You retain ownership of the data you put into the Service (your container names, photos, inventory items, notes, and so on). You grant us only the limited rights needed to store and display it back to you and to anyone you intentionally share it with through household features.</p>

      <h3 style={{ marginTop: 18 }}>5. Subscription and payments</h3>
      <p>The Service may offer free, trial, and paid plans. Free or complimentary access may be modified or discontinued. If you subscribe to a paid plan in the future, the terms of that subscription (price, billing cycle, refund policy) will be presented at the time of purchase. We may change pricing for future billing cycles with reasonable notice.</p>

      <h3 style={{ marginTop: 18 }}>6. No warranty</h3>
      <p>The Service is provided “as is,” without warranties of any kind, express or implied. We do not guarantee that the Service will be uninterrupted, error-free, or that your data will never be lost. You are responsible for keeping your own backups of important data (the Service provides CSV export for this purpose).</p>

      <h3 style={{ marginTop: 18 }}>7. Limitation of liability</h3>
      <p>To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits or lost data, arising from your use of the Service. Our total liability for any claim related to the Service is limited to the amount you have paid us in the twelve months preceding the claim (or zero if you have not paid).</p>

      <h3 style={{ marginTop: 18 }}>8. Termination</h3>
      <p>You may stop using the Service at any time. We may suspend or terminate your account if you violate these Terms or if we discontinue the Service. On termination, your data may be deleted after a reasonable period. You can also delete your own data at any time within the app.</p>

      <h3 style={{ marginTop: 18 }}>9. Changes to these Terms</h3>
      <p>We may update these Terms over time. If we make material changes, we will ask you to agree again before continuing to use the Service.</p>

      <h3 style={{ marginTop: 18 }}>10. Contact</h3>
      <p>Questions about these Terms can be sent to {SUPPORT_EMAIL}.</p>
    </div>
  )
}

export function PrivacyText() {
  return (
    <div>
      <p><em>Last updated: 2026. This describes what data {COMPANY_NAME} collects and how it is used.</em></p>

      <h3 style={{ marginTop: 18 }}>1. What we collect</h3>
      <p>We collect the information you give us when you use the Service, including:</p>
      <ul>
        <li>Your email address and password (the password is stored hashed, never in plain text).</li>
        <li>The content you create in the app — container names, locations, categories, photos, inventory items, expiration dates, and sales records if you use the reseller features.</li>
        <li>If you join or create a household, the membership information needed to share inventory with the people you invite.</li>
        <li>Basic technical information your browser sends, such as your IP address and device type, used to operate and secure the Service.</li>
      </ul>

      <h3 style={{ marginTop: 18 }}>2. What we do NOT collect</h3>
      <p>We do not knowingly collect data from anyone under the age of 13. We do not sell your data to advertisers. We do not run advertising trackers inside the app.</p>

      <h3 style={{ marginTop: 18 }}>3. How we use your data</h3>
      <p>We use your data only to:</p>
      <ul>
        <li>Operate the Service — sign you in, store your inventory, generate your QR codes, sync across your devices, etc.</li>
        <li>Share inventory with the household members you have explicitly invited.</li>
        <li>Communicate with you about your account (e.g., security notices, important changes to the Service).</li>
        <li>Protect the Service from abuse and meet legal obligations.</li>
      </ul>

      <h3 style={{ marginTop: 18 }}>4. Who can see your data</h3>
      <p>Inside the app, your personal containers are visible only to you. Household containers are visible to the members of that household. We use industry-standard row-level security at the database layer to enforce this — meaning the database itself blocks unauthorized access, not just the app.</p>
      <p>We use Supabase as our backend infrastructure provider; your data is stored on their servers under their security practices. We do not share your data with any third party except as required to operate the Service (such as our cloud hosting provider) or as required by law.</p>

      <h3 style={{ marginTop: 18 }}>5. Photos and barcodes</h3>
      <p>Photos you upload are stored in cloud storage and made accessible via a link so the app can display them. Anyone with that specific link could see the image; do not upload photos containing sensitive personal information. QR codes generated by the app encode only an internal identifier — they do not embed the contents of your inventory.</p>

      <h3 style={{ marginTop: 18 }}>6. Your choices</h3>
      <p>You can:</p>
      <ul>
        <li>Edit or delete any container, item, or photo at any time within the app.</li>
        <li>Export all your data to a CSV file from within the app.</li>
        <li>Leave or delete any household you belong to.</li>
        <li>Delete your account by contacting us at {SUPPORT_EMAIL}; we will remove your data within a reasonable period.</li>
      </ul>

      <h3 style={{ marginTop: 18 }}>7. Data retention</h3>
      <p>We keep your data for as long as your account is active. After deletion, residual copies may persist briefly in backup systems before being purged.</p>

      <h3 style={{ marginTop: 18 }}>8. Security</h3>
      <p>We take reasonable steps to protect your data, including encrypted connections (HTTPS), hashed passwords, and database-level access controls. No system is perfectly secure; if a breach occurs we will notify affected users as required by law.</p>

      <h3 style={{ marginTop: 18 }}>9. Children</h3>
      <p>The Service is not intended for use by children under 13, and we do not knowingly collect personal information from them. If you believe a child has provided us information, please contact us so we can remove it.</p>

      <h3 style={{ marginTop: 18 }}>10. Changes</h3>
      <p>If we make material changes to this Policy, we will ask you to review and agree to the updated version before continuing to use the Service.</p>

      <h3 style={{ marginTop: 18 }}>11. Contact</h3>
      <p>Privacy questions can be sent to {SUPPORT_EMAIL}.</p>
    </div>
  )
}
