// BinStashR — central feature flags.
// Change these and redeploy to flip behavior across the whole app.

// While true: every account behaves as if it has full complimentary access.
// No trial countdown, no upgrade prompts, no limits. Set to false when you're
// ready to enforce the paid plan and let normal trial/free/paid logic apply.
export const FREE_FOR_ALL = true

// Show or hide the "Order pre-printed labels" entry in the More menu.
export const SHOW_ORDER_LABELS = false

// Latest version of your terms/privacy that users must agree to.
// If you change the policy text in a meaningful way, bump this number and
// users will be re-prompted to agree to the new version on next sign in.
export const TERMS_VERSION = 1

// Contact email shown in legal pages and the help screen.
export const SUPPORT_EMAIL = 'support@binstashr.com'   // change to your real email
export const COMPANY_NAME  = 'BinStashR'
