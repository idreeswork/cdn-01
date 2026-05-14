// Reads all products from KV → writes List tab (full overview) + fills Bulk tab column F (Link)
// Run: npm run export
// GitHub Actions: KV → Sheet Export (every 6h at :30)

import { google } from 'googleapis';

const CF_API = 'https://api.cloudflare.com/client/v4';
const WORKER_BASE = process.env.WORKER_BASE_URL!;

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 60);
}

async function getKeys(): Promise<string[]> {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID } = process.env;
  const base = `${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(base + '/keys?prefix=product:&limit=1000' + (cursor ? '&cursor=' + cursor : ''), {
      headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
    });
    const d: any = await res.json();
    keys.push(...d.result.map((k: any) => k.name));
    cursor = d.result_info?.cursor;
  } while (cursor);
  return keys;
}

async function getVal(key: string): Promise<any> {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID } = process.env;
  const res = await fetch(
    `${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } }
  );
  return res.ok ? res.json() : null;
}

async function main() {
  if (!WORKER_BASE) throw new Error('WORKER_BASE_URL env var required');

  const keys = await getKeys();
  const products = (await Promise.all(keys.map(getVal))).filter(Boolean);
  console.log(`${products.length} products found in KV`);

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const sid = process.env.GOOGLE_SHEETS_ID!;

  // ── 1. Update List tab (full read-only overview) ──────────────────────────
  const listHdrs = ['Name', 'Slug', 'ASIN', 'Account', 'Smart Link', 'Amazon IN', 'Amazon US', 'Active', 'Image', 'Board', 'Description', 'Keywords', 'Updated'];
  const listRows = (products as any[])
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((p) => [
      p.name, p.slug, p.asin, p.bucket_id || '',
      `${WORKER_BASE}/p/${p.slug}`,
      p.in_url || '', p.us_url || '',
      p.active ? 'TRUE' : 'FALSE',
      p.image_url || '', p.pinterest_board || '',
      p.description || '', p.keywords || '', p.updated_at || '',
    ]);
  await sheets.spreadsheets.values.clear({ spreadsheetId: sid, range: 'List!A:Z' });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: 'List!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [listHdrs, ...listRows] },
  });
  console.log(`✓ List tab updated (${listRows.length} rows)`);

  // ── 2. Fill Bulk tab column F (Link) for every data row ──────────────────
  // Column layout: A=Title, B=Image URL, C=Board, D=Thumbnail, E=Description,
  //                F=Link (FILL THIS), G=Publish date, H=Keywords,
  //                I=Amazon IN, J=Amazon US, K=Bucket, L=Slug override
  const bulkRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: 'Bulk!A2:L', // skip header row 1
  });
  const bulkRows = (bulkRes.data.values ?? []) as string[][];

  // slug → smart link map from KV for confirmed links
  const slugToLink: Record<string, string> = {};
  for (const p of products as any[]) {
    slugToLink[p.slug] = `${WORKER_BASE}/p/${p.slug}`;
  }

  const batchData: { range: string; values: string[][] }[] = [];
  bulkRows.forEach((row, i) => {
    const title = row[0]?.trim();
    if (!title) return; // skip blank rows
    // Column L (index 11) = explicit slug override; else derive from title
    const slug = row[11]?.trim() || slugify(title);
    const link = slugToLink[slug] || `${WORKER_BASE}/p/${slug}`;
    // i=0 → sheet row 2, i=1 → row 3, etc.
    batchData.push({ range: `Bulk!F${i + 2}`, values: [[link]] });
  });

  if (batchData.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sid,
      requestBody: { valueInputOption: 'RAW', data: batchData },
    });
    console.log(`✓ Bulk tab F column filled (${batchData.length} rows)`);
  } else {
    console.log('  Bulk tab: no data rows to update');
  }

  console.log('Export complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
