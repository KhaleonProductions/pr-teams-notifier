import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { deflateRawSync } from 'zlib';
import { Buffer } from 'buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REPOS_JSON_URL = 'https://api.github.com/repos/KhaleonProductions/pr-teams-notifier/contents/repos.json';

// --- 1. Read PR data ---

const prData = {
  url:        process.env.PR_URL        || '',
  title:      process.env.PR_TITLE      || 'Untitled PR',
  body:       process.env.PR_BODY       || 'No description provided.',
  branch:     process.env.PR_BRANCH     || 'unknown',
  base:       process.env.PR_BASE       || 'main',
  repo:       process.env.PR_REPO       || 'unknown/unknown',
  files:      process.env.PR_FILES      || '',
  filesCount: process.env.PR_FILES_COUNT || '0',
  additions:  process.env.PR_ADDITIONS  || '0',
  deletions:  process.env.PR_DELETIONS  || '0',
  createdAt:  process.env.PR_CREATED_AT || new Date().toISOString(),
  number:     process.env.PR_NUMBER     || '0',
};

// If PR_JSON is set (from local hook), parse everything from it
if (process.env.PR_JSON) {
  try {
    const pr = JSON.parse(process.env.PR_JSON);
    prData.url       = pr.url || prData.url;
    prData.title     = pr.title || prData.title;
    prData.body      = pr.body || 'No description provided.';
    prData.branch    = pr.headRefName || prData.branch;
    prData.base      = pr.baseRefName || prData.base;
    prData.number    = String(pr.number || prData.number);
    prData.filesCount = String(pr.changedFiles || prData.filesCount);
    prData.additions = String(pr.additions || prData.additions);
    prData.deletions = String(pr.deletions || prData.deletions);
    prData.createdAt = pr.createdAt || prData.createdAt;
    prData.files     = (pr.files || []).map(f => f.path).join(',');
  } catch (e) {
    console.error('[pr-notify] Warning: Could not parse PR_JSON:', e.message);
  }
}

// --- 2. Determine webhook URL + auto-doc config ---

let webhookUrl = process.env.TEAMS_WEBHOOK_URL;
let config = {};

try {
  config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
} catch (e) {
  // config.json is optional — env vars take precedence in CI.
  config = {};
}

if (!webhookUrl) {
  webhookUrl = config.teamsWebhookUrl;
}

if (!webhookUrl || webhookUrl === 'YOUR_TEAMS_WEBHOOK_URL_HERE') {
  console.error('[pr-notify] Teams webhook URL not configured.');
  console.error('[pr-notify] Set TEAMS_WEBHOOK_URL env var or create config.json.');
  process.exit(1);
}

// Auto-doc config — Claude Code SDK uses ambient OAuth auth (~/.claude/.credentials.json),
// not an API key. R03-compliant. The Microsoft Graph piece needs explicit creds for the
// SharePoint List POST.
const autoDoc = {
  claudeModel:       process.env.CLAUDE_MODEL              || config.claude?.model || 'claude-haiku-4-5-20251001',
  azureTenantId:     process.env.AZURE_TENANT_ID           || config.azure?.tenantId,
  azureClientId:     process.env.AZURE_CONTENT_CLIENT_ID   || config.azure?.contentClientId,
  azureClientSecret: process.env.AZURE_CONTENT_CLIENT_SECRET || config.azure?.contentClientSecret,
  listsSiteId:       process.env.LISTS_SITE_ID             || config.lists?.siteId,
  listsListId:       process.env.LISTS_LIST_ID             || config.lists?.listId,
};

const autoDocFullyConfigured = Boolean(
  autoDoc.azureTenantId &&
  autoDoc.azureClientId &&
  autoDoc.azureClientSecret &&
  autoDoc.listsSiteId &&
  autoDoc.listsListId
);

if (!autoDocFullyConfigured) {
  console.log('[pr-notify] Auto-doc disabled (missing config). Falling back to plain notification.');
}

// --- Fetch watched repos from GitHub ---

async function getWatchedRepos() {
  try {
    console.log('[pr-notify] Fetching watched repos from GitHub...');
    const response = await fetch(REPOS_JSON_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3.raw+json',
        'User-Agent': 'pr-teams-notifier',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    const repos = (data.repos || []).map(r => r.toLowerCase());
    console.log(`[pr-notify] Loaded ${repos.length} watched repo(s) from GitHub.`);
    return repos;
  } catch (err) {
    console.error(`[pr-notify] Could not fetch repos.json from GitHub: ${err.message}`);
    const localRepos = (config.repos || []).map(r => r.toLowerCase());
    if (localRepos.length > 0) {
      console.log(`[pr-notify] Falling back to ${localRepos.length} repo(s) from local config.json.`);
      return localRepos;
    }
    console.log('[pr-notify] No fallback repos found. Allowing all repos.');
    return null;
  }
}

const watchedRepos = await getWatchedRepos();
if (watchedRepos !== null) {
  if (!watchedRepos.includes(prData.repo.toLowerCase())) {
    console.log(`[pr-notify] Skipping: ${prData.repo} is not in the watched repos list.`);
    process.exit(0);
  }
  console.log(`[pr-notify] ${prData.repo} is in the watched list. Proceeding.`);
}

// --- 3. Deterministic fallback summary (used if AI fails) ---

function fallbackSummary(filesStr, additions, deletions) {
  const files = filesStr.split(',').filter(Boolean);
  if (files.length === 0) return 'No file changes detected.';

  const dirs = {};
  const exts = {};

  for (const f of files) {
    const parts = f.split('/');
    const dir = parts.length > 1 ? parts[0] + '/' : '(root)';
    dirs[dir] = (dirs[dir] || 0) + 1;

    const dotIndex = f.lastIndexOf('.');
    const ext = dotIndex !== -1 ? f.slice(dotIndex) : 'other';
    exts[ext] = (exts[ext] || 0) + 1;
  }

  const topDir = Object.entries(dirs).sort((a, b) => b[1] - a[1])[0];
  const extList = Object.entries(exts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([ext, count]) => `${count} ${ext}`)
    .join(', ');

  return `Changed ${files.length} file(s) (${extList}), mostly in ${topDir[0]}. Net change: +${additions}/-${deletions} lines.`;
}

// --- 3a. AI-generated summary + Mermaid spec via Claude Code SDK (R03) ---
//
// The SDK reads OAuth credentials from ~/.claude/.credentials.json (no API key).
// Local dev: your `claude` CLI auth works automatically.
// CI: provision the credentials file from the CLAUDE_OAUTH_CREDS GHA secret
//     (see .github/workflows/reusable-pr-notify.yml). If unset, AI gen is skipped
//     and the basic notification falls back to the deterministic summary.

async function aiGenerate(prData, autoDoc) {
  // Lazy-import — if the SDK isn't installed in the runtime, bail with a clear message
  // and let the caller fall back. We never crash the basic notification.
  let query;
  try {
    ({ query } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch (e) {
    throw new Error(`@anthropic-ai/claude-agent-sdk not installed: ${e.message}`);
  }

  const fileList = prData.files.split(',').filter(Boolean).slice(0, 50).join('\n  ');
  const truncatedBody = (prData.body || '').slice(0, 2000);

  const prompt = `You are documenting a software pull request for an internal engineering team.

Generate two artifacts:

1. summary — a 1-2 sentence plain-English description of what the PR does and why. Active voice. No filler.

2. mermaidSpec — a Mermaid flowchart that visually represents the feature/change.
   Rules:
   - Use \`flowchart TD\` or \`flowchart LR\` syntax
   - Maximum 12 nodes
   - Use feature-level abstraction, not file-level (good: "User submits form"; bad: "form-handler.tsx")
   - Label edges with verbs where useful
   - Output ONLY the mermaid spec body — no \`\`\`mermaid fences, no surrounding prose
   - The first line MUST start with \`flowchart \`

Set isNoOp=true ONLY if this is a pure formatting / docs / version-bump PR with no logic change.

PR title: ${prData.title}
Branch: ${prData.branch} → ${prData.base}
Description: ${truncatedBody || '(none)'}
Files changed (${prData.filesCount}, +${prData.additions}/-${prData.deletions}):
  ${fileList || '(none)'}`;

  const schema = {
    type: 'object',
    properties: {
      summary:     { type: 'string', description: '1-2 sentence plain-English summary.' },
      mermaidSpec: { type: 'string', description: 'Mermaid flowchart spec (no fences). Must start with "flowchart ".' },
      isNoOp:      { type: 'boolean', description: 'True only for pure formatting/docs/version-bump PRs.' },
    },
    required: ['summary', 'mermaidSpec', 'isNoOp'],
  };

  // Mirrors the everything app's `queryStructured` pattern in
  // teams_bot/src/utils/structuredQuery.ts (lean SDK defaults — R24).
  const sdkResult = query({
    prompt,
    options: {
      model:           autoDoc.claudeModel,
      outputFormat:    { type: 'json_schema', schema },
      tools:           [],
      settingSources:  [],
      allowedTools:    [],
      permissionMode:  'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns:        3,
    },
  });

  let structuredOutput = null;
  for await (const msg of sdkResult) {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && block.name === 'StructuredOutput' && block.input) {
          structuredOutput = block.input;
        }
      }
    }
  }

  if (!structuredOutput) throw new Error('SDK returned no StructuredOutput tool call');

  const { summary, mermaidSpec, isNoOp } = structuredOutput;
  if (typeof summary !== 'string' || typeof mermaidSpec !== 'string') {
    throw new Error('SDK response missing summary or mermaidSpec fields');
  }
  if (!/^\s*flowchart\s/i.test(mermaidSpec)) {
    throw new Error(`mermaidSpec did not start with "flowchart ": ${mermaidSpec.slice(0, 60)}`);
  }

  return { summary, mermaidSpec, isNoOp: Boolean(isNoOp) };
}

// --- 3b. Mermaid spec → mermaid.ink PNG URL ---
//
// Originally we converted Mermaid → Excalidraw scene via @excalidraw/mermaid-to-excalidraw
// for the hand-drawn aesthetic, then rendered via Kroki. That package is browser-targeted
// (does SVG layout via getBBox) and doesn't run cleanly in Node — even with a JSDOM polyfill.
// Adding Puppeteer just for the rendering step is too much weight for a notification helper.
// We ship Mermaid directly via mermaid.ink, which is a free public renderer — same trigger,
// different visual style.

async function buildDiagramUrl(mermaidSpec) {
  // mermaid.ink takes deflate-raw + base64url-encoded mermaid source. Pako format.
  const compressed = deflateRawSync(Buffer.from(mermaidSpec, 'utf8'), { level: 9 });
  const encoded = compressed.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // mermaid.ink supports both /img/<plain-base64> and /img/pako/<deflate-base64url>.
  // We use plain base64 of the spec — simpler, fewer URL gotchas, max source ~7KB
  // before Teams's image renderer truncates. With our 12-node cap on AI-generated
  // mermaid, payloads are typically under 1KB.
  const plainEncoded = Buffer.from(mermaidSpec, 'utf8').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return {
    url: `https://mermaid.ink/img/${plainEncoded}?type=png&theme=default&bgColor=ffffff`,
    renderer: 'mermaid.ink',
  };
}

// --- 3c. Microsoft Graph: client-credentials token + List item POST ---

async function getGraphToken(autoDoc) {
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${autoDoc.azureTenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     autoDoc.azureClientId,
      client_secret: autoDoc.azureClientSecret,
      scope:         'https://graph.microsoft.com/.default',
      grant_type:    'client_credentials',
    }),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Graph token error (${tokenResponse.status}): ${text.slice(0, 500)}`);
  }
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error('Graph token response missing access_token');
  }
  return tokenData.access_token;
}

async function postListItem(token, autoDoc, fields) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${autoDoc.listsSiteId}/lists/${autoDoc.listsListId}/items`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ fields }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph List POST failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return response.json();
}

// --- 4. Build Adaptive Card ---

function buildCard(prData, summary, diagram) {
  // Truncate body to 500 chars
  let body = prData.body || 'No description provided.';
  if (body.length > 500) {
    body = body.slice(0, 497) + '...';
  }

  // Build file list (max 15 files)
  const files = prData.files.split(',').filter(Boolean);
  let fileListText = '';
  if (files.length > 0) {
    const shown = files.slice(0, 15);
    fileListText = shown.map(f => `- ${f}`).join('\n');
    if (files.length > 15) {
      fileListText += `\n- ...and ${files.length - 15} more`;
    }
  } else {
    fileListText = 'No files listed.';
  }

  const date = new Date(prData.createdAt);
  const formattedDate = date.toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const cardBody = [
    {
      type: 'TextBlock',
      size: 'Large',
      weight: 'Bolder',
      text: 'New Pull Request',
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: prData.title,
      weight: 'Bolder',
      size: 'Medium',
      wrap: true,
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Repository', value: prData.repo },
        { title: 'Branch', value: `${prData.branch} → ${prData.base}` },
        { title: 'PR Number', value: `#${prData.number}` },
        { title: 'Date', value: formattedDate },
        { title: 'Files Changed', value: prData.filesCount },
        { title: 'Lines', value: `+${prData.additions} / -${prData.deletions}` },
      ],
    },
    {
      type: 'TextBlock',
      text: `**Summary:** ${summary}`,
      wrap: true,
      spacing: 'Medium',
    },
  ];

  if (diagram?.url) {
    cardBody.push({
      type: 'TextBlock',
      text: '**Diagram:**',
      weight: 'Bolder',
      spacing: 'Medium',
    });
    cardBody.push({
      type: 'Image',
      url: diagram.url,
      altText: 'Auto-generated PR diagram',
      size: 'Stretch',
    });
  }

  cardBody.push(
    {
      type: 'TextBlock',
      text: '**Description:**',
      weight: 'Bolder',
      spacing: 'Medium',
    },
    {
      type: 'TextBlock',
      text: body,
      wrap: true,
      maxLines: 6,
    },
    {
      type: 'TextBlock',
      text: '**Files:**',
      weight: 'Bolder',
      spacing: 'Medium',
    },
    {
      type: 'TextBlock',
      text: fileListText,
      wrap: true,
      fontType: 'Monospace',
      size: 'Small',
    },
  );

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
              title: 'View Pull Request',
              url: prData.url,
            },
          ],
        },
      },
    ],
  };
}

// --- 5. Send to Teams ---

async function sendToTeams(webhookUrl, card) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[pr-notify] Teams webhook failed (${response.status}): ${text}`);
    process.exit(1);
  }

  console.log('[pr-notify] Teams notification sent successfully.');
}

// --- 6. Execute (auto-doc pipeline with hard fallback) ---

let summary = fallbackSummary(prData.files, prData.additions, prData.deletions);
let diagram = null;
let listItemPosted = false;

if (autoDocFullyConfigured) {
  try {
    console.log('[pr-notify] Generating AI summary + diagram...');
    const ai = await aiGenerate(prData, autoDoc);
    summary = ai.summary;

    if (!ai.isNoOp) {
      try {
        diagram = await buildDiagramUrl(ai.mermaidSpec);
        console.log(`[pr-notify] Diagram rendered via ${diagram.renderer}.`);
      } catch (e) {
        console.error(`[pr-notify] Diagram generation failed (continuing without): ${e.message}`);
      }
    } else {
      console.log('[pr-notify] AI flagged this as a no-op PR; skipping diagram.');
    }

    try {
      const token = await getGraphToken(autoDoc);
      // Column internal names below assume the SharePoint List was created with the
      // exact column names from README setup step 6 (no spaces). If you renamed columns
      // with spaces, SharePoint stores the internal name as "Name_x0020_Suffix".
      // PRURL and Diagram are plain text columns holding URLs — modern Lists views
      // auto-render text-that-looks-like-a-URL as a clickable link.
      const fields = {
        Title:        prData.title,
        Repo:         prData.repo,
        Branch:       prData.branch,
        PRNumber:     parseInt(prData.number, 10) || 0,
        PRURL:        prData.url,
        Date:         prData.createdAt,
        Summary:      summary,
        FilesChanged: parseInt(prData.filesCount, 10) || 0,
        Lines:        `+${prData.additions}/-${prData.deletions}`,
      };
      if (diagram?.url) fields.Diagram = diagram.url;
      await postListItem(token, autoDoc, fields);
      listItemPosted = true;
      console.log('[pr-notify] Posted list item to SharePoint.');
    } catch (e) {
      console.error(`[pr-notify] SharePoint List POST failed (continuing): ${e.message}`);
    }
  } catch (e) {
    console.error(`[pr-notify] AI generation failed; using deterministic summary: ${e.message}`);
  }
}

const card = buildCard(prData, summary, diagram);
await sendToTeams(webhookUrl, card);

if (autoDocFullyConfigured) {
  console.log(`[pr-notify] Auto-doc summary: diagram=${Boolean(diagram)}, listItem=${listItemPosted}`);
}
