# Lesson 2: Setting Up the System

## Overview
This lesson walks you through how to set up and run Luna's POS on your local machine or server.

## What You Will Learn
- Requirements needed to run the system
- How to set up the database
- How to configure the environment
- How to run the project

---

## 2.1 Requirements
Before setting up, make sure you have:

- **Node.js** 18 or higher
- A free **MongoDB Atlas** account (the database)
- A free **Vercel** account (hosting) and a GitHub account
- A web browser (Chrome, Firefox, Edge)

## 2.2 Project Structure
```
lunas-pos/
├── api/                  # Serverless API (one file per endpoint)
│   ├── auth.js           # Login, register, logout, profile
│   ├── orders.js         # Place / list / void / restore orders
│   ├── products.js       # Product management
│   ├── customers.js      # Customer records
│   ├── dashboard.js      # Dashboard KPIs and charts
│   ├── salesreport.js    # Sales reports
│   ├── admin.js          # Admin dashboard stats
│   ├── forgot_password.js
│   └── google_auth.js    # Google Sign-In
├── lib/                  # Shared code (database, sessions, branch scope)
├── public/               # The web pages and PWA files
│   ├── login.html, dashboard.html, pos_terminal.html, inventory.html ...
│   ├── js/api.js, js/pwa.js
│   └── manifest.json, sw.js
├── scripts/seed.js       # Creates indexes, branches and the first admin
├── scripts/dev.js        # Local development server
└── vercel.json           # URL rewrites (keeps the familiar *.php addresses working)
```

## 2.3 Database Setup (MongoDB Atlas)
1. Create a free cluster at https://cloud.mongodb.com.
2. Create a database user and allow network access from anywhere (`0.0.0.0/0`) so Vercel can connect.
3. Copy the connection string (Connect -> Drivers).
4. Create the collections' indexes, the 8 branches and the first admin account:
   ```bash
   npm install
   MONGODB_URI="mongodb+srv://..." npm run seed
   ```

## 2.4 Configuration
Settings are environment variables (never commit them). Copy `.env.example` to `.env.local` and fill in:
```
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=lunas_pos
JWT_SECRET=a-long-random-string
```

## 2.5 Running locally
```bash
npm run dev
```
Then open `http://localhost:3000` in your browser.

## 2.6 Deploying to Vercel
1. Push the project to GitHub.
2. In Vercel choose **Add New -> Project**, import the repository and keep the default settings.
3. Add the three environment variables above under **Settings -> Environment Variables**, then deploy.

## 2.7 First Login
- Default admin credentials are set during database setup.
- You can also enable **Google Sign-In** by following the instructions in `GOOGLE_SETUP.md`.

---

## Summary
You now know how to set up the database, configure the connection, and run and deploy Luna's POS with MongoDB Atlas and Vercel.

## Next Lesson
➡️ [Lesson 3: User Authentication and Roles](Lesson_3_Guide.md)
