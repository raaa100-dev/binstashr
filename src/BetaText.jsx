import React from 'react'
import { COMPANY_NAME, SUPPORT_EMAIL } from './config'

export function BetaAgreementText() {
  return (
    <div>
      <p><em>For early testers helping us shape {COMPANY_NAME} before public launch.</em></p>

      <h3 style={{ marginTop: 18 }}>Thanks for trying this with us</h3>
      <p>You're using {COMPANY_NAME} during its beta period — before paid plans launch and before the product is considered finished. We're really grateful you're here. In exchange for early access, we ask a few things of you and we want to be upfront about what you should expect.</p>

      <h3 style={{ marginTop: 18 }}>1. What you get</h3>
      <p>Free access to all features during the beta period. No credit card needed. You'll keep your inventory data when we launch paid plans, and your beta account will continue to work — though we may move you to a free tier or invite you to upgrade at that point.</p>

      <h3 style={{ marginTop: 18 }}>2. Expect rough edges</h3>
      <p>This is beta software. That means:</p>
      <ul>
        <li>Things will sometimes break. Buttons may not do what you expect. Features may move or disappear without warning.</li>
        <li>The app may go down for short periods while we ship updates.</li>
        <li>In rare cases, we may need to reset or migrate data in ways that affect your account. We'll warn you in advance whenever possible, but please don't store anything in {COMPANY_NAME} that you can't afford to lose. Export your inventory to CSV from time to time as your own backup.</li>
      </ul>

      <h3 style={{ marginTop: 18 }}>3. We need your feedback</h3>
      <p>The whole point of a beta is to find what's wrong before everyone else sees it. We'd love it if you:</p>
      <ul>
        <li>Use the "Send feedback" button in the More menu when you hit something — a bug, a confusing interaction, or just an idea.</li>
        <li>Tell us if a feature isn't useful so we can simplify rather than add more.</li>
        <li>Let us know what you'd happily pay for, and what you wouldn't.</li>
      </ul>
      <p>Honest reactions help more than polite ones. If something is bad, please say so.</p>

      <h3 style={{ marginTop: 18 }}>4. Please keep beta details private (for now)</h3>
      <p>While you're welcome to tell friends you're testing something, please don't share screenshots, the public URL, or details of unreleased features outside the people you know personally. We want to control the first impression when we open it to everyone.</p>

      <h3 style={{ marginTop: 18 }}>5. No warranty during beta</h3>
      <p>Because this is unfinished software, {COMPANY_NAME} is provided "as is" during the beta period, without warranty of any kind. We are not liable for any data loss, business disruption, or other damages that arise from your use of the service while it's in beta. Our regular Terms of Service apply otherwise.</p>

      <h3 style={{ marginTop: 18 }}>6. Your data</h3>
      <p>The full Privacy Policy applies — see it in the More menu. The short version: we use your data only to run the app for you and the people you share households with. We don't sell it to anyone. You can export it any time as CSV, and you can ask us to delete your account at any time by emailing {SUPPORT_EMAIL}.</p>

      <h3 style={{ marginTop: 18 }}>7. Either of us can end the beta</h3>
      <p>You can stop using the beta whenever you want — just stop signing in, or email us to delete your account. We can also end your beta access if your use of the service violates the Terms or if we wind down the beta program. Most likely scenario: we run the beta for several weeks, fix what people find, then launch paid plans and invite you to keep using it.</p>

      <h3 style={{ marginTop: 18 }}>Questions?</h3>
      <p>Email {SUPPORT_EMAIL}. Thanks for testing with us — we appreciate it.</p>
    </div>
  )
}
