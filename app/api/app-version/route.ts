import { APP_BUILD_ID } from '@/lib/app-update';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ version: APP_BUILD_ID }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
