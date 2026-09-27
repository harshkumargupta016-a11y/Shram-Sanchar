# Shram Sanchar

**A phone-friendly website that helps migrant workers keep their eShram record up to date, just by speaking, even with no internet, and only when they allow it.**

Built for **IBM Bob 2.0 (2026)** · Track: *Migrant Worker Tracking in eShram*

**Live demo: https://shram-sanchar.vercel.app/**

---

## 1. The idea in 30 seconds

Migrant workers move from city to city for work. Their eShram record does not move with them, so it becomes old very quickly.

Most "tracking" ideas follow a worker's location all day. That scares people, drains the battery, and needs a good network.

**Shram Sanchar does the opposite:**

| Problem | What Shram Sanchar does |
|---|---|
| Worker moves often | Worker gives a quick update: "I am going to Surat for construction work" |
| Poor or no network | The update is saved on the phone and sent later, when the network is back |
| Hard forms, many languages | Worker **speaks** in their own language. No long forms |
| Fear of being watched | Location is **off by default**. It is read only when the worker switches it on, and only once per check-in |

There is no live tracking and no route history. Only the check-ins that the worker confirms are saved.

---

## 2. Who uses it

| Person | What they do here |
|---|---|
| **Worker (citizen)** | Logs in, makes check-ins, files complaints, chats with the assistant |
| **Labour officer (admin)** | Sees where workers are, sees complaints sorted by urgency, updates their status |

---

## 3. How to use it

### Option A: open the live site (easiest)

Go to **https://shram-sanchar.vercel.app/** on your phone or laptop. Nothing to install.

The site uses **HTTPS**, so the microphone, camera and location work straight away. Use **Chrome or Edge** for voice input.

### Option B: run it on your own computer

You only need the file `shram-sanchar.html` and a browser.

1. Put `shram-sanchar.html` in a folder.
2. Open a terminal in that folder and run:
   ```
   python -m http.server 8000
   ```
   (or `npx serve`)
3. Open **http://localhost:8000/shram-sanchar.html**

> **Why not just double-click the file?**
> The microphone, camera and location only work on a "secure" address. `localhost` and `https://` count as secure. A file opened by double-click does not.

### Option C: put your own copy online (Vercel)

1. Rename `shram-sanchar.html` to `index.html`.
2. Put it in a folder (or a GitHub repo) on its own.
3. Import that folder or repo into Vercel and click **Deploy**. No build settings are needed, because this is a plain static site.
4. Vercel gives you an `https://...vercel.app` link. Open it and test.

You need internet for the map tiles, fonts and the Gemini AI. The check-in flow itself still works offline once the page has loaded.

### Demo logins

| Role | How to log in |
|---|---|
| **Citizen** | Any name, any 12-digit number as UAN, any mobile number starting with 6 to 9, OTP = `123456` |
| **Officer (admin)** | ID: `admin` · Password: `admin123` |

### Turn on the AI (Gemini)

1. Get a key from Google AI Studio.
2. Click **AI settings** in the top bar and paste the key.
3. Click **Test key**, then **Save**.

The key is stored only in your browser. **Never paste a real key into the code and push it to GitHub.** Google will disable it.

If you skip this step, the app still works. It uses simple built-in rules instead of Gemini.

> **Important for the live site:** the key is saved only in *your own* browser. Other people who open the link will **not** have it, so they see the built-in rules instead of Gemini. Before you present, open the site on your own device and paste your key in **AI settings**. Each device needs it once.
>
> The permanent fix is a small server function that keeps the key secret on Vercel. It is listed in "Ideas for the next version".

---

## 4. The whole workflow, step by step

### A. Worker check-in (the main flow)

```
 Log in
   │
   ▼
 (Optional) Turn ON "Location check-in" for this trip
   │
   ▼
 Tap the mic and speak    ──►  or type your update
   │
   ▼
 App understands: Destination · Work type · Status
   │
   ▼
 Worker checks it, fixes mistakes, (optional) adds a photo
   │
   ▼
 Worker taps "Confirm check-in"
   │
   ├── Network available ──►  Sent right away  ──► shows "Synced" (green)
   │
   └── No network ──►  Saved on the phone ──► shows "Queued" (orange)
                                              │
                                              ▼
                                  Network comes back → sent automatically
```

**In simple words:**

1. **Log in** with name, UAN and OTP.
2. **Location switch (optional).** It starts OFF. If you turn it ON, the app reads your location **one time** when you confirm a check-in. The location is rounded to about 1 km, so nobody can follow you street by street.
3. **Speak.** Choose your language (10 are available), tap the big mic and talk. Example: *"मैं सूरत जा रहा हूँ, निर्माण काम के लिए"*. You can also type.
4. **The app reads your sentence** and picks out:
   - **Destination** (e.g. Surat)
   - **Work type** (e.g. Construction)
   - **Status** (Traveling, Arrived, Returning home, or Seeking work)

   It uses Gemini if available. Otherwise it uses a built-in list of cities and words.
5. **You check it.** Everything is editable. Wrong city? Fix it before saving.
6. **Add a photo** (optional), for example of the work site. Use the camera or upload one.
7. **Confirm.** Only now is anything saved.
8. **Offline or online?**
   - **Online:** the check-in goes to the "server" straight away and turns green.
   - **Offline:** it waits on the phone (orange). The moment the network returns, the app sends it by itself and shows a message.
9. **See your journey** on the map. Green dots are synced, orange dots are still waiting. The history list is below the map.
10. **Delete anytime.** The "Delete my check-ins" button removes all your check-ins.

> **Demo tip:** turn on **"Simulate no network"** at the top of the worker page. Make a check-in (it turns orange). Turn the switch off and watch it sync.

### B. Complaint desk

```
 Worker fills the form  ──►  Gemini checks urgency  ──►  Ticket number given
                                                              │
                                                              ▼
                                             Officer sees it, sorted by priority
                                                              │
                                                              ▼
                                       Officer changes status: Open → In review → Resolved
```

1. The worker picks a category (unpaid wages, unsafe work, harassment, food or housing, card problem, other).
2. They describe what happened in any language and can add a photo.
3. On submit, **Gemini decides the priority**:
   - **Critical**: danger to life or safety, violence, being locked in, serious injury
   - **High**: unpaid wages, harassment, unsafe site, no food or shelter
   - **Medium**: eShram or UAN card problems
   - **Low**: general questions
4. The worker gets a **ticket number** (like `SS-2026-4821`), the priority, and who will handle it. If it is Critical, the app reminds them to call **112**.
5. The worker can watch the status of their complaints on the same page.

If Gemini is not available, a built-in keyword check gives the priority instead. The complaint always shows who set the priority ("Gemini" or "On-device rules").

### C. Admin dashboard

The officer logs in and sees:

- **Numbers at the top:** workers with a check-in, synced check-ins, open complaints, critical complaints that are not resolved.
- **Overview tab:** a map with each worker's **latest** confirmed check-in (color shows their status), plus charts of top destinations and work types.
- **Complaints tab:** all complaints, most urgent first. The officer can filter by priority, read the suggested next step, change the status, or press **Re-check priority** to ask Gemini again.
- **Check-ins tab:** a table of all check-ins with a "Queued" or "Synced" label. There is an **Export CSV** button at the top.

The first time you open the app, it fills in some **fictional demo workers and complaints** so the admin page is not empty.

### D. Chat assistant

The round chat button (bottom right) opens **Shram Sahayak**. Ask about UAN, unpaid wages, how privacy works, or how to file a complaint, in any language. It replies in your language. Without internet or a key, it gives a few saved answers and points to the helpline **14434**.

### E. Footer

The bottom of every page lists government **helplines** and **official links** (eShram, Labour Ministry, Bhashini, UIDAI, EPFO, ESIC, and more). Please double-check numbers and links on the official sites before you present.

---

## 5. Where is the data kept?

Everything stays **inside your browser** in this prototype. There is no real server.

| What | Where |
|---|---|
| Waiting check-ins ("queue") | Browser database (IndexedDB) |
| Synced check-ins (our pretend eShram server) | Browser database (IndexedDB) |
| Complaints | Browser database (IndexedDB) |
| Login, language, location switch, AI key | Browser storage (localStorage) |

To start fresh: **AI settings → Reset demo data**.

---

## 6. What is real and what is pretend

| Part | In this prototype | In the real product |
|---|---|---|
| Voice to text | Browser speech recognition (Chrome or Edge) | **Bhashini** (22 languages) |
| Sending to eShram | Browser database plays the "server" | **Node.js + Express** backend that removes duplicates and calls the **eShram data-sharing API** |
| Login | Fake OTP `123456` | **Aadhaar eKYC + UAN** |
| Understanding the sentence | Gemini, or built-in rules | Same |
| Complaint priority | Gemini, or built-in rules | Same, with officer review |
| Map | Leaflet + OpenStreetMap (real) | Same |
| Camera, mic, location | Real browser features | Same |

---

## 7. What it is built with

- **HTML, CSS, JavaScript**: one single file
- **React 18**: the screens (loaded from a CDN)
- **Leaflet.js + OpenStreetMap**: maps
- **Web Speech API**: voice input and a spoken "saved" message
- **Camera (getUserMedia)** and **Geolocation API**
- **IndexedDB**: offline storage
- **Gemini API**: chat, understanding speech text, complaint priority
- **Nominatim (OpenStreetMap)**: finds places that are not in the built-in city list

---

## 8. Privacy promises (and how the app keeps them)

1. **Off by default.** Location is never read until the worker turns the switch on.
2. **Only when asked.** It is read once, at the moment of confirming a check-in, never in the background.
3. **Rounded.** Saved to about 1 km, not an exact spot.
4. **Worker confirms everything.** Nothing is saved until "Confirm check-in".
5. **Delete anytime.** One button removes all the worker's check-ins.
6. **Plain language notice** in English and Hindi, in line with the DPDP Act, 2023.

---

## 9. If something does not work

| Problem | Fix |
|---|---|
| Mic button says voice is not supported | Use Chrome or Edge, or just type your update |
| "Microphone blocked" | Click the lock icon in the address bar and allow the microphone |
| Camera does not open | Use the live `https://` link or `localhost` (see section 3), allow the camera, or use **Upload** |
| Map is blank | Check your internet connection (map tiles are downloaded) |
| Gemini answers fail, or the live site looks less smart | Open **AI settings** on that device, paste the key, press **Test key**. Check the internet |
| Location not saved | Allow location in the browser. The app saves the check-in without it if it is denied |
| Page shows old data | **AI settings → Reset demo data** |

---

## 10. Ideas for the next version

- A Vercel serverless function (`/api/gemini`) that holds the Gemini key in an environment variable, so every visitor gets Gemini and the key never appears in the page
- Real Node.js + Express backend and the live eShram data-sharing API
- Bhashini for voice in all 22 languages
- Aadhaar eKYC login
- A full Hindi (and other languages) screen text
- Automatic check-in suggestion when the phone detects a very large location change (still opt-in)
- SMS or WhatsApp updates for complaint status

---

*Shram Sanchar is a hackathon prototype. It is not an official Government of India service. All admin-page demo data is fictional.*
