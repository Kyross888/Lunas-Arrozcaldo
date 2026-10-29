# Google Sign-In Setup Guide

Follow these steps to enable "Continue with Google" on the login and register pages.

## Step 1 — Get your Google OAuth Client ID

1. Go to https://console.cloud.google.com and create (or select) a project.
2. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**.
3. Choose **Web application**.
4. Under **Authorized JavaScript origins** add:
   - `http://localhost:3000` (local testing with `npm run dev`)
   - `https://YOUR-PROJECT.vercel.app` (your live Vercel URL, and any custom domain)
5. Click **Create** and copy the **Client ID** (`xxxxx.apps.googleusercontent.com`).

## Step 2 — Paste the Client ID into the pages

Open `public/login.html` and `public/register.html` and set:

```javascript
const GOOGLE_CLIENT_ID = '123456789-abcdef.apps.googleusercontent.com';
```

No database change is needed — `google_id` and `picture` are simply extra fields on the user document.

## How it works

- The browser gets a Google access token and sends it to `api/google_auth.js`.
- The server **verifies the token with Google** (it does not trust an email typed by the browser), then:
  - Existing email → signs that user in (and links the Google account on first use).
  - New email on the register page → creates the account.
