/**
 * botFrameworkClient.js
 *
 * Bot Framework token acquisition, channel-card posting, and adaptive-card
 * construction for the auto-doc feature-grouped notification.
 *
 * Three named exports:
 *   getBotFrameworkToken      — client-credentials token against api.botframework.com
 *   postChannelCardViaBotFramework — POST an adaptive card to a Teams channel
 *   buildCard                 — build a feature-grouped Adaptive Card v1.4
 *
 * Lists row URL strategy
 * ----------------------
 * SharePoint List items can be deep-linked via:
 *   https://<tenant>.sharepoint.com/sites/<site>/Lists/<listName>/DispForm.aspx?ID=<id>
 *
 * The tenant, site, and list-name are not available as cheap constants here, so
 * we resolve the base URL from the env var LISTS_DISPFORM_BASE_URL if set:
 *   e.g. https://contoso.sharepoint.com/sites/MySite/Lists/FeatureDocs/DispForm.aspx
 *
 * When that env var is absent the card still shows itemId in-text so the
 * reviewer knows which row to look up. The "View PR" action always links to
 * the actual PR URL, which is always available.
 */

// ---------------------------------------------------------------------------
// 1. getBotFrameworkToken
// ---------------------------------------------------------------------------

/**
 * Obtain a Bot Framework access token using the client-credentials grant.
 *
 * @param {{ tenantId: string, appId: string, appPassword: string }} creds
 *   - tenantId    — Azure AD tenant where the bot app registration lives
 *                   (BOT_HOME_AZURE_TENANT_ID / config.bot.homeTenantId)
 *   - appId       — bot's Azure app-registration client ID (TEAMS_APP_ID)
 *   - appPassword — client secret (TEAMS_APP_PASSWORD)
 * @returns {Promise<string>} access_token
 */
export async function getBotFrameworkToken({ tenantId, appId, appPassword }) {
  const r = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     appId,
        client_secret: appPassword,
        scope:         'https://api.botframework.com/.default',
      }),
    },
  );
  if (!r.ok) {
    throw new Error(`Bot Framework token: ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
  const data = await r.json();
  if (!data.access_token) throw new Error('Bot Framework token response missing access_token');
  return data.access_token;
}

// ---------------------------------------------------------------------------
// 2. postChannelCardViaBotFramework
// ---------------------------------------------------------------------------

/**
 * POST an adaptive card to a Teams channel via Bot Framework /v3/conversations.
 *
 * Mirrors the logic in notify.js `postChannelCardViaBotFramework` but accepts a
 * plain object instead of the monolithic `autoDoc` bag, making it testable in
 * isolation. Internally calls getBotFrameworkToken so the caller does not need
 * to manage a token.
 *
 * Service URL falls back to the APAC region endpoint used by the SG1 bot
 * (matching the existing notify.js comment: "see commit d8ac7990").
 *
 * @param {{
 *   tenantId:    string,   // BOT_HOME_AZURE_TENANT_ID — home tenant for token
 *   appId:       string,   // TEAMS_APP_ID
 *   appPassword: string,   // TEAMS_APP_PASSWORD
 *   teamId:      string,   // TARGET_TEAM_ID
 *   channelId:   string,   // TARGET_CHANNEL_ID
 *   targetTenantId: string,// TARGET_AZURE_TENANT_ID — target org's tenant
 *   serviceUrl?: string,   // BOT_SERVICE_URL (optional; defaults to APAC)
 *   summary?:    string,   // notification preview text (≤240 chars)
 *   card:        object,   // full Bot Framework message object from buildCard()
 * }} opts
 * @returns {Promise<{ conversationId: string, activityId: string }>}
 */
export async function postChannelCardViaBotFramework({
  tenantId,
  appId,
  appPassword,
  teamId,
  channelId,
  targetTenantId,
  serviceUrl,
  summary,
  card,
}) {
  const token = await getBotFrameworkToken({ tenantId, appId, appPassword });

  // Default service URL: APAC region for SG1. The everything app falls back to
  // `https://smba.trafficmanager.net/apac/{tenantId}/` in resolveTenantServiceUrl.
  const resolvedServiceUrl = serviceUrl
    || `https://smba.trafficmanager.net/apac/${targetTenantId}/`;

  const body = {
    isGroup: true,
    channelData: {
      channel: { id: channelId },
      team:    { id: teamId },
      tenant:  { id: targetTenantId },
    },
    activity: {
      type: 'message',
      // Bot Framework /v3/conversations rejects {text + attachments[card]} for
      // channel posts ("Activity resulted into multiple skype activities"). Send
      // ONLY the card-as-attachment; use `summary` for notification preview text.
      summary: (summary || 'Auto-doc notification').slice(0, 240),
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: card.attachments?.[0]?.content || card,
        },
      ],
    },
  };

  const r = await fetch(`${resolvedServiceUrl}v3/conversations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errBody = await r.text();
    if (r.status === 403 && /BotNotInConversationRoster/i.test(errBody)) {
      throw new Error('BotNotInConversationRoster — install the bot in the target team first.');
    }
    throw new Error(`Bot Framework post failed (${r.status}): ${errBody.slice(0, 300)}`);
  }
  const data = await r.json();
  return { conversationId: data.id, activityId: data.activityId };
}

// ---------------------------------------------------------------------------
// 3. buildCard  (NEW signature — feature-grouped)
// ---------------------------------------------------------------------------

/**
 * Build an Adaptive Card v1.4 that groups results by feature, for the auto-doc
 * pipeline.
 *
 * @param {{
 *   pr: {
 *     number: string|number,
 *     title:  string,
 *     author: string,
 *     url:    string,
 *   },
 *   upsertResults: Array<{
 *     feature:  { displayName: string },
 *     itemId?:  string|number,
 *     summary?: string,
 *     error?:   string,
 *   }>,
 *   uncovered: string[],   // file paths not matched to any feature
 *   listsDispformBase?: string|null, // base URL for SharePoint DispForm links
 * }} opts
 * @returns {object} Bot Framework message envelope (type:'message', attachments:[...])
 *
 * Lists row URL
 * -------------
 * Pass `listsDispformBase` (from env var LISTS_DISPFORM_BASE_URL, e.g.
 *   https://contoso.sharepoint.com/sites/MySite/Lists/FeatureDocs/DispForm.aspx
 * ) so each upsert result that has an itemId will link to that row. When absent,
 * the itemId is included in the card text so reviewers can locate it manually.
 */
export function buildCard({ pr, upsertResults, uncovered, listsDispformBase = null }) {
  const listsBase = listsDispformBase || null;

  // --- Title block ---
  const cardBody = [
    {
      type: 'TextBlock',
      size: 'Large',
      weight: 'Bolder',
      text: `Auto-doc: PR #${pr.number} — ${pr.title} by @${pr.author}`,
      wrap: true,
    },
  ];

  // --- Per-feature results ---
  if (upsertResults && upsertResults.length > 0) {
    cardBody.push({
      type: 'TextBlock',
      text: '**Features updated:**',
      weight: 'Bolder',
      spacing: 'Medium',
      wrap: true,
    });

    for (const result of upsertResults) {
      const featureName = result.feature?.displayName || '(unknown feature)';

      if (result.error) {
        // Failed upsert — show the feature name and "(failed)" without a link.
        cardBody.push({
          type: 'TextBlock',
          text: `- **${featureName}**: _(failed)_`,
          wrap: true,
          spacing: 'None',
        });
      } else {
        // Successful upsert — show summary and optionally link to the Lists row.
        const summaryText = result.summary || '(no summary)';
        let displayText;

        if (listsBase && result.itemId != null) {
          const rowUrl = `${listsBase}?ID=${result.itemId}`;
          // Adaptive Cards TextBlock supports Markdown links in Teams
          displayText = `- **[${featureName}](${rowUrl})**: ${summaryText}`;
        } else if (result.itemId != null) {
          // No base URL configured — include itemId in text for manual lookup.
          displayText = `- **${featureName}** (item ${result.itemId}): ${summaryText}`;
        } else {
          displayText = `- **${featureName}**: ${summaryText}`;
        }

        cardBody.push({
          type: 'TextBlock',
          text: displayText,
          wrap: true,
          spacing: 'None',
        });
      }
    }
  }

  // --- Uncovered files section ---
  if (uncovered && uncovered.length > 0) {
    cardBody.push(
      {
        type: 'TextBlock',
        text: '**Uncovered files (please add to features.yaml):**',
        weight: 'Bolder',
        spacing: 'Medium',
        wrap: true,
        color: 'Warning',
      },
      {
        type: 'TextBlock',
        text: uncovered.map(f => `- ${f}`).join('\n'),
        wrap: true,
        fontType: 'Monospace',
        size: 'Small',
        spacing: 'None',
      },
    );
  }

  // --- Envelope — same scaffolding as the existing notify.js buildCard ---
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: cardBody,
          actions: [
            {
              type: 'Action.OpenUrl',
              title: 'View PR',
              url: pr.url,
            },
          ],
        },
      },
    ],
  };
}
