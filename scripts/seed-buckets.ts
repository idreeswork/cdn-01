// Run ONCE to seed initial bucket config into KV.
// After this, manage buckets from the /admin dashboard.
// npx ts-node scripts/seed-buckets.ts

const CF_API = 'https://api.cloudflare.com/client/v4';

const INITIAL_CONFIG = {
  default_bucket: 'toolzbucket',
  buckets: [
    {
      id: 'toolzbucket',
      name: 'ToolzBucket',
      routes: {
        IN: { tag: 'toolzbucket-21', domain: 'amazon.in' },
        US: { tag: 'toolzbucket-20', domain: 'amazon.com' },
        GB: { tag: 'toolzbucket-20', domain: 'amazon.co.uk' },
        CA: { tag: 'toolzbucket-20', domain: 'amazon.ca' },
        AU: { tag: 'toolzbucket-20', domain: 'amazon.com.au' },
        DE: { tag: 'toolzbucket-20', domain: 'amazon.de' },
      },
      fallback: 'US',
      active: true,
      created_at: new Date().toISOString(),
    }
  ]
};

async function main() {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID } = process.env;
  const url = `${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/config:buckets`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(INITIAL_CONFIG),
  });
  if (!res.ok) throw new Error(await res.text());
  console.log('✓ Bucket config seeded. Your toolzbucket account is ready.');
  console.log('  Add more accounts from the /admin dashboard → Accounts tab.');
}

main().catch(e => { console.error(e); process.exit(1); });
