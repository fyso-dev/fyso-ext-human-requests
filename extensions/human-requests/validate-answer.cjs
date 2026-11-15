// Verify the immutable run's declared choices before any answer leaves Dagu.
// Completing a human task stores its input first; a rejected answer cannot be
// edited in place and the operator must create a replacement request.
const {TextDecoder} = require('node:util');

// The run as Dagu holds it: the authority for labels, whatever the caller sent.
async function readRun(id, env = process.env, fetcher = fetch) {
  const port = env.FYSO_DAGU_PORT;
  const user = env.FYSO_ADMIN_USER;
  const password = env.FYSO_ADMIN_PASSWORD;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
      !/^\d+$/.test(port || '') || +port < 1 || +port > 65535 || !user || !password) {
    throw Error('Cannot validate request');
  }

  let details;
  try {
    const result = await fetcher(`http://127.0.0.1:${port}/api/v1/dag-runs/ext-human-requests-request/${encodeURIComponent(id)}`, {
      headers: {Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')},
      signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) throw Error('unavailable');
    const text = await result.text();
    if (Buffer.byteLength(text) > 1024 * 1024) throw Error('oversize');
    details = JSON.parse(text).dagRunDetails;
  } catch { throw Error('Cannot validate request'); }
  if (!details || details.name !== 'ext-human-requests-request' || details.dagRunId !== id ||
      !Array.isArray(details.labels) || !details.labels.every(label => typeof label === 'string') ||
      !details.labels.includes('human-request')) throw Error('Cannot validate request');
  return details;
}

// The choices of a run, or null when it declares none.
function declaredChoices(labels) {
  const encodedLabels = labels.filter(label => label.startsWith('choices-hex='));
  if (encodedLabels.length > 1) throw Error('Invalid request choices');
  if (!encodedLabels.length) return null;
  const encoded = encodedLabels[0].slice('choices-hex='.length);
  if (encoded.length > 65536 || !/^(?:[0-9a-f]{2})+$/i.test(encoded)) throw Error('Invalid request choices');
  let choices;
  try {
    choices = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.from(encoded, 'hex')));
  } catch { throw Error('Invalid request choices'); }
  if (!Array.isArray(choices) || !choices.every(choice => typeof choice === 'string' && choice.trim())) throw Error('Invalid request choices');
  return choices;
}

async function validateAnswer(response, env = process.env, fetcher = fetch) {
  const details = await readRun(response.requestId, env, fetcher);

  if (response.decision === 'answered') {
    const choices = declaredChoices(details.labels);
    if (typeof response.responder !== 'string' || !response.responder.trim() ||
        typeof response.answer !== 'string' || !response.answer.trim() ||
        (choices && choices.length && !choices.includes(response.answer))) throw Error('Invalid request answer');
  } else if (response.decision === 'cancelled' || response.decision === 'expired') {
    if (response.answer !== '' || typeof response.responder !== 'string' ||
        (response.decision === 'expired' ? response.responder !== 'system' : !response.responder.trim())) {
      throw Error('Invalid request answer');
    }
  } else throw Error('Invalid request decision');
}

module.exports = {validateAnswer, readRun, declaredChoices};
