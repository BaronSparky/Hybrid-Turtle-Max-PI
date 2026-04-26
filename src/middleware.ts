import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Lightweight API auth middleware.
 * Protects all /api/* routes except whitelisted paths.
 * Uses the NextAuth JWT token to verify session — no DB call required.
 *
 * API auth is enforced by default. For isolated local troubleshooting only,
 * set DISABLE_API_AUTH=true while NODE_ENV is not production.
 */

const PUBLIC_PATHS = [
  '/api/auth',        // NextAuth routes (login, callback, csrf, etc.)
  '/api/health',      // Health check endpoint
  '/api/db-status',   // Migration status (needed by dashboard before login)
  '/api/heartbeat',   // Heartbeat (needed by LiveDataBootstrap on mount)
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  // Local single-user mode: skip API auth when explicitly opted out via env var.
  // This is the default for HybridTurtle desktop deployments (start.bat).
  if (process.env.DISABLE_API_AUTH === 'true') {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Only protect /api/* routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Allow whitelisted paths through without auth
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for valid NextAuth JWT session token
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorised' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
