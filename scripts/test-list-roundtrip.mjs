// Tests POST + GET-by-slug + PATCH against a TEST list (not production).
// Required env: AZURE_TENANT_ID, AZURE_CONTENT_CLIENT_ID, AZURE_CONTENT_CLIENT_SECRET,
//               TEST_LISTS_SITE_ID, TEST_LISTS_LIST_ID

import {
  getGraphToken,
  findItemBySlug,
  createItem,
  patchItem,
} from '../src/sharepointClient.js';

const env = (k) => {
  if (!process.env[k]) throw new Error(`Missing env ${k}`);
  return process.env[k];
};

const token = await getGraphToken({
  tenantId: env('AZURE_TENANT_ID'),
  clientId: env('AZURE_CONTENT_CLIENT_ID'),
  clientSecret: env('AZURE_CONTENT_CLIENT_SECRET'),
});

const siteId = env('TEST_LISTS_SITE_ID');
const listId = env('TEST_LISTS_LIST_ID');
const slug = `roundtrip-${Date.now()}`;

console.log('1. CREATE');
const created = await createItem({
  token,
  siteId,
  listId,
  fields: { Title: 'Roundtrip', Slug: slug, Description: 'initial' },
});
console.log(`  itemId=${created.id}`);

console.log('2. FIND by slug');
const found = await findItemBySlug({ token, siteId, listId, slug });
if (!found || found.id !== created.id) throw new Error('find-by-slug mismatch');
console.log('  OK');

console.log('3. PATCH');
await patchItem({
  token,
  siteId,
  listId,
  itemId: created.id,
  fields: { Description: 'updated' },
});
console.log('  OK');

const re = await findItemBySlug({ token, siteId, listId, slug });
if (re.fields.Description !== 'updated') throw new Error('patch did not stick');
console.log('All operations OK.');
