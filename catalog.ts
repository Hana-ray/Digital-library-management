import { catalogQuery } from './library.ts';
import type { Query, Row } from './database.ts';
import { escape } from './views.ts';

function cover(book: Row) {
  return `<div class="book-cover cover-${Number(book.id) % 4}" aria-hidden="true">
    <span>${escape(book.category)}</span><strong>${escape(book.title)}</strong>
    <small>${escape(book.author)}</small></div>`;
}

export async function publicCatalog(db: Query, url: URL, signedIn: boolean, memberCsrf = '') {
  const detail = url.pathname.match(/^\/books\/([1-9]\d*)$/);
  if (detail) {
    const id = Number(detail[1]);
    const book = Number.isSafeInteger(id) ? await db.get(catalogQuery + ' WHERE books.id=?', id) : undefined;
    if (!book) return { title: 'Book not found', status: 404, body: '<p><a href="/catalog">Back to catalog</a></p>' };
    const label = Number(book.available) > 0 ? 'Available' : 'All copies on loan';
    const destination = Number(book.available) > 0 ? '/loans' : '/reservations';
    const action = Number(book.available) > 0 ? 'Check out this book' : 'Reserve this book';
    const target = destination + '?book=' + id;
    return { title: String(book.title), status: 200, body: `<a class="catalog-back" href="/catalog">← Back to catalog</a>
      <article class="panel book-detail">${cover(book)}<div><span class="category">${escape(book.category)}</span>
      <h1>${escape(book.title)}</h1><p class="book-author">By ${escape(book.author)}</p>
      <p><span class="pill ${Number(book.available) ? '' : 'late'}">${label}</span></p>
      <p>${escape(book.available)} of ${escape(book.copies)} copies available</p>
      ${memberCsrf ? `<form method="post" action="/account/reserve">
        <input type="hidden" name="csrf" value="${escape(memberCsrf)}">
        <input type="hidden" name="book_id" value="${id}"><button>Reserve this book</button></form>`
        : signedIn ? `<a class="button" href="${target}">${action}</a>`
        : `<a class="button" href="/member-login?next=${encodeURIComponent('/books/' + id)}">Sign in to reserve</a>`}
      </div></article>` };
  }

  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 150);
  const category = (url.searchParams.get('category') ?? '').trim().slice(0, 150);
  const available = url.searchParams.get('available') === '1';
  const categories = await db.all('SELECT DISTINCT category FROM books ORDER BY category COLLATE NOCASE');
  const books = await db.all(`SELECT * FROM (${catalogQuery}) WHERE
    instr(lower(title || char(10) || author || char(10) || category), lower(?)) > 0
    AND (? = '' OR category = ?) AND (? = 0 OR available > 0)
    ORDER BY title COLLATE NOCASE, id`, q, category, category, Number(available));
  return { title: 'Browse books', status: 200, body: `<section class="catalog-hero"><div>
    <h1>Find your<br><em>next read.</em></h1><p>Browse the collection, check availability, and reserve a book to pick up at the library.</p>
    <a class="button" href="#catalog-search">Explore the collection <span aria-hidden="true">↓</span></a></div>
    <div class="hero-art" aria-hidden="true"><div class="hero-ring"></div><div class="art-book art-book-back"></div>
    <div class="art-book art-book-front"><i></i><i></i><i></i></div></div></section>
    <form id="catalog-search" class="panel catalog-filters" action="/catalog" method="get">
      <label>Search books<input type="search" name="q" placeholder="Title, author, or category" maxlength="150" value="${escape(q)}"></label>
      <label>Category<select name="category"><option value="">All categories</option>${categories.map(row =>
        `<option ${row.category === category ? 'selected' : ''}>${escape(row.category)}</option>`).join('')}</select></label>
      <label class="checkbox"><input type="checkbox" name="available" value="1" ${available ? 'checked' : ''}>Available only</label>
      <button>Search</button></form>
    <div class="section-heading collection-heading"><h2>The collection <span>${books.length} ${books.length === 1 ? 'title' : 'titles'}</span></h2>
    ${q || category || available ? '<a href="/catalog">Clear filters</a>' : ''}</div>
    <div class="book-grid">${books.map(book => `<article class="panel book-card"><a href="/books/${book.id}">
      ${cover(book)}<div class="book-card-info"><h3>${escape(book.title)}</h3><p>${escape(book.author)}</p>
      <span class="pill ${Number(book.available) ? '' : 'late'}">${Number(book.available) ? escape(book.available) + ' available' : 'On loan'}</span>
      </div></a></article>`).join('')}</div>
    ${books.length ? '' : (q || category || available ? '<p class="empty">No titles match these filters.</p>' : '<p class="empty">New titles will appear here as the library adds them.</p>')}` };
}
