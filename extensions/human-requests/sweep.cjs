// Expire only this extension's own requests. Dagu remains the source of truth.
async function sweep(env = process.env, fetcher = fetch, now = Date.now()) {
  const {FYSO_DAGU_PORT: port, FYSO_ADMIN_USER: user, FYSO_ADMIN_PASSWORD: password} = env;
  if (!/^\d+$/.test(port || '') || !user || !password) throw Error('Dagu project credentials are unavailable');
  const headers = {Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64'), 'Content-Type': 'application/json'};
  const base = `http://127.0.0.1:${port}/api/v1`;
  async function api(path, init = {}) {
    const response = await fetcher(base + path, {headers, signal: AbortSignal.timeout(10000), ...init});
    if (!response.ok) { const error = Error(`Dagu request failed (${response.status})`); error.status = response.status; throw error; }
    return response.json();
  }
  let cursor = '', expired = 0, resumed = 0, failures = 0;
  const seen = new Set();
  do {
    const page = await api('/dag-runs?' + new URLSearchParams({status: '7', labels: 'human-request', limit: '100', ...(cursor ? {cursor} : {})}));
    if (!Array.isArray(page.dagRuns)) throw Error('Invalid Dagu run list');
    for (const run of page.dagRuns) {
      if (run.name !== 'ext-human-requests-request' || !run.dagRunId) continue;
      const labels = Array.isArray(run.labels) ? run.labels : [];
      const deadlines = labels.filter(label => label.startsWith('deadline='));
      if (deadlines.length !== 1 || !/^deadline=\d{1,12}$/.test(deadlines[0])) continue;
      const deadline = Number(deadlines[0].slice('deadline='.length)) * 1000;
      if (!Number.isFinite(deadline) || deadline > now) continue;
      const path = `/dag-runs/${encodeURIComponent(run.name)}/${encodeURIComponent(run.dagRunId)}`;
      try {
        // A prior 503 may have stored a human or expiry answer. Never replace it.
        const detail = (await api(path)).dagRunDetails;
        if (!detail || !Array.isArray(detail.nodes)) throw Error('Invalid Dagu run detail');
        if (detail.humanTaskResumePending === true) {
          await api(`${path}/human-tasks/resume`, {method:'POST', body:'{}'});
          resumed++;
          continue;
        }
        const ask = detail.nodes.find(node => node.step?.id === 'ask');
        if (!ask || typeof ask.statusLabel !== 'string') throw Error('Invalid Dagu human task');
        if (String(ask?.statusLabel || '').toLowerCase() !== 'waiting') continue;
        await api(`${path}/human-tasks/ask/complete`, {method:'POST', body:JSON.stringify({answer:'', comment:'', responder:'system', decision:'expired'})});
        expired++;
      } catch (error) {
        // A human may answer after the detail read. Other failures are counted;
        // continue the page so one problematic run cannot starve the rest.
        if (error.status !== 409) failures++;
      }

    }
    cursor = page.nextCursor || '';
    if (cursor && seen.has(cursor)) throw Error('Dagu returned a repeated cursor');
    seen.add(cursor);
  } while (cursor);
  console.log(JSON.stringify({expired,resumed,failures}));
  if (failures) throw Error('One or more overdue requests could not be processed');
}
if (require.main === module) sweep().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {sweep};
