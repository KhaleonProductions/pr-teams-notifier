const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Obtain a Graph API access token using client-credentials grant.
 * Matches the pattern from notify.js `getGraphToken`.
 */
export async function getGraphToken({ tenantId, clientId, clientSecret }) {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token error (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('Graph token response missing access_token');
  }
  return json.access_token;
}

/**
 * Find the first SharePoint List item whose Slug field matches `slug`.
 * Returns the item (with fields expanded) or null if not found.
 *
 * Uses the `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly` header so
 * the filter works even on non-indexed columns.
 */
export async function findItemBySlug({ token, siteId, listId, slug }) {
  const url = `${GRAPH}/sites/${siteId}/lists/${listId}/items?expand=fields&$filter=fields/Slug eq '${encodeURIComponent(slug)}'`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`findItemBySlug failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.value?.[0] ?? null;
}

/**
 * Create a new SharePoint List item.
 * `fields` must be a flat object of internal column names → values,
 * matching the shape used by notify.js `postListItem`.
 */
export async function createItem({ token, siteId, listId, fields }) {
  const url = `${GRAPH}/sites/${siteId}/lists/${listId}/items`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createItem failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * Update specific fields on an existing SharePoint List item via PATCH on the
 * fields sub-resource (Graph allows partial updates this way).
 */
export async function patchItem({ token, siteId, listId, itemId, fields }) {
  const url = `${GRAPH}/sites/${siteId}/lists/${listId}/items/${itemId}/fields`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`patchItem failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * Upload a PNG as a drive file attached to a SharePoint List item.
 *
 * Graph path: /sites/{siteId}/lists/{listId}/items/{itemId}/driveItem:/Attachments/{filename}:/content
 * This places the file in the item's special "Attachments" folder in the
 * list's backing document library. Content-Type must be image/png.
 */
export async function uploadAttachment({ token, siteId, listId, itemId, filename, pngBuffer }) {
  const url = `${GRAPH}/sites/${siteId}/lists/${listId}/items/${itemId}/driveItem:/Attachments/${filename}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'image/png',
    },
    body: pngBuffer,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`uploadAttachment failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json();
}
