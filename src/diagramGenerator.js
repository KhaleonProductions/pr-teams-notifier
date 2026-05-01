import { query } from '@anthropic-ai/claude-agent-sdk';

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

  // query() returns an async iterable of SDK messages. Structured output is
  // delivered as a StructuredOutput tool_use block — same pattern as notify.js aiGenerate().
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

  const { summary, mermaid } = structuredOutput;
  if (typeof summary !== 'string' || typeof mermaid !== 'string') {
    throw new Error('SDK response missing summary or mermaid fields');
  }
  if (!/^\s*flowchart\s/i.test(mermaid)) {
    throw new Error(`mermaid did not start with "flowchart ": ${mermaid.slice(0, 60)}`);
  }

  // Render Mermaid → PNG via mermaid.ink.
  // Encode as plain base64url (same approach as notify.js buildDiagramUrl).
  const plainEncoded = Buffer.from(mermaid, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const url = `https://mermaid.ink/img/${plainEncoded}?type=png&theme=default&bgColor=ffffff`;
  const pngResponse = await fetch(url);
  if (!pngResponse.ok) {
    throw new Error(`mermaid.ink returned ${pngResponse.status}: ${await pngResponse.text()}`);
  }
  const pngBuffer = Buffer.from(await pngResponse.arrayBuffer());
  if (pngBuffer.length === 0) {
    throw new Error('mermaid.ink returned empty PNG');
  }

  return {
    summary,
    mermaid,
    pngBuffer,
  };
}
