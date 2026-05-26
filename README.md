# MISC Club — Concept Site

A concept rebuild of [misc.org.au](https://www.misc.org.au) on the same Node/Express/SQLite stack as MISC-OPEN.

**Live (when DNS propagates):** https://miscclub.jgrogan.com

## What's here

- **Public site** — content imported from misc.org.au, rendered from a DB-backed `pages` table so admins can edit in-place
- **4 member-facing forms:**
  - General contact / enquiry
  - New member application
  - Range booking request
  - Event RSVP / training signup
- **Admin backend** — dashboard, page editor, news editor, form submission viewer, settings

## Tech stack

- Node.js 20 / Express 4
- SQLite via better-sqlite3
- Nodemailer (Microsoft 365 SMTP) — shared `miscevents@misc.org.au` mailbox with MISC-OPEN

## Local development

```bash
npm install
SWPM_USER='...' SWPM_PASS='...' node scripts/scrape-misc.js   # crawl content from misc.org.au
node scripts/import-content.js                                 # load it into the DB
npm start                                                      # http://localhost:3100
```

Visit:
- Public: http://localhost:3100/
- Admin:  http://localhost:3100/admin/login  (default password: `misc-club-2026` — change in admin/settings)

## Project structure

```
MISC-CLUB/
├── server/             Express app
│   ├── server.js       entrypoint
│   ├── db.js           schema + seeded settings
│   ├── api.js          public form pages + submissions
│   └── admin.js        admin UI + auth
├── public/             static assets + landing page
├── scripts/
│   ├── scrape-misc.js  one-off crawler for misc.org.au
│   └── import-content.js  load scraped JSON into DB
├── content-import/     (gitignored) raw crawl output
└── data/               (gitignored) SQLite DB
```

## Deployment

Runs on the same OCI host as MISC-OPEN (207.211.157.18) as a second Nginx vhost
serving `miscclub.jgrogan.com`. Different port (3100), different DB, fully isolated.
