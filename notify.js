import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// --- 2. Determine webhook URL ---

let webhookUrl = process.env.TEAMS_WEBHOOK_URL;
let config = {};

if (!webhookUrl) {
  try {
    config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
    webhookUrl = config.teamsWebhookUrl;
  } catch (e) {
    console.error('[pr-notify] Could not read config.json:', e.message);
    console.error('[pr-notify] Set TEAMS_WEBHOOK_URL env var or create config.json.');
    process.exit(1);
  }
}

if (!webhookUrl || webhookUrl === 'YOUR_TEAMS_WEBHOOK_URL_HERE') {
  console.error('[pr-notify] Teams webhook URL not configured.');
  console.error('[pr-notify] Edit config.json and set your webhook URL, or run setup.sh.');
  process.exit(1);
}

// Check repo allowlist
if (config.notifyAllRepos === false) {
  const repos = (config.repos || []).map(r => r.toLowerCase());
  if (!repos.includes(prData.repo.toLowerCase())) {
    console.log(`[pr-notify] Skipping: ${prData.repo} is not in the repo allowlist.`);
    process.exit(0);
  }
}

// --- 3. Generate plain English summary ---

function generateSummary(filesStr, additions, deletions) {
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

// --- 4. Build Adaptive Card ---

function buildCard(prData, summary) {
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

  // Format date
  const date = new Date(prData.createdAt);
  const formattedDate = date.toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

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
          body: [
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
          ],
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

// --- 6. Execute ---

const summary = generateSummary(prData.files, prData.additions, prData.deletions);
const card = buildCard(prData, summary);
await sendToTeams(webhookUrl, card);
