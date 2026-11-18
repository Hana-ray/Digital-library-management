import { libraryHandler } from '../../src/app.ts';
import { connectTurso } from '../../src/turso.ts';

let handle: ReturnType<typeof libraryHandler> | undefined;

export default async function library(request: Request) {
  if (!handle) {
    const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LIBRARY_ADMIN_PASSWORD } = process.env;
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN || !LIBRARY_ADMIN_PASSWORD || LIBRARY_ADMIN_PASSWORD.length < 12) {
      return new Response('Library setup is incomplete. See the project README.', { status: 503 });
    }
    handle = libraryHandler(connectTurso(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN), LIBRARY_ADMIN_PASSWORD, true);
  }
  return handle(request);
}

export const config = {
  path: ['/', '/*'],
  excludedPath: ['/styles.css'],
};
