// Syncs the "Bulk" tab (Pinterest-format sheet) → Cloudflare KV
// Columns: Title|Media URL|Pinterest board|Thumbnail|Description|Link|Publish date|Keywords|Amazon IN|Amazon US|Bucket|Slug
// Runs via GitHub Actions every 6h OR manually: npx ts-node scripts/sync-sheet-to-kv.ts

import { google } from 'googleapis';

const CF_API = 'https://api.cloudflare.com/client/v4';
const CHUNK = 100;

function extractAsin(url: string): string | null {
  const m = url.match(/\/dp\/([A-Z0-9]{10})/i) || url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}
function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 60);
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID!,
    range: 'Bulk!A2:L', // skip header row
  });

  const now = new Date().toISOString();
  const rows = (res.data.values ?? []) as string[][];
  const entries: { key: string; value: string }[] = [];

  for (const row of rows) {
    const [title, media_url, pinterest_board, _thumb, description, _link, publish_date, keywords, in_url, us_url, bucket_id, slug_override] = row;
    if (!title?.trim()) continue;

    const asin = (in_url ? extractAsin(in_url) : null) ?? (us_url ? extractAsin(us_url) : null);
    if (!asin) { console.warn('Skip (no ASIN):', title); continue; }

    const slug = slug_override?.trim() ? slug_override.trim().toLowerCase().replace(/\s+/g, '-') : slugify(title.trim());

    entries.push({
      key: `product:${slug}`,
      value: JSON.stringify({
        slug, name: title.trim(), asin,
        bucket_id: bucket_id?.trim() || 'toolzbucket',
        active: true,
        in_url: in_url?.trim() || undefined,
        us_url: us_url?.trim() || undefined,
        image_url: media_url?.trim() || undefined,
        description: description?.trim() || undefined,
        keywords: keywords?.trim() || undefined,
        pinterest_board: pinterest_board?.trim() || undefined,
        publish_date: publish_date?.trim() || undefined,
        created_at: now, updated_at: now,
      }),
    });
  }

  console.log(`Syncing ${entries.length} products...`);
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID } = process.env;
  const url = `${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/bulk`;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const r = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(chunk) });
    if (!r.ok) throw new Error(await r.text());
    console.log(`✓ ${chunk.length} products synced`);
  }
  console.log('Done.');
}
main().catch(e => { console.error(e); process.exit(1); });
