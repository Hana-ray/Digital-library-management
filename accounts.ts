import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { LibraryDatabase } from './database.ts';
import { FormError } from './library.ts';
import { escape } from './views.ts';

const derive = promisify(scrypt);
const dummySalt = '00000000000000000000000000000000';

export async function registerMember(db: LibraryDatabase, form: URLSearchParams) {
  const name = form.get('name')?.trim() ?? '';
  const email = form.get('email')?.trim().toLowerCase() ?? '';
  const password = form.get('password') ?? '';
  if (!name || name.length > 150 || email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new FormError('Enter a valid name and email address.');
  }
  if (password.length < 12 || password.length > 128) throw new FormError('Use a password with 12–128 characters.');
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(password, salt, 64) as Buffer).toString('hex');
  await db.write(async tx => {
    if (await tx.get('SELECT id FROM members WHERE email=?', email)) {
      throw new FormError('This email cannot be registered. If you already have a library record, contact staff.');
    }
    await tx.run('INSERT INTO members(name,email) VALUES (?,?)', name, email);
    await tx.run('INSERT INTO member_accounts VALUES ((SELECT id FROM members WHERE email=?), ?)', email, salt + ':' + key);
  });
}

export async function verifyMember(db: LibraryDatabase, email: string, password: string) {
  if (email.length > 150 || password.length > 128) return;
  const account = await db.get(`SELECT members.id,password_key FROM members
    JOIN member_accounts ON members.id=member_id WHERE email=?`, email.trim().toLowerCase());
  const [salt, key] = typeof account?.password_key === 'string'
    ? account.password_key.split(':') : [dummySalt, '0'.repeat(128)];
  const actual = await derive(password, salt, 64) as Buffer;
  if (timingSafeEqual(actual, Buffer.from(key, 'hex')) && account) return Number(account.id);
}

export function memberForm(register: boolean, next: string) {
  return `<section class="panel login"><form class="fields" method="post" action="${register ? '/register' : '/member-login'}">
    <input type="hidden" name="next" value="${escape(next)}">
    ${register ? '<label>Name<input name="name" autocomplete="name" maxlength="150" required></label>' : ''}
    <label>Email<input name="email" type="email" autocomplete="username" maxlength="150" required></label>
    <label>Password<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}"
      ${register ? 'minlength="12" aria-describedby="password-hint"' : ''} maxlength="128" required></label>
    ${register ? '<small id="password-hint">Use at least 12 characters.</small>' : ''}
    <button>${register ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span></button></form>
    <p><a href="${register ? '/member-login' : '/register'}?next=${encodeURIComponent(next)}">${register ? 'Already a member? Sign in' : 'Create a member account'}</a></p></section>`;
}

export async function memberPage(db: LibraryDatabase, member: number, csrf: string) {
  const loans = await db.all(`SELECT books.title, book_id, borrowed_on, due_on, returned_on FROM loans
    JOIN books ON books.id=book_id WHERE member_id=? ORDER BY loans.id DESC`, member);
  const reservations = await db.all(`SELECT reservations.id, books.title, book_id, created_on FROM reservations
    JOIN books ON books.id=book_id WHERE member_id=? ORDER BY reservations.id`, member);
  const token = `<input type="hidden" name="csrf" value="${escape(csrf)}">`;
  return `<div class="report-grid"><section class="panel"><h2>My loans</h2>${loans.length ? `<ul class="account-list">${loans.map(row =>
    `<li><a href="/books/${row.book_id}">${escape(row.title)}</a><span>${row.returned_on
      ? 'Returned ' + escape(row.returned_on) : 'Due ' + escape(row.due_on)}</span></li>`).join('')}</ul>` : '<p class="empty">No loans yet.</p>'}</section>
    <section class="panel"><h2>My reservations</h2>${reservations.length ? `<ul class="account-list">${reservations.map(row =>
    `<li><a href="/books/${row.book_id}">${escape(row.title)}</a><span>Reserved ${escape(row.created_on)}</span>
    <form method="post" action="/account/cancel">${token}<input type="hidden" name="id" value="${row.id}"><button class="quiet">Cancel</button></form></li>`).join('')}</ul>` : '<p class="empty">No reservations yet.</p>'}
    <a href="/catalog">Browse books</a></section></div>
    <form method="post" action="/account/logout">${token}<button class="quiet">Sign out</button></form>`;
}
