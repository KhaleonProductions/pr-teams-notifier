import { query } from '@anthropic-ai/claude-agent-sdk';
import { retryOnce } from './retry.js';

const FEATURE_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'A 2-4 sentence description of what this feature does and how its parts connect.',
    },
    mermaid: {
      type: 'string',
      description:
        "A Mermaid `flowchart TD` (top-down) showing the feature's components and data flow. Use simple node IDs and short labels. No styling/classDef.",
    },
  },
  required: ['summary', 'mermaid'],
};

/**
 * Consume the SDK async-iterable and return the first StructuredOutput tool call found.
 * Also captures the final `result` message for richer error diagnostics.
 *
 * @param {AsyncIterable<object>} sdkResult
 * @returns {Promise<object>} structuredOutput input
 */
async function extractStructuredOutput(sdkResult) {
  let structuredOutput = null;
  let lastResultMessage = null;

  for await (const msg of sdkResult) {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && block.name === 'StructuredOutput' && block.input) {
          structuredOutput = block.input;
        }
      }
    }
    if (msg.type === 'result') {
      lastResultMessage = msg;
    }
  }

  if (!structuredOutput) {
    const errInfo =
      lastResultMessage?.subtype ||
      (lastResultMessage?.is_error ? 'is_error=true' : null) ||
      'no result message';
    throw new Error(`SDK returned no StructuredOutput tool call (${errInfo})`);
  }

  return structuredOutput;
}

/**
 * Strip Mermaid style directives (`style`, `classDef`, `class` lines) for a
 * simplified fallback that mermaid.ink is more likely to render successfully.
 *
 * @param {string} mermaid
 * @returns {string}
 */
function stripMermaidStyles(mermaid) {
  return mermaid
    .split('\n')
    .filter((line) => !/^\s*(style|classDef|class)\s/.test(line))
    .join('\n');
}

/**
 * Encode a Mermaid string as base64url for use in a mermaid.ink URL.
 *
 * @param {string} mermaid
 * @returns {string}
 */
function mermaidToBase64url(mermaid) {
  return Buffer.from(mermaid, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Fetch a PNG from mermaid.ink for the given Mermaid source.
 * On a non-OK response, retries once with styles stripped.
 *
 * @param {string} mermaid
 * @returns {Promise<Buffer>}
 */
async function fetchMermaidPng(mermaid) {
  const buildUrl = (src) =>
    `https://mermaid.ink/img/${mermaidToBase64url(src)}?type=png&theme=default&bgColor=ffffff`;

  let pngResponse = await fetch(buildUrl(mermaid));

  if (!pngResponse.ok) {
    const status = pngResponse.status;
    const body = await pngResponse.text();
    console.warn(
      `  mermaid.ink returned ${status} on first attempt — retrying with styles stripped. Body: ${body.slice(0, 200)}`,
    );

    const simplified = stripMermaidStyles(mermaid);
    pngResponse = await fetch(buildUrl(simplified));

    if (!pngResponse.ok) {
      const retryBody = await pngResponse.text();
      throw new Error(
        `mermaid.ink returned ${pngResponse.status} on retry: ${retryBody.slice(0, 300)}`,
      );
    }
  }

  const pngBuffer = Buffer.from(await pngResponse.arrayBuffer());
  if (pngBuffer.length === 0) {
    throw new Error('mermaid.ink returned empty PNG');
  }
  return pngBuffer;
}

export async function generateFeatureDiagram({ feature, surfaceFiles }) {
  const surfaceBlob = surfaceFiles
    .map((f) => `=== ${f.path} ===\n${f.content}`)
    .join('\n\n');

  const prompt = `You are documenting a software feature for an engineering catalog.

Feature: ${feature.displayName} (slug: ${feature.slug})
Stated description: ${feature.description ?? '(none)'}

Below is the full source code of every file in this feature's surface:

${surfaceBlob}

Produce a JSON object with:
- "summary": 2-4 sentences. What does this feature do? How do the files connect?
- "mermaid": a Mermaid flowchart TD showing the components and the data flow between them. Use the actual file/module names. Keep it under 15 nodes.`;

  // Wrap Claude SDK call in retryOnce — diagram is paramount.
  const structuredOutput = await retryOnce(
    async () => {
      // query() returns an async iterable of SDK messages. Structured output is
      // delivered as a StructuredOutput tool_use block.
      const sdkResult = query({
        prompt,
        options: {
          outputFormat:    { type: 'json_schema', schema: FEATURE_SUMMARY_SCHEMA },
          tools:           [],
          settingSources:  [],
          allowedTools:    [],
          permissionMode:  'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxTurns:        3,
          // Override SDK auto-detection of the Claude Code binary path. The
          // SDK's libc heuristic mis-identifies glibc Ubuntu runners as musl
          // on some images, leading to "Claude Code native binary not found"
          // when the corresponding platform package isn't installed. Setting
          // this env in CI sidesteps that detection entirely.
          ...(process.env.CLAUDE_CODE_EXECUTABLE
            ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE }
            : {}),
        },
      });
      return extractStructuredOutput(sdkResult);
    },
    {
      onRetry: (err) =>
        console.warn(`  Claude SDK attempt failed (${err.message}), retrying in 1 s…`),
    },
  );

  const { summary, mermaid } = structuredOutput;
  if (typeof summary !== 'string' || typeof mermaid !== 'string') {
    throw new Error('SDK response missing summary or mermaid fields');
  }
  if (!/^\s*flowchart\s/i.test(mermaid)) {
    throw new Error(`mermaid did not start with "flowchart ": ${mermaid.slice(0, 60)}`);
  }

  // Render Mermaid → PNG via mermaid.ink (with style-strip retry built in).
  const pngBuffer = await fetchMermaidPng(mermaid);

  return {
    summary,
    mermaid,
    pngBuffer,
  };
}
