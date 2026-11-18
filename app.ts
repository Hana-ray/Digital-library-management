import { registerMember, verifyMember, memberForm, memberPage } from './accounts.ts';
import { publicCatalog } from './catalog.ts';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { LibraryDatabase } from './database.ts';
import { changeLibrary, FormError } from './library.ts';
import { layout, loginForm, renderPage } from './views.ts';

const actions = new Set([
  '/books/save', '/books/delete', '/members/save', '/members/delete',
  '/loans/checkout', '/loans/return', '/loans/renew',
  '/reservations/add', '/reservations/cancel',
]);
const maxAge = 8 * 60 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest();

async function readForm(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    throw new FormError('Submit the form from the library page.');
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) {
          await reader.cancel();
          throw new FormError('The form exceeds the size limit.');
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  }
  return new URLSearchParams(text + decoder.decode());
}

export function libraryHandler(db: LibraryDatabase, password: string, secure = false) {
  const passwordHash = digest(password);
  return async (request: Request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const respond = (body: string | null, status: number, headers: HeadersInit = {}) =>
      new Response(body, { status, headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'Content-Type': 'text/html; charset=utf-8',
        ...headers,
      } });
    const redirect = (location: string, cookie?: string) => respond(null, 303, {
      Location: location, ...(cookie ? { 'Set-Cookie': cookie } : {}),
    });
    const cookie = (value: string, age: number) =>
      `folio_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
    const destination = (value: string | null) =>
      value && /^\/(?:loans|reservations)\?book=[1-9]\d{0,15}$/.test(value) ? value : '/';
    const login = (message = '', status = 200, next = destination(url.searchParams.get('next'))) =>
      respond(layout('/login', 'Staff sign in', loginForm(next), '', message, Boolean(message)), status);

    try {
      if (method === 'GET' && path === '/health') {
        await db.get('SELECT 1');
        return respond(JSON.stringify({ project: 'Digital Library Management System', status: 'ok' }), 200,
          { 'Content-Type': 'application/json' });
      }
      if (method === 'POST' && request.headers.get('origin') !== url.origin) return respond('Invalid form origin.', 403);

      const token = request.headers.get('cookie')?.match(/(?:^|;\s*)folio_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const id = token ? digest(token).toString('hex') : '';
      const session = id ? await db.get('SELECT csrf FROM sessions WHERE id=? AND expires>?', id, Date.now()) : undefined;
      const memberToken = request.headers.get('cookie')?.match(/(?:^|;\s*)folio_member=([a-f0-9]{64})(?:;|$)/)?.[1];
      const memberKey = memberToken ? digest(memberToken).toString('hex') : '';
      const memberSession = memberKey
        ? await db.get('SELECT member_id,csrf FROM member_sessions WHERE id=? AND expires>?', memberKey, Date.now())
        : undefined;
      const memberId = Number(memberSession?.member_id);
      const memberCookie = (value: string, age: number) => cookie(value, age).replace('folio_session=', 'folio_member=');
      const memberDestination = (value: string | null) =>
        value && /^\/books\/[1-9]\d{0,15}$/.test(value) ? value : '/account';

      if (path === '/member-login' || path === '/register') {
        const registering = path === '/register';
        let next = memberDestination(url.searchParams.get('next'));
        const screen = (message = '', status = 200) => respond(layout(path,
          registering ? 'Create a member account' : 'Member sign in', memberForm(registering, next), '', message, Boolean(message)), status);
        if (memberSession) return redirect(next);
        if (method === 'GET') return screen();
        if (method === 'POST') {
          try {
            const form = await readForm(request);
            next = memberDestination(form.get('next'));
            if (registering) {
              await registerMember(db, form);
              return redirect('/member-login?next=' + encodeURIComponent(next));
            }
            const member = await verifyMember(db, form.get('email') ?? '', form.get('password') ?? '');
            if (!member) return screen('Incorrect email or password.', 401);
            const key = randomBytes(32).toString('hex');
            await db.write(async tx => {
              await tx.run('DELETE FROM member_sessions WHERE expires<=?', Date.now());
              await tx.run('INSERT INTO member_sessions VALUES (?,?,?,?)', digest(key).toString('hex'),
                member, randomBytes(32).toString('hex'), Date.now() + maxAge * 1000);
            });
            return redirect(next, memberCookie(key, maxAge));
          } catch (error) {
            if (error instanceof FormError) return screen(error.message, 400);
            throw error;
          }
        }
      }

      if (path === '/account' || path.startsWith('/account/')) {
        if (!memberSession) return redirect('/member-login');
        const csrf = String(memberSession.csrf);
        const screen = async (message = '', status = 200) =>
          respond(layout('/account', 'My library', await memberPage(db, memberId, csrf), '', message, status >= 400), status);
        if (method === 'GET' && path === '/account') return screen(url.searchParams.has('saved') ? 'Reservation updated.' : '');
        if (method === 'POST') {
          try {
            const form = await readForm(request);
            if (form.get('csrf') !== csrf) return respond('Reload the page and try again.', 403);
            if (path === '/account/logout') {
              await db.write(tx => tx.run('DELETE FROM member_sessions WHERE id=?', memberKey));
              return redirect('/catalog', memberCookie('', 0));
            }
            if (path === '/account/reserve') {
              await changeLibrary(db, '/reservations/add', new URLSearchParams({
                book_id: form.get('book_id') ?? '', member_id: String(memberId),
              }));
              return redirect('/account?saved=1');
            }
            if (path === '/account/cancel') {
              const id = Number(form.get('id'));
              if (!Number.isSafeInteger(id) || id < 1) throw new FormError('Invalid reservation.');
              const result = await db.write(tx => tx.run('DELETE FROM reservations WHERE id=? AND member_id=?', id, memberId));
              if (!result.changes) return screen('Reservation not found.', 404);
              return redirect('/account?saved=1');
            }
          } catch (error) {
            if (error instanceof FormError) return screen(error.message, 400);
            throw error;
          }
        }
        return respond('Page not found.', 404);
      }

      if (method === 'GET' && (path === '/catalog' || path.startsWith('/books/') && /^\/books\/\d+$/.test(path))) {
        const page = await publicCatalog(db, url, Boolean(session), String(memberSession?.csrf ?? ''));
        return respond(layout(path, page.title, page.body, '', '', false, Boolean(session), Boolean(memberSession)), page.status);
      }
      if (method === 'GET' && path === '/' && !session) return redirect('/catalog');
      if (path === '/login') {
        if (method === 'GET') return session ? redirect(destination(url.searchParams.get('next'))) : login();
        if (method === 'POST') {
          const form = await readForm(request);
          if (form.get('username') !== 'admin' || !timingSafeEqual(digest(form.get('password') ?? ''), passwordHash)) {
            return login('Incorrect username or password.', 401, destination(form.get('next')));
          }
          const key = randomBytes(32).toString('hex');
          await db.write(async tx => {
            await tx.run('DELETE FROM sessions WHERE expires<=? OR id=?', Date.now(), id);
            await tx.run('INSERT INTO sessions VALUES (?, ?, ?)', digest(key).toString('hex'),
              randomBytes(32).toString('hex'), Date.now() + maxAge * 1000);
          });
          return redirect(destination(form.get('next')), cookie(key, maxAge));
        }
      }
      if (!session) return redirect('/login');
      const csrf = String(session.csrf);

      if (method === 'GET' && path === '/reports/loans.csv') {
        const rows = await db.all(`SELECT books.title, members.name, loans.borrowed_on, loans.due_on, loans.returned_on
          FROM loans JOIN books ON books.id=loans.book_id JOIN members ON members.id=loans.member_id ORDER BY loans.id`);
        const cell = (value: unknown) => {
          const text = String(value ?? '');
          const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
          return '"' + safe.replaceAll('"', '""') + '"';
        };
        const lines = rows.map(row => [row.title, row.name, row.borrowed_on, row.due_on, row.returned_on].map(cell).join(','));
        return respond(['Book,Member,Checked out,Due,Returned', ...lines].join('\r\n'), 200, {
          'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="folio-loans.csv"',
        });
      }
      if (method === 'GET') {
        const page = await renderPage(db, url, csrf);
        if (page) return respond(layout(path, page[0], page[1], csrf, url.searchParams.get('saved') === '1' ? 'Changes saved.' : ''), 200);
      }
      if (method === 'POST' && (actions.has(path) || path === '/logout')) {
        const section = '/' + path.split('/')[1];
        try {
          const form = await readForm(request);
          if (form.get('csrf') !== csrf) return respond('Reload the library page and try again.', 403);
          if (path === '/logout') {
            await db.write(tx => tx.run('DELETE FROM sessions WHERE id=?', id));
            return redirect('/catalog', cookie('', 0));
          }
          await changeLibrary(db, path, form);
          return redirect(section + '?saved=1');
        } catch (error) {
          if (!(error instanceof FormError)) throw error;
          const page = await renderPage(db, new URL(section, url), csrf);
          return respond(layout(section, page?.[0] ?? 'Library', page?.[1] ?? '', csrf, error.message, true), 400);
        }
      }
      return respond(layout(path, 'Page not found', '<p><a href="/">Back to overview</a></p>', csrf), 404);
    } catch (error) {
      if (path === '/login' && error instanceof FormError) return login(error.message, 400);
      console.error(error);
      return respond(layout('', 'Something went wrong', '<p>Please try again from the library overview.</p>'), 500);
    }
  };
}
