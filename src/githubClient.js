const GH = 'https://api.github.com';

function ghHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function getPRFiles({ token, owner, repo, prNumber }) {
  const url = `${GH}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`getPRFiles ${res.status}: ${await res.text()}`);
  const files = await res.json();
  return files.map((f) => f.filename);
}

export async function* listMergedPRs({ token, owner, repo }) {
  let page = 1;
  while (true) {
    const url = `${GH}/repos/${owner}/${repo}/pulls?state=closed&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: ghHeaders(token) });
    if (!res.ok) throw new Error(`listMergedPRs page ${page} ${res.status}: ${await res.text()}`);
    const prs = await res.json();
    if (prs.length === 0) return;
    for (const pr of prs) {
      if (pr.merged_at) {
        yield {
          number: pr.number,
          title: pr.title,
          author: pr.user?.login,
          mergedAt: pr.merged_at,
          mergeCommitSha: pr.merge_commit_sha,
        };
      }
    }
    page += 1;
  }
}
