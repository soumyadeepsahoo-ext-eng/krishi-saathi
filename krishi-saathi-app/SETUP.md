# Krishi Saathi — setup guide

This guide takes you from zero to a live farmer chatbot on **your website** and as an **Android/iPhone app**. Both use one backend and one database.

You don't need to be a developer to follow it, but you will run a few commands in a terminal. Allow **2–3 hours** the first time.

---

## What's in the folder

```
krishi-saathi-app/
├── backend/            The server: talks to Claude, the database and voice services
│   ├── src/            server.js (API), prompt.js (bot instructions), store.js (database), languages.js
│   ├── public/         widget.js (website chat), admin.html (knowledge base + insights), index.html (demo)
│   └── .env.example    Settings template
├── mobile/             The Expo (React Native) app for Android and iPhone
│   ├── App.js          All screens: chat, languages, past chats, farm profile
│   └── src/            api.js (server connection), Markdown.js (answer formatting)
├── supabase/
│   ├── schema.sql      Creates the database tables
│   └── seed.sql        Six SAMPLE knowledge-base entries (verify before launch)
└── render.yaml         One-click deploy settings for Render
```

### How it fits together

```
Website widget ─┐
                ├──►  Backend (Render)  ──►  Claude API (answers + photo diagnosis)
Mobile app ─────┘          │            ──►  Sarvam AI (voice in 22 languages, read-aloud in 11)
                           ▼
                  Supabase (PostgreSQL): farmers, chats, messages, ratings, knowledge base
```

---

## Step 0 — Accounts to create

| Account | What for | Cost |
|---|---|---|
| **Anthropic Console** — console.anthropic.com | Claude API key (the bot's brain) | Pay per use; add credits |
| **Supabase** — supabase.com | Database | Free tier is enough to start |
| **Render** — render.com | Hosts the backend | Free tier sleeps when idle; use a paid instance for real farmers |
| **GitHub** — github.com | Stores the code so Render can deploy it | Free (use a **private** repository) |
| **Sarvam AI** — dashboard.sarvam.ai *(optional)* | Voice questions and read-aloud | Pay per use; free trial credits |
| **Expo** — expo.dev | Builds the mobile app in the cloud | Free tier is enough to start |
| **Google Play Console** *(when publishing)* | Puts the app on the Play Store | One-time registration fee |

Check each provider's current pricing page before launch. Use an organisation email for all accounts so access isn't tied to one person.

You'll also need **Node.js 20 or newer** on your computer (nodejs.org → LTS version).

---

## Step 1 — Create the database (Supabase)

1. In Supabase, click **New project**. Pick the **Mumbai (ap-south-1)** region, set a strong database password and save it.
2. When the project is ready, open **SQL Editor → New query**.
3. Paste the whole of `supabase/schema.sql` and click **Run**.
4. *(Optional)* Paste `supabase/seed.sql` and click **Run** to add the six sample entries.
5. Go to **Project Settings → API** and copy:
   - **Project URL**: this is your `SUPABASE_URL`.
   - **service_role** secret key: this is your `SUPABASE_SERVICE_ROLE_KEY`.

> ⚠️ The service_role key gives full database access. Only put it on the server, never in the app or website.

## Step 2 — Get a Claude API key

1. At console.anthropic.com go to **Settings → API keys → Create key**. Copy it: this is your `ANTHROPIC_API_KEY`.
2. Under **Billing**, add credits and set a **monthly spend limit**, so costs can't run away.

The bot uses **Claude Sonnet 5.5** (`claude-sonnet-5-5`) for normal answers and **Claude Haiku 5.5** (`claude-haiku-5-5`) when "fast" mode is requested. You can change these in `.env`. The knowledge base is sent with **prompt caching**, so repeat questions cost much less.

## Step 3 — (Optional) Voice with Sarvam AI

1. Sign up at dashboard.sarvam.ai and create an API key. This is your `SARVAM_API_KEY`.
2. With this key:
   - Farmers can **speak questions** in all 22 scheduled languages (Saaras speech-to-text, auto-detects the language).
   - **Read-aloud** uses natural Indian voices for Hindi, Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Punjabi, Odia and English (Bulbul).
   - For other languages, the phone or browser's own voice is used where one exists.

Without the key, the mic button is hidden and read-aloud uses the device voice.

## Step 4 — Run the backend on your computer (test first)

```bash
cd krishi-saathi-app/backend
npm install
cp .env.example .env        # on Windows: copy .env.example .env
```

Open `.env` in a text editor and fill in the keys from steps 1–3. Set `ADMIN_TOKEN` to a long random password. Then:

```bash
npm start
```

Open **http://localhost:8080**. You'll see the demo page with the green chat button. Try a question in Tamil or Hindi. Then open **http://localhost:8080/admin** and sign in with your `ADMIN_TOKEN`.

## Step 5 — Put the backend online (Render)

1. Create a **private** GitHub repository and upload the whole `krishi-saathi-app` folder.
   - Don't upload `.env` or `node_modules`. The `.gitignore` files already exclude them.
2. In Render: **New → Blueprint**. Pick your repository; Render reads `render.yaml`.
3. When asked, paste `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and (optionally) `SARVAM_API_KEY`.
   - `ADMIN_TOKEN` is generated for you. Find it under the service's **Environment** tab.
4. Deploy. You'll get an address like `https://krishi-saathi-backend.onrender.com`. Open it to confirm the demo page loads.
5. Before real farmers use it, change `plan: free` to a paid plan in `render.yaml` or in the Render dashboard. A free instance sleeps after inactivity, which makes the first answer slow.

*(Prefer your own server? Any machine with Node.js 20+ works: `npm install && npm start` behind HTTPS, with the same environment variables.)*

## Step 6 — Add the chat to your website

Paste this just before `</body>` on any page (use your Render address):

```html
<script src="https://krishi-saathi-backend.onrender.com/widget.js" defer></script>
```

Optional settings on the same tag:

| Attribute | Example | Effect |
|---|---|---|
| `data-language` | `"ta"` | Default reply language (`auto` = match the farmer) |
| `data-color` | `"#2f6b3f"` | Brand colour |
| `data-position` | `"left"` | Launcher on the left |
| `data-title` | `"Mann Vaasanai"` | Name shown in the header |
| `data-open` | `"true"` | Open the chat automatically |

You can also open the chat from your own button: `onclick="KrishiSaathi.open()"`, or with a ready question: `KrishiSaathi.ask('How do I make Jeevamrutham?')`.

**Security:** once you know your website address, set `ALLOWED_ORIGINS=https://yourwebsite.org` on Render instead of `*`.

The widget works on WordPress, Wix and Webflow. In WordPress, use a "header & footer scripts" plugin, or a Custom HTML block.

## Step 7 — The mobile app

### Try it on your phone (10 minutes)

1. Install **Expo Go** from the Play Store or App Store.
2. On your computer:
   ```bash
   cd krishi-saathi-app/mobile
   npm install
   cp .env.example .env      # set EXPO_PUBLIC_API_URL to your Render address
   npx expo start
   ```
3. Scan the QR code with Expo Go (Android) or the Camera app (iPhone). The app opens on your phone.

### Build an installable Android app (APK) for field teams

1. Choose your app ID. In `mobile/app.json`, replace `org.example.krishisaathi` (in both `android.package` and `ios.bundleIdentifier`) with your organisation's, e.g. `org.yourorg.krishisaathi`.
   > ⚠️ This ID is **permanent** once published on the Play Store.
2. In `mobile/eas.json`, replace the two `EXPO_PUBLIC_API_URL` values with your Render address.
3. Run:
   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest build -p android --profile preview
   ```
4. When the build finishes (about 15–20 minutes), Expo gives you a download link and QR code. Share it with field coordinators to install directly.

### Publish on Google Play

```bash
npx eas-cli@latest build -p android --profile production   # makes an .aab file
npx eas-cli@latest submit -p android                         # uploads to Play Console
```

In Play Console, complete:
- The store listing (in English plus regional languages)
- The privacy policy URL
- The data-safety form: the app sends chat text, photos and voice to your server to answer questions

Start with **Internal testing**, then **Closed testing** with a few farmers, then **Production**.

*iPhone:* the same steps with `-p ios`; it needs an Apple Developer account.

### Replace the icon and splash

Swap the images in `mobile/assets/` (keep the same file names and sizes), then rebuild.

## Step 8 — Fill the knowledge base

Open `https://YOUR-BACKEND/admin` and sign in with `ADMIN_TOKEN`.

- **Replace the six sample entries.** Have your agronomy team check every quantity.
- **Fill in the "trainings" placeholder** with real dates, venues and the official helpline number. Until then, the bot is told not to give any.
- **Add entries in any language.** The bot translates on the fly. Put local-language words in *Keywords* (e.g. ஜீவாமிர்தம், जीवामृत).
- **Import in bulk.** Use **Import CSV** with columns `title, category, content, keywords`.
- **Check Insights weekly.** *"Questions the knowledge base didn't cover"* is your to-do list for new entries. 👎 ratings show answers to review.

Changes reach the bot within about a minute.

---

## Customising

| Want to change… | Where |
|---|---|
| Bot name | `BOT_NAME` in `.env` (and `name` in `mobile/app.json`) |
| How the bot talks (tone, length, safety rules) | `RULES` in `backend/src/prompt.js` |
| Starter questions | `STARTERS` in `backend/public/widget.js` and `mobile/App.js` |
| Colours | `data-color` on the widget; `GREEN` in `mobile/App.js` |
| Claude model | `CLAUDE_MODEL` / `CLAUDE_FAST_MODEL` in `.env` |
| Message rate limits | `chatLimiter` in `backend/src/server.js` (default 20 per minute per IP) |

## Privacy and safety notes

- **No login.** Farmers aren't asked for names or phone numbers. Each phone or browser gets a random ID, and chat history is linked only to that ID.
- **What's stored.** Chat messages, ratings and the optional farm profile are stored in Supabase. Photos and voice recordings are **not** stored: they're passed to Claude or Sarvam to answer, then discarded.
- **Before launch:**
  - Add a short privacy notice to your website and app store listing.
  - Check your obligations under India's Digital Personal Data Protection Act with your data-protection lead.
- **Never share** the service_role key, the Claude key or `ADMIN_TOKEN`. Rotate them if a team member with access leaves.
- **Answers can be wrong.** The bot says so in its footer, and is told to send farmers to the KVK, a vet or a doctor for serious problems. Review 👎 answers regularly.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Missing environment variable …` when starting | Fill in `.env` (local) or the Environment tab (Render) |
| Widget button doesn't appear | Check the script URL opens in a browser; check `ALLOWED_ORIGINS` includes your site |
| "The assistant is busy" | Claude rate limit or no credits; check console.anthropic.com → Usage / Billing |
| Mic button missing | `SARVAM_API_KEY` not set; on websites the page must be served over **https** |
| App shows "Can't reach the server" | `EXPO_PUBLIC_API_URL` is wrong. On a phone, `localhost` won't work, so use the Render address or your computer's LAN IP |
| First answer of the day is slow | Render free instance waking up; move to a paid instance |

## What's next (phase 2+)

- **WhatsApp:** add a `/webhook` route to this backend for the WhatsApp Business API, via a provider (BSP). It reuses the same prompt, database and voice services, and WhatsApp voice notes go through the same `/api/transcribe` logic.
- **Bigger knowledge base:** past ~300 entries, add vector search (Supabase `pgvector`) so only the most relevant entries are sent to Claude.
- **Field-coordinator handoff:** a "talk to a person" button that creates a ticket for your team.
