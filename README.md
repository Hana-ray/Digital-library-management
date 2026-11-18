# Digital Library Management System

Folio Library is a local academic demo built with TypeScript, Node.js and SQLite. It tracks a library catalog, member records, and loans for physical copies.

# Live Demo
View Folio Library

## Start on your Mac

Requires Node.js 24 or newer. Local mode uses Node’s built-in SQLite. Netlify installs the Turso client from the lockfile.

```sh
npm run dev
```

Open http://127.0.0.1:3000 and sign in as `admin`. On first launch the app generates a password. Run `cat data/admin-password.txt` in a separate Terminal tab to read it. You can also supply `LIBRARY_ADMIN_PASSWORD` in the environment when starting the server.

Use `npm start` to run without watch mode. Set `PORT=3001` before the start command if port 3000 is busy.

## Demo walkthrough

1. Open **Catalog** and add a book with one copy. Use search to find it by title, author, or category.
2. Open **Members** and add a member with a unique email.
3. Open **Loans**, select the book and member, and check it out. The catalog will show zero available copies.
4. Return the book from the Loans page. The copy becomes available again and the loan remains in history.
5. Open **Overdue** to see open loans whose due date has passed. Dates use the Asia/Yangon time zone.

Books and members can be edited or deleted. Records linked to loan history are kept so previous transactions remain readable.

SQLite stores data in `data/library.sqlite`. The schema is in `src/schema.sql`. The server listens on the local machine, and library records and active login sessions are stored in SQLite.

## Additional workflows

- **Reservations** creates a waiting list for each title. Checkout honors the first reservation and removes it when fulfilled.
- **Loans** filters open and returned records. Renew adds 14 days from the later of today or the original due date. A reservation blocks renewal.
- **Reports** shows borrowing totals and inventory by category. Staff can download a loan history CSV.
- **Overview** shows recent checkouts and links to each count.

## Deploy to Netlify

The included Netlify Function serves the same TypeScript app. Turso provides hosted SQLite-compatible storage, including server-side sign-in sessions. The static stylesheet is served from `public`.

1. Create a Turso libSQL database. From the project directory, apply the schema with `turso db shell YOUR_DB < src/schema.sql`.
2. Import this project from Git in Netlify. Set the base directory to this project folder if the repository contains other projects. Netlify reads the publish and function settings from `netlify.toml`.
3. Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `LIBRARY_ADMIN_PASSWORD` as Netlify environment variables available to Functions. Use a strong password of at least 12 characters.
4. Deploy, visit the HTTPS URL and sign in as `admin`. Verify `/health`, then add a sample book and member and check out the book.

The cloud database starts empty. Use sample records for the portfolio demo. Keep your local `data/` directory and environment files out of Git.

## Public catalog

Visitors can browse `/catalog`, search by title or author, filter by category and availability, and open individual book pages. Members can sign in from a book page to reserve it. Staff can manage checkout, member records, reports, and catalog editing.

## Member accounts

Visitors can create an account under **Member sign in**. Members can reserve books, cancel their own reservations, and check their own loan history. Staff check out and return copies. Existing staff-created member records are not claimed through public registration.

For an existing Turso deployment, reapply the updated `src/schema.sql` to create the member account and session tables before deploying.
