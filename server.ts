import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openLibrary } from './local-db.ts';
import { libraryHandler } from './app.ts';

export function createLibraryServer(databasePath: string, adminPassword: string) {
  const db = openLibrary(databasePath);
  const handle = libraryHandler(db, adminPassword);
  const css = readFileSync(new URL('../public/styles.css', import.meta.url));
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      if (!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host) || !req.url?.startsWith('/')) {
        res.writeHead(400).end();
        return;
      }
      if (req.url.split('?')[0] === '/styles.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }).end(css);
        return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const method = req.method ?? 'GET';
      const options: RequestInit & { duplex?: 'half' } = { method, headers };
      if (method !== 'GET' && method !== 'HEAD') {
        options.body = req as unknown as BodyInit;
        options.duplex = 'half';
      }
      const response = await handle(new Request('http://' + host + req.url, options));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.on('close', () => db.close());
  return server;
}

function localPassword(dataDir: URL) {
  if (process.env.LIBRARY_ADMIN_PASSWORD) return process.env.LIBRARY_ADMIN_PASSWORD;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = new URL('admin-password.txt', dataDir);
  try {
    writeFileSync(file, randomBytes(12).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Created admin password in data/admin-password.txt');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const password = readFileSync(file, 'utf8').trim();
  if (!password) throw new Error('Set LIBRARY_ADMIN_PASSWORD or restore data/admin-password.txt.');
  return password;
}

if (import.meta.main) {
  const dataDir = new URL('../data/', import.meta.url);
  const databasePath = process.env.LIBRARY_DB_PATH ?? fileURLToPath(new URL('library.sqlite', dataDir));
  const server = createLibraryServer(databasePath, localPassword(dataDir));
  server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`Folio Library running at http://127.0.0.1:${address.port}`);
  });
}
