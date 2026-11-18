import type { Query, Value } from './database.ts';
import { catalogQuery, today } from './library.ts';

export function escape(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const navMarks = ['▦', '▤', '◎', '⇄', '◷', '◇', '▥'];
const links = [['/', 'Overview'], ['/books', 'Catalog'], ['/members', 'Members'], ['/loans', 'Loans'], ['/overdue', 'Overdue'], ['/reservations', 'Reservations'], ['/reports', 'Reports']];

export function layout(path: string, title: string, body: string, csrf = '', message = '', error = false, publicStaff = false, publicMember = false) {
  const browsing = path === '/catalog' || /^\/books\/\d+$/.test(path);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Folio Library</title>
  <link rel="stylesheet" href="/styles.css?v=folio-editorial"></head><body class="${['/login', '/member-login', '/register'].includes(path) ? 'signin' : browsing ? 'public-catalog' : 'workspace'}">
  <header><div class="shell header"><a class="brand" href="/catalog"><i class="brand-mark" aria-hidden="true"></i><span>folio<span class="brand-library">library</span></span></a>
  ${csrf ? `<nav aria-label="Main navigation">${links.map(([href, label], index) =>
    `<a href="${href}" ${path === href ? 'aria-current="page"' : ''}><i aria-hidden="true">${navMarks[index]}</i>${label}</a>`).join('')}</nav>
    <form action="/logout" method="post">${token(csrf)}<button class="quiet">Sign out</button></form>` : `<div class="public-nav"><a href="/catalog" ${browsing ? 'aria-current="page"' : ''}>Browse books</a>
    <a class="button" href="${publicMember || path === '/account' ? '/account' : '/member-login'}">${publicMember || path === '/account' ? 'My library' : 'Member sign in'}</a>
    <a class="button quiet" href="${publicStaff ? '/' : '/login'}">${publicStaff ? 'Staff dashboard' : 'Staff sign in'}</a></div>`}</div></header>
  <main class="shell">${browsing ? '' : `<div class="page-heading"><h1>${escape(title)}</h1>${csrf ? `<span class="staff"><i aria-hidden="true">A</i> Admin</span>` : ''}</div>`}
  ${message ? `<p class="notice ${error ? 'error' : ''}" role="${error ? 'alert' : 'status'}">${escape(message)}</p>` : ''}
  ${body}</main><footer class="shell">Folio Library · Academic project</footer></body></html>`;
}

function token(csrf: string) {
  return `<input type="hidden" name="csrf" value="${escape(csrf)}">`;
}

function input(name: string, label: string, value: unknown = '', options = 'maxlength="150"') {
  return `<label>${label}<input name="${name}" value="${escape(value)}" required ${options}></label>`;
}

function table(headers: string[], rows: string[][], empty: string) {
  if (!rows.length) return `<p class="empty">${empty}</p>`;
  return `<div class="scroll"><table><thead><tr>${headers.map(label =>
    `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
    `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function actionForm(action: string, label: string, id: Value, csrf: string) {
  return `<form method="post" action="${action}">${token(csrf)}
  <input type="hidden" name="id" value="${escape(id)}"><button class="quiet">${label}</button></form>`;
}

export function loginForm(next = '/') {
  return `<section class="panel login"><form method="post" action="/login" class="fields"><input type="hidden" name="next" value="${escape(next)}">
  ${input('username', 'Username', '', 'autocomplete="username" maxlength="150"')}
  ${input('password', 'Password', '', 'type="password" autocomplete="current-password" maxlength="256"')}
  <button>Sign in <span aria-hidden="true">→</span></button></form></section>`;
}

export async function renderPage(db: Query, url: URL, csrf: string) {
  const path = url.pathname;
  if (path === '/') {
    const counts = (await db.get(`SELECT (SELECT COUNT(*) FROM books) AS titles,
      (SELECT COUNT(*) FROM members) AS members,
      (SELECT COUNT(*) FROM loans WHERE returned_on IS NULL) AS active,
      (SELECT COUNT(*) FROM loans WHERE returned_on IS NULL AND due_on < ?) AS overdue`, today()))!;
    const recent = await db.all(`SELECT books.title, members.name, loans.borrowed_on, loans.due_on
      FROM loans JOIN books ON books.id=loans.book_id JOIN members ON members.id=loans.member_id
      ORDER BY loans.id DESC LIMIT 5`);
    return ['Library overview', `<section class="panel desk"><div><h2>Library desk</h2>
    <div class="actions"><a class="button" href="/loans#checkout">Check out a book <span aria-hidden="true">↗</span></a>
    <a class="quiet button" href="/books#editor">Add a title</a></div></div>
    <div class="shelf" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></section>
    <div class="metrics">${[
      ['/books', 'Catalog titles', counts.titles], ['/members', 'Members', counts.members],
      ['/loans', 'Open loans', counts.active], ['/overdue', 'Overdue loans', counts.overdue],
    ].map(([href, label, count], index) => `<a class="panel metric" href="${href}"><span class="metric-mark" aria-hidden="true">${['▤', '◎', '⇄', '◷'][index]}</span><span>${label}</span><strong>${escape(count)}</strong><span class="metric-arrow" aria-hidden="true">↗</span></a>`).join('')}</div>
    <section class="panel"><div class="section-heading"><h2>Recent checkouts</h2><a href="/loans">View all loans →</a></div>${table(['Book', 'Member', 'Checked out', 'Due'], recent.map(row => [row.title, row.name, row.borrowed_on, row.due_on].map(escape)), 'No checkouts recorded yet.')}</section>`];
  }

  if (path === '/books' || path === '/members') {
    const isBook = path === '/books';
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 150);
    const id = Number(url.searchParams.get('edit'));
    const editing = Number.isSafeInteger(id) && id > 0
      ? (await db.get(isBook ? 'SELECT * FROM books WHERE id=?' : 'SELECT * FROM members WHERE id=?', id))
      : undefined;
    const rows = isBook
      ? (await db.all(catalogQuery + ' WHERE instr(lower(title || char(10) || author || char(10) || category), lower(?)) > 0 ORDER BY title COLLATE NOCASE, id', q))
      : (await db.all('SELECT * FROM members WHERE instr(lower(name || char(10) || email), lower(?)) > 0 ORDER BY name COLLATE NOCASE, id', q));
    const noun = isBook ? 'book' : 'member';
    const fields = isBook
      ? input('title', 'Title', editing?.title) + input('author', 'Author', editing?.author) +
        input('category', 'Category', editing?.category) +
        input('copies', 'Total copies', editing?.copies ?? 1, 'type="number" min="1" max="999"')
      : input('name', 'Name', editing?.name) + input('email', 'Email', editing?.email, 'type="email" maxlength="150"');

    return [isBook ? 'Book catalog' : 'Members', `<section class="panel" id="editor"><h2>${editing ? 'Edit' : 'Add'} ${noun}</h2>
    <form class="fields" action="${path}/save" method="post">${token(csrf)}
    ${editing ? `<input type="hidden" name="id" value="${id}">` : ''}${fields}
    <div class="actions"><button>${editing ? 'Save changes' : `Add ${noun}`}</button>
    ${editing ? `<a href="${path}">Cancel</a>` : ''}</div></form></section>
    <section class="panel"><form class="search" action="${path}" method="get"><label>Search ${isBook ? 'catalog' : 'members'}
    <input name="q" type="search" maxlength="150" value="${escape(q)}" placeholder="${isBook ? 'Title, author or category' : 'Name or email'}"></label>
    <button>Search</button>${q ? `<a href="${path}">Clear</a>` : ''}</form>
    ${table(isBook ? ['Title', 'Author', 'Category', 'Available', 'Actions'] : ['Name', 'Email', 'Actions'], rows.map(row => [
      ...(isBook ? [row.title, row.author, row.category, `${row.available} / ${row.copies}`] : [row.name, row.email]).map(escape),
      `<div class="actions"><a href="${path}?edit=${row.id}#editor">Edit</a>${actionForm(path + '/delete', 'Delete', row.id, csrf)}</div>`,
    ]), q ? 'No matching records.' : `No ${noun}s yet.`)}</section>`];
  }

  if (path === '/loans' || path === '/overdue') {
    const date = today();
    const overdue = path === '/overdue';
    const filter = url.searchParams.get('status') ?? 'all';
    const filterSql = filter === 'open' ? 'WHERE returned_on IS NULL'
      : filter === 'returned' ? 'WHERE returned_on IS NOT NULL' : '';
    const records = (await db.all(`SELECT loans.*, books.title, members.name FROM loans
      JOIN books ON books.id = loans.book_id JOIN members ON members.id = loans.member_id
      ${overdue ? 'WHERE returned_on IS NULL AND due_on < ?' : filterSql}
      ORDER BY returned_on IS NOT NULL, due_on, loans.id DESC`, ...(overdue ? [date] : [])));
    let checkout = '';
    if (!overdue) {
      const books = (await db.all(`SELECT * FROM (${catalogQuery}) WHERE available > 0 ORDER BY title COLLATE NOCASE`));
      const members = (await db.all('SELECT * FROM members ORDER BY name COLLATE NOCASE'));
      const due = new Date(date + 'T00:00:00Z');
      due.setUTCDate(due.getUTCDate() + 14);
      checkout = `<section class="panel" id="checkout"><h2>Check out a book</h2>
      ${books.length && members.length ? `<form method="post" action="/loans/checkout" class="fields">${token(csrf)}
      <label>Book<select name="book_id" required><option value="">Select a book</option>${books.map(book =>
        `<option value="${book.id}" ${String(book.id) === url.searchParams.get('book') ? 'selected' : ''}>${escape(book.title)} · ${escape(book.author)} (${book.available} available)</option>`).join('')}</select></label>
      <label>Member<select name="member_id" required><option value="">Select a member</option>${members.map(member =>
        `<option value="${member.id}">${escape(member.name)} · ${escape(member.email)}</option>`).join('')}</select></label>
      ${input('due_on', 'Due date', due.toISOString().slice(0, 10), `type="date" min="${date}" max="9999-12-31"`)}
      <div class="actions"><button>Check out</button></div></form>` :
      '<p>Checkout requires a book with an available copy and a member.</p><div class="actions"><a href="/books">Open catalog</a><a href="/members">Open members</a></div>'}</section>`;
    }
    return [overdue ? 'Overdue loans' : 'Loans', checkout + `<section class="panel">${overdue ? '' : `<div class="actions filters">
      ${[['all', 'All loans'], ['open', 'Open'], ['returned', 'Returned']].map(([key, label]) =>
        `<a class="button ${filter === key ? '' : 'quiet'}" href="/loans?status=${key}">${label}</a>`).join('')}</div>`}${table(
      ['Book', 'Member', 'Checked out', 'Due', 'Status', 'Actions'], records.map(row => {
        const late = !row.returned_on && String(row.due_on) < date;
        const status = row.returned_on ? `Returned ${escape(row.returned_on)}` : late ? 'Overdue' : 'On loan';
        return [...[row.title, row.name, row.borrowed_on, row.due_on].map(escape),
          `<span class="pill ${late ? 'late' : ''}">${status}</span>`,
          row.returned_on ? '—' : `<div class="actions">${actionForm('/loans/return', 'Return', row.id, csrf)}
          ${actionForm('/loans/renew', 'Renew', row.id, csrf)}</div>`];
      }), overdue ? 'There are no overdue loans.' : 'No loans recorded yet.')}</section>`];
  }

  if (path === '/reservations') {
    const books = await db.all('SELECT id,title,author FROM books ORDER BY title');
    const members = await db.all('SELECT id,name,email FROM members ORDER BY name');
    const reservations = await db.all(`SELECT r.id, b.title, m.name, r.created_on FROM reservations r
      JOIN books b ON b.id=r.book_id JOIN members m ON m.id=r.member_id ORDER BY r.id`);
    return ['Reservations', `<section class="panel"><h2>Reserve a title</h2>
    ${books.length && members.length ? `<form class="fields" method="post" action="/reservations/add">${token(csrf)}
    <label>Book<select name="book_id" required><option value="">Choose a title</option>${books.map(row =>
      `<option value="${row.id}" ${String(row.id) === url.searchParams.get('book') ? 'selected' : ''}>${escape(row.title)} · ${escape(row.author)}</option>`).join('')}</select></label>
    <label>Member<select name="member_id" required><option value="">Choose a member</option>${members.map(row =>
      `<option value="${row.id}">${escape(row.name)} · ${escape(row.email)}</option>`).join('')}</select></label>
    <button>Add reservation</button></form>` : '<p>Add a book and a member to create a reservation.</p>'}
    </section><section class="panel"><h2>Waiting list</h2>${table(['Book', 'Member', 'Added', 'Actions'],
      reservations.map(row => [escape(row.title), escape(row.name), escape(row.created_on),
        actionForm('/reservations/cancel', 'Cancel', row.id, csrf)]), 'The waiting list is empty.')}</section>`];
  }

  if (path === '/reports') {
    const popular = await db.all(`SELECT books.title, books.author, COUNT(loans.id) AS total
      FROM books JOIN loans ON loans.book_id=books.id GROUP BY books.id ORDER BY total DESC, books.title LIMIT 10`);
    const inventory = await db.all(`SELECT category, COUNT(*) AS titles, SUM(copies) AS copies, SUM(available) AS available
      FROM (${catalogQuery}) GROUP BY category ORDER BY category`);
    return ['Library reports', `<div class="report-grid">
    <section class="panel"><h2>Most borrowed titles</h2>${table(['Title', 'Author', 'Checkouts'],
      popular.map(row => [row.title, row.author, row.total].map(escape)), 'No checkouts recorded yet.')}</section>
    <section class="panel"><h2>Inventory by category</h2>${table(['Category', 'Titles', 'Copies', 'Available'],
      inventory.map(row => [row.category, row.titles, row.copies, row.available].map(escape)), 'No titles in the catalog yet.')}</section></div>
    <a class="button" href="/reports/loans.csv">Download loan history CSV</a>`];
  }

  return null;
}
