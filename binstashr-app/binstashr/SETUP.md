# BinStashR — setup & deployment guide

This is the complete source code for your inventory app: a Progressive Web App (PWA)
you install on your phone's home screen, sign into with your own account, and that
syncs to the cloud across all your devices.

You don't need to write any code. You'll do three things:
1. Create a free Supabase project (your backend: accounts + database + photo storage)
2. Plug two values from Supabase into this app
3. Deploy the app to the web for free (Vercel) and add it to your phone

Total time: about 30–45 minutes the first time. No prior experience needed.

---

## What you need first

- A computer (Mac, Windows, or Linux)
- Node.js installed (the free runtime that builds the app).
  Download the "LTS" version from https://nodejs.org and install it.
- A free GitHub account (https://github.com) — used to deploy.

---

## Part 1 — Create your backend (Supabase)

1. Go to https://supabase.com and click "Start your project". Sign up (free).
2. Click "New project". Give it a name like `binstashr`, set a database password
   (save it somewhere), pick the region closest to you, and create it.
   Wait ~2 minutes for it to finish provisioning.
3. In the left sidebar, open the **SQL Editor** → "New query".
   Open the file `supabase_schema.sql` from this project, copy ALL of it, paste it
   into the editor, and click **Run**. This creates your tables, security rules,
   and the photo storage bucket. You should see "Success".
   (If you set up an earlier version of this app, just run the script again — it
   safely adds the new expiration, history, and household/sharing tables without
   touching your existing data.)
4. In the left sidebar, open **Project Settings** (gear) → **API**.
   Copy two values — you'll need them in Part 2:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

### Email confirmation (optional but recommended for real use)
By default Supabase emails new users a confirmation link. For easy personal testing
you can turn it off: **Authentication → Sign In / Providers → Email**, toggle off
"Confirm email". For a public app, leave it on.

---

## Part 2 — Connect the app to your backend

1. In this project folder, find the file `.env.example`. Make a copy of it named
   exactly `.env` (note the leading dot, no `.example`).
2. Open `.env` in any text editor and paste your two values from Part 1:

   ```
   VITE_SUPABASE_URL=https://abcd1234.supabase.co
   VITE_SUPABASE_ANON_KEY=the-long-anon-public-key
   ```

3. Save the file. (The anon key is safe to ship in a frontend app — your data is
   protected by the row-level security rules from the SQL script, not by hiding the key.)

---

## Part 3 — Run it on your computer first (to test)

Open a terminal in this project folder and run:

```
npm install
npm run dev
```

It will print a local address like `http://localhost:5173`. Open it in your browser,
create an account, add a container, and confirm everything works. Press Ctrl+C to stop.

---

## Part 4 — Put it on the web (free, with Render)

This gives you a real `https://` link you can open on your phone.

1. Push this project to a new GitHub repository. If you've never used git:
   - Install GitHub Desktop (https://desktop.github.com), "Add" this folder,
     publish it as a new repository.
2. Create a free account at https://render.com and connect it to your GitHub.
3. In the Render dashboard, click **New** → **Static Site**, and select your repository.
4. Enter these build settings exactly:
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
   (This project also includes a `render.yaml` file, so Render may fill these in
   for you automatically — just confirm they match.)
5. Open the **Environment Variables** section and add the same two values from your
   `.env` file. These MUST be set before the first build, because Vite bakes them
   into the app at build time:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
6. Click **Create Static Site**. After a minute or two you'll get a live URL like
   `https://binstashr.onrender.com`. Every future push to your branch redeploys
   automatically.

Note: if you ever change the environment variables later, trigger a fresh deploy
(Render dashboard → Manual Deploy) so the new values get baked into the build.

### One important Supabase setting after deploying
In Supabase → **Authentication → URL Configuration**, set the **Site URL** to your
Render URL (`https://...onrender.com`). This makes sign-in links and redirects work
correctly.

### A note on Render's free tier
Render's free static sites are genuinely free and stay online (static sites don't
"spin down" the way Render's free *web services* do). If you later add a separate
always-on backend service on Render's free tier, that kind of service does sleep
after inactivity — but this app's backend is Supabase, not Render, so that doesn't
apply here.

---

## Part 5 — Install it on your phone

1. On your phone, open your Render URL in the browser (Safari on iPhone, Chrome on Android).
2. Sign in / create your account.
3. Add it to your home screen:
   - **iPhone (Safari):** tap the Share button → "Add to Home Screen".
   - **Android (Chrome):** tap the ⋮ menu → "Add to Home screen" / "Install app".
4. It now appears as its own app icon and runs full-screen — including the camera
   scanner, which needs the `https://` address (that's why we deploy rather than
   using a local link on the phone).

You're done. Sign in on any device and you'll see the same inventory.

---

## What it costs

Everything above runs on free tiers:
- **Supabase free:** 500 MB database, 1 GB photo storage, 50,000 monthly users.
  Note: a free Supabase project pauses after ~1 week of no activity — just open the
  app or the dashboard to wake it. For always-on reliability, the Pro plan is $25/mo.
- **Render free (Static Sites):** free and stays online for personal use.

For your own use or a small reselling operation, free is genuinely enough to start.
If this grows into something other people sign up for, the upgrade path is the
Supabase Pro plan; nothing in the code needs to change.

---

## Where things live (if you ever want to tinker)

- `src/App.jsx` — all the screens (list, container detail, add/edit, scanner, settings)
- `src/Auth.jsx` — the sign-in / sign-up screen
- `src/data.js` — all reads/writes to the cloud
- `src/utils.js` — value/profit math, CSV export, image compression
- `src/print.js` — QR codes and label printing (single + batch)
- `src/styles.css` — colors and styling (change `--brand` to re-theme it)
- `supabase_schema.sql` — your database structure and security rules

## Troubleshooting

- **"Missing Supabase config" in the console:** your `.env` (local) or Vercel
  environment variables aren't set. Re-check Part 2 / Part 4.
- **Camera won't open:** make sure you're on the `https://` Vercel URL, not a plain
  IP/localhost address, and that you granted camera permission.
- **Sign-in seems to do nothing:** check that "Confirm email" matches your setup —
  if it's on, confirm via the email link before signing in.
- **Photos won't upload:** confirm the SQL script ran fully (it creates the `photos`
  storage bucket and its policies).
