// The SDK supplies rendering, language and theme. Its Dagu client does not expose
// human tasks, so use the existing same-origin gateway for these native endpoints.
const sdk = await import('/assets/extension-sdk.js');
const {mountExtensionPage, createElement: h, useState, useRef, useEffect, useTranslation, useStore} = sdk;
const messages = Object.fromEntries(await Promise.all(['es', 'en'].map(async lang => [lang, await (await fetch(`./locales/${lang}.json`)).json()])));
const enc = encodeURIComponent;
const REQUEST = 'ext-human-requests-request';
async function api(path, init = {}) {
  const response = await fetch(`/api/dagu/${path}`, {credentials: 'same-origin', cache: 'no-store', ...init});
  if (response.status === 401) window.dispatchEvent(new Event('fyso-session-expired'));
  if (!response.ok) { const error = new Error(`HTTP ${response.status}`); error.status = response.status; throw error; }
  return response.json();
}
const post = (path, body) => api(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
const runPath = run => `dag-runs/${enc(run.name)}/${enc(run.dagRunId)}`;
// The panel's menu counter reads the same runs; tell it when one changes.
const changed = () => { try { sdk.refreshBadges?.(); } catch { /* an older panel has no counters */ } };
async function listRequests() {
  const results = [];
  let cursor = '';
  const seen = new Set();
  do {
    const query = new URLSearchParams({status: '7', labels: 'human-request', limit: '100'});
    if (cursor) query.set('cursor', cursor);
    const page = await api(`dag-runs?${query}`);
    if (!Array.isArray(page.dagRuns)) throw new Error('Invalid response');
    results.push(...page.dagRuns);
    cursor = page.nextCursor || '';
    if (cursor && seen.has(cursor)) throw new Error('Repeated cursor');
    seen.add(cursor);
  } while (cursor);
  return results;
}
// Keep the recent activity bounded. Details are fetched only when opened.
async function listHistory() {
  const results = [], seen = new Set();
  let cursor = '', pages = 0, omitted = false;
  do {
    const query = new URLSearchParams({labels: 'human-request', limit: '50'});
    if (cursor) query.set('cursor', cursor);
    const page = await api(`dag-runs?${query}`);
    if (!Array.isArray(page.dagRuns)) throw new Error('Invalid response');
    for (const [index, run] of page.dagRuns.entries()) {
      const status = String(run.statusLabel || '').toLowerCase().replace(/[ _-]/g, '');
      if (['succeeded', 'failed', 'rejected', 'aborted', 'cancelled'].includes(status)) results.push(run);
      if (results.length >= 20) {omitted = index < page.dagRuns.length - 1; break;}
    }
    cursor = page.nextCursor || '';
    if (cursor && seen.has(cursor)) throw new Error('Repeated cursor');
    seen.add(cursor);
  } while (cursor && ++pages < 5 && results.length < 20);
  return {runs: results, truncated: Boolean(cursor) || omitted};
}
// Ignore stale history responses when a newer refresh has already started.
async function latestHistory(ref, isActive, onSuccess, onFailure) {
  const generation = ++ref.current;
  try {
    const data = await listHistory();
    if (!isActive() || generation !== ref.current) return null;
    onSuccess(data);
    return data;
  } catch {
    if (isActive() && generation === ref.current) onFailure();
    return null;
  }
}
const labelsOf = run => Array.isArray(run.labels) ? run.labels : [];
const assignee = run => labelsOf(run).find(label => label.startsWith('assignee='))?.slice(9) || 'team';
const deadline = run => { const value = labelsOf(run).find(label => /^deadline=\d{1,12}$/.test(label)); return value ? Number(value.slice(9)) * 1000 : 0; };
const personId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// The directory is optional; absence or a failed read must not hide requests.
async function listPeople() {
  const people = [];
  for (let page = 1; page <= 100; page++) {
    const query = new URLSearchParams({flat:'true', prefix:'fyso-people', page:String(page), perPage:'100'});
    const data = await api(`wiki?${query}`);
    if (!Array.isArray(data.items) || typeof data.pagination?.hasNextPage !== 'boolean') throw Error('Invalid directory');
    const ids = data.items.map(item => item.id).filter(id => typeof id === 'string' && id.startsWith('fyso-people/') && personId.test(id.slice(12)));
    const records = await Promise.all(ids.map(async id => {
      try { const page = await api(`wiki/page?path=${enc(id)}`); const data = JSON.parse(page.content); return data.version === 1 && typeof data.name === 'string' && data.name.trim() ? {id:id.slice(12),name:data.name} : null; }
      catch { return null; }
    }));
    people.push(...records.filter(Boolean));
    if (!data.pagination.hasNextPage) return people.sort((a,b)=>a.name.localeCompare(b.name));
  }
  throw Error('Directory exceeds page limit');
}
const recipientName = (run, people) => people.find(person => person.id === assignee(run))?.name || assignee(run);
// Who is looking is remembered in this browser only. It labels answers and
// narrows the list; it is not an identity check.
function loadMe() { try { const value = JSON.parse(localStorage.getItem('fyso-hr-me')); return value && typeof value.name === 'string' ? {id: typeof value.id === 'string' ? value.id : '', name: value.name} : {id:'', name:''}; } catch { return {id:'', name:''}; } }
function saveMe(me) { try { localStorage.setItem('fyso-hr-me', JSON.stringify(me)); } catch { /* storage may be unavailable */ } }
function isMine(run, me) {
  const to = assignee(run);
  if (to === 'team' || !me.name) return true;
  return to === me.id || to.toLowerCase() === me.name.trim().toLowerCase();
}
function readableDate(value, language) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(String(language || '').toLowerCase().startsWith('en') ? 'en' : 'es', {dateStyle:'medium',timeStyle:'short'}).format(date);
}
function ago(value, language) {
  const then = new Date(value).getTime();
  if (!value || Number.isNaN(then)) return '';
  const minutes = Math.round((then - Date.now()) / 60000);
  const format = new Intl.RelativeTimeFormat(String(language || '').toLowerCase().startsWith('en') ? 'en' : 'es', {numeric:'auto'});
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  if (Math.abs(minutes) < 1440) return format.format(Math.round(minutes / 60), 'hour');
  return format.format(Math.round(minutes / 1440), 'day');
}
// The request workflow puts a JSON card in the prompt; any other human task has plain text.
function parseCard(prompt) {
  try {
    const card = JSON.parse(prompt);
    if (card?.v !== 1 || !card.request || typeof card.request.title !== 'string') return null;
    return {request: card.request, thread: Array.isArray(card.thread) ? card.thread : [], canAsk: card.canAsk === true, blocking: card.blocking === true};
  } catch { return null; }
}
const taskNode = data => {
  const nodes = data?.dagRunDetails?.nodes || [];
  const pending = data?.dagRunDetails?.humanTaskResumePending === true;
  return nodes.find(n => n.step?.humanTask && ((n.statusLabel || '').toLowerCase() === 'waiting' || (pending && (n.statusLabel || '').toLowerCase() === 'succeeded'))) || null;
};
// A successful delivery step is not proof that an agent completed its work.
function deliveryState(data) {
  const nodes = data?.dagRunDetails?.nodes;
  if (!Array.isArray(nodes)) return 'unknown';
  const node = nodes.find(item => (item.step?.id || item.step?.name) === 'deliver');
  const status = String(node?.statusLabel || '').toLowerCase().replace(/[ _-]/g, '');
  if (status === 'succeeded' || status === 'success') return 'processed';
  if (['failed', 'rejected', 'aborted', 'cancelled'].includes(status)) {
    const error = String(node?.error || '');
    if (error.includes('Invalid request answer') || error.includes('Invalid request choices')) return 'invalid';
    return 'failed';
  }
  return node ? 'pending' : 'unknown';
}
// Lists can hold many runs: limit concurrent detail requests, and discard
// queued requests when the user refreshes or leaves the page.
let detailSlots = 4;
const detailWaiters = [];
async function runDetail(run, signal) {
  if (signal?.aborted) throw Error('Request cancelled');
  if (detailSlots) detailSlots--;
  else await new Promise((resolve, reject) => {
    const next = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const cancel = () => { const index=detailWaiters.indexOf(next); if (index !== -1) detailWaiters.splice(index,1); reject(Error('Request cancelled')); };
    detailWaiters.push(next);
    signal?.addEventListener('abort', cancel, {once:true});
  });
  try { return await api(runPath(run), {signal}); }
  finally { const next = detailWaiters.shift(); if (next) next(); else detailSlots++; }
}

function Field({name, spec, required, value, change, prefix}) {
  const {t} = useTranslation();
  const title = spec.title || name;
  const options = spec.enum || (Array.isArray(spec.oneOf) ? spec.oneOf.map(o => o.const) : null);
  const props = {id: `field-${prefix}-${name}`, name, required, value: value ?? '', onChange: event => change(name, spec.type === 'boolean' && event.target.value !== '' ? event.target.value === 'true' : ['number', 'integer'].includes(spec.type) && event.target.value !== '' ? Number(event.target.value) : event.target.value)};
  let control;
  if (options || spec.type === 'boolean') {
    const choices = options || [true, false];
    control = h('select', props, h('option', {value: ''}, t('pending.choose')), ...choices.map(option => h('option', {key: String(option), value: String(option)}, String(option))));
  } else if (spec.type === 'string') control = h('textarea', {...props, rows: 3, minLength: spec.minLength, maxLength: spec.maxLength, pattern: spec.pattern});
  else control = h('input', {...props, type: 'number', step: spec.type === 'integer' ? '1' : 'any', min: spec.minimum, max: spec.maximum});
  return h('label', {className: 'pending-field', htmlFor: props.id}, h('span', null, title, required ? ` (${t('pending.required')})` : ''), spec.description && h('small', null, spec.description), control);
}

// A human task of another workflow: its own form, as Dagu declares it.
function GenericTask({run, node, onDone}) {
  const {t} = useTranslation();
  const form = node.step.humanTask.form || {properties: {}};
  const [values, setValues] = useState(() => Object.fromEntries(Object.entries(form.properties || {}).filter(([, spec]) => spec.default !== undefined).map(([key, spec]) => [key, spec.default])));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const unsupported = Object.values(form.properties || {}).some(spec => !['string','boolean','number','integer'].includes(spec.type));
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      await post(`${runPath(run)}/human-tasks/${enc(node.step.id || node.step.name)}/complete`, Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')));
      setSaved(true); changed(); onDone();
    } catch { setError('sendError'); } finally { setBusy(false); }
  };
  return h('div', {className: 'pending-generic'},
    h('p', {className: 'pending-prompt'}, node.step.humanTask.prompt),
    error && h('p', {role: 'alert'}, t(`pending.${error}`)),
    saved ? h('p', {role: 'status'}, t('pending.saved')) : unsupported ? h('p', {role: 'alert'}, t('pending.unsupported')) :
      h('form', {onSubmit: submit}, h('div', {className: 'pending-fields'}, ...Object.entries(form.properties || {}).map(([name, spec]) => h(Field, {key: name, name, spec, prefix: run.dagRunId, required: (form.required || []).includes(name), value: values[name], change: (key, value) => setValues(old => ({...old, [key]: value}))}))),
        h('div', {className: 'pending-actions'}, h('button', {className: 'btn btn-pri', disabled: busy, type: 'submit'}, t(busy ? 'pending.sending' : 'pending.submit')))));
}

function Thread({thread}) {
  const {t} = useTranslation();
  if (!thread.length) return null;
  return h('section', {className: 'pending-thread'}, h('h3', null, t('pending.thread')),
    ...thread.flatMap((entry, index) => [
      h('div', {key: `q${index}`, className: 'pending-msg pending-msg-me'}, h('small', null, entry.asker || t('pending.someone')), entry.question),
      h('div', {key: `a${index}`, className: 'pending-msg pending-msg-agent'}, h('small', null, t('pending.agent')), typeof entry.answer === 'string' ? entry.answer : t(`pending.noAnswer.${['timeout', 'no-origin'].includes(entry.reason) ? entry.reason : 'unavailable'}`)),
    ]));
}

// One request: what the agent was doing, what it needs, the choices and their
// effects, the questions asked so far, and the three things a person can do.
function Detail({run, data, me, people, onDone, reload}) {
  const {t, i18n} = useTranslation();
  const node = taskNode(data), card = node ? parseCard(node.step.humanTask.prompt) : null;
  const [mode, setMode] = useState('decide'), [answer, setAnswer] = useState(''), [comment, setComment] = useState(''), [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(''), [delivery, setDelivery] = useState(''), [confirmCancel, setConfirmCancel] = useState(false);
  const resumePending = data?.dagRunDetails?.humanTaskResumePending === true;
  useEffect(() => {
    if (!['saved', 'cancelledSaved'].includes(saved)) return;
    let active = true, timer, attempts = 0;
    const check = async () => {
      try {
        const status = deliveryState(await api(runPath(run)));
        if (!active) return;
        setDelivery(status);
        if (status === 'pending' && ++attempts < 20) timer = setTimeout(check, 3000);
      } catch { if (active) setDelivery('unknown'); }
    };
    check();
    return () => {active = false; clearTimeout(timer);};
  }, [saved, run.name, run.dagRunId]);
  // After a question, the run leaves the waiting state until the agent replies.
  useEffect(() => {
    if (saved !== 'asked') return;
    let active = true, timer, attempts = 0;
    const check = async () => {
      try {
        const current = await api(runPath(run));
        if (!active) return;
        const status = String(current?.dagRunDetails?.statusLabel || '').toLowerCase();
        if (status === 'waiting' && taskNode(current)) { setSaved(''); setQuestion(''); setMode('decide'); reload(); return; }
        if (['failed', 'aborted', 'rejected'].includes(status)) { setSaved(''); setError('askFailed'); reload(); return; }
        if (++attempts < 150) timer = setTimeout(check, 3000);
        else { setSaved(''); setError('askSlow'); }
      } catch { if (active) timer = setTimeout(check, 5000); }
    };
    timer = setTimeout(check, 1500);
    return () => {active = false; clearTimeout(timer);};
  }, [saved, run.name, run.dagRunId]);
  if (!node) return h('p', {role: 'status'}, t('pending.notWaiting'));
  if (!card) return h(GenericTask, {run, node, onDone});
  const {request, thread, canAsk} = card;
  const stepId = enc(node.step.id || node.step.name);
  const responder = me.name.trim();
  const send = async (decision) => {
    if (busy) return;
    if (!responder) { setError('responderRequired'); return; }
    if (decision === 'answered' && !answer.trim()) { setError('answerRequired'); return; }
    setBusy(true); setError('');
    try {
      await post(`${runPath(run)}/human-tasks/${stepId}/complete`, {decision, responder, ...(decision === 'answered' ? {answer} : {}), ...(comment.trim() ? {comment} : {})});
      setSaved(decision === 'cancelled' ? 'cancelledSaved' : 'saved'); changed(); onDone();
    } catch (e) {
      if (e.status === 503) { setSaved('savedResumeFailed'); changed(); onDone(); reload(); }
      else setError('sendError');
    } finally { setBusy(false); }
  };
  const ask = async event => {
    event.preventDefault(); if (busy) return;
    if (!responder) { setError('responderRequired'); return; }
    if (!question.trim()) { setError('questionRequired'); return; }
    setBusy(true); setError('');
    try {
      const iteration = Number(node.approvalIteration ?? thread.length);
      await post(`${runPath(run)}/human-tasks/${stepId}/push-back?expectedIteration=${iteration}`, {HR_QUESTION: question.trim(), HR_ASKER: responder});
      setSaved('asked'); changed();
    } catch (e) { setError(e.status === 409 ? 'changedElsewhere' : 'sendError'); if (e.status === 409) reload(); }
    finally { setBusy(false); }
  };
  const resume = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await post(`${runPath(run)}/human-tasks/resume`, {}); setSaved('resumeQueued'); changed(); onDone(); }
    catch { setError('resumeError'); } finally { setBusy(false); }
  };
  const recipient = assignee(run) === 'team' ? t('pending.team') : recipientName(run, people);
  const due = deadline(run);
  const options = request.options || [];
  const fact = (label, value) => value ? [h('dt', {key: `${label}-t`}, t(`pending.card.${label}`)), h('dd', {key: label}, value)] : [];
  return h('article', {className: 'pending-detail'},
    h('header', null,
      h('p', {className: 'pending-asker'}, t('pending.asks', {who: request.requester, to: recipient}), ' · ', ago(run.startedAt, i18n?.language), ' ', card.blocking && h('span', {className: 'pill pill-warn'}, t('pending.blocking'))),
      h('h2', null, request.title)),
    h('dl', {className: 'pending-facts'}, ...fact('doing', request.doing), ...fact('needs', request.needs), ...fact('blocked', request.blocked), ...fact('ifSilent', request.if_silent), ...(due ? fact('due', readableDate(due, i18n?.language)) : [])),
    request.links?.length > 0 && h('p', {className: 'pending-links'}, ...request.links.map(link => h('a', {key: link.url, href: link.url, target: '_blank', rel: 'noopener noreferrer'}, link.label))),
    h(Thread, {thread}),
    error && h('p', {role: 'alert'}, t(`pending.${error}`)),
    saved === 'asked' ? h('p', {className: 'pending-result', role: 'status', 'aria-live': 'polite'}, t('pending.asked')) :
    saved ? h('div', {className: 'pending-result', role: 'status', 'aria-live': 'polite'}, h('p', null, t(`pending.${saved}`)), delivery && h('p', null, t(`pending.delivery.${delivery}`))) :
    resumePending ? h('div', {className: 'pending-result', role: 'status'}, h('p', null, t('pending.resumePending')), h('button', {type:'button', className:'btn btn-pri', disabled:busy, onClick:resume}, t(busy ? 'pending.sending' : 'pending.resume'))) :
    h('div', {className: 'pending-respond'},
      canAsk ? h('div', {className: 'pending-tabs', role: 'group', 'aria-label': t('pending.actions')},
        h('button', {type: 'button', className: 'btn ' + (mode === 'decide' ? 'btn-pri' : 'btn-soft'), 'aria-pressed': mode === 'decide', onClick: () => {setMode('decide'); setError('');}}, t('pending.decide')),
        h('button', {type: 'button', className: 'btn ' + (mode === 'ask' ? 'btn-pri' : 'btn-soft'), 'aria-pressed': mode === 'ask', onClick: () => {setMode('ask'); setError('');}}, t('pending.askAgent'))) :
        h('p', {className: 'pending-note'}, t('pending.cannotAsk')),
      mode === 'ask' && canAsk ? h('form', {onSubmit: ask, className: 'pending-fields'},
        h('label', {className: 'pending-field', htmlFor: 'hr-question'}, h('span', null, t('pending.yourQuestion')), h('textarea', {id: 'hr-question', rows: 3, maxLength: 2000, value: question, onChange: e => setQuestion(e.target.value)})),
        h('p', {className: 'pending-note'}, t('pending.askHelp')),
        h('div', {className: 'pending-actions'}, h('button', {className: 'btn btn-pri', type: 'submit', disabled: busy}, t(busy ? 'pending.sending' : 'pending.sendQuestion')))) :
      h('form', {onSubmit: e => {e.preventDefault(); send('answered');}, className: 'pending-fields'},
        options.length ? h('fieldset', {className: 'pending-options'}, h('legend', null, t('pending.options')),
          ...options.map((option, index) => h('label', {key: option.choice, className: 'pending-option' + (answer === option.choice ? ' is-chosen' : ''), htmlFor: `hr-option-${index}`},
            h('input', {type: 'radio', id: `hr-option-${index}`, name: 'hr-option', value: option.choice, checked: answer === option.choice, onChange: () => setAnswer(option.choice)}),
            h('span', null, h('strong', null, option.choice), request.recommendation === option.choice && h('em', null, t('pending.recommended')), h('small', null, option.effect))))) :
          h('label', {className: 'pending-field', htmlFor: 'hr-answer'}, h('span', null, t('pending.answer')), h('textarea', {id: 'hr-answer', rows: 3, value: answer, onChange: e => setAnswer(e.target.value)})),
        h('label', {className: 'pending-field', htmlFor: 'hr-comment'}, h('span', null, t('pending.comment')), h('textarea', {id: 'hr-comment', rows: 2, value: comment, onChange: e => setComment(e.target.value)})),
        h('div', {className: 'pending-actions'},
          h('button', {className: 'btn btn-pri', type: 'submit', disabled: busy}, t(busy ? 'pending.sending' : 'pending.submit')),
          confirmCancel ? h('span', {className: 'pending-confirm'}, t('pending.cancelConfirm'), ' ', h('button', {type: 'button', className: 'btn btn-soft', disabled: busy, onClick: () => send('cancelled')}, t('pending.cancelYes')), ' ', h('button', {type: 'button', className: 'btn btn-soft', onClick: () => setConfirmCancel(false)}, t('pending.cancelNo'))) :
            h('button', {className: 'btn btn-soft', type: 'button', disabled: busy, onClick: () => setConfirmCancel(true)}, t('pending.cancelled'))),
        h('p', {className: 'pending-note'}, t('pending.signedAs', {name: responder || t('pending.nobody')})))));
}

function HistoryItem({run, people = []}) {
  const {t, i18n} = useTranslation();
  const [open, setOpen] = useState(false), [detail, setDetail] = useState(null), [error, setError] = useState(false);
  const [outputs, setOutputs] = useState(null), [outputsError, setOutputsError] = useState(false);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setError(false); setDetail(null);
    runDetail(run, controller.signal).then(data => { if (active) setDetail(data); }).catch(() => { if (active) setError(true); });
    return () => {active = false; controller.abort();};
  }, [run.name, run.dagRunId]);
  useEffect(() => {
    if (!open) return;
    let active = true; const controller = new AbortController();
    setOutputs(null); setOutputsError(false);
    api(`${runPath(run)}/outputs`, {signal: controller.signal}).then(data => { if (active) setOutputs(data?.outputs && typeof data.outputs === 'object' ? data.outputs : {}); }).catch(() => { if (active) setOutputsError(true); });
    return () => { active = false; controller.abort(); };
  }, [open, run.name, run.dagRunId]);
  const ask = detail?.dagRunDetails?.nodes?.find(node => node.step?.humanTask);
  const prompt = ask?.step?.humanTask?.prompt || '';
  const card = parseCard(prompt);
  const askStatus = String(ask?.statusLabel || '').toLowerCase();
  const state = askStatus === 'succeeded' ? deliveryState(detail) : detail ? 'notAnswered' : 'unknown';
  const recipient = assignee(run) === 'team' ? t('pending.team') : recipientName(run, people);
  const finished = readableDate(run.finishedAt, i18n?.language);
  const title = card ? card.request.title : prompt.split(/\r?\n/)[0]?.slice(0, 160);
  const keys = ['answer', 'comment', 'responder', 'decision'];
  return h('li', {className: 'pending-history-item'}, h('details', {open, onToggle: event => setOpen(event.currentTarget.open)},
    h('summary', null, h('strong', {className:'pending-history-title'}, title || (error ? t('pending.historyUnknownQuestion') : t('pending.loading'))), h('span', null, `${t('pending.for')}: ${recipient}`), finished && h('time', {dateTime: run.finishedAt}, ` · ${finished}`)),
    error ? h('p', {role:'alert'}, t('pending.detailError')) : !detail ? h('p', {role:'status'}, t('pending.loading')) : h('div', {className:'pending-history-detail'},
      card ? h('p', null, card.request.needs) : prompt && h('p', {className:'pending-prompt'}, prompt),
      card && h(Thread, {thread: card.thread}),
      h('p', {role:'status'}, t(`pending.delivery.${state}`)),
      outputsError ? h('p', {role:'alert'}, t('pending.outputsError')) : !outputs ? h('p', {role:'status'}, t('pending.loading')) :
        keys.some(key => typeof outputs[key] === 'string' && outputs[key]) ?
          h('dl', {className:'pending-history-outputs'}, ...keys.filter(key => typeof outputs[key] === 'string' && outputs[key]).flatMap(key => [h('dt', {key:`${key}-label`}, t(`pending.recorded.${key}`)), h('dd', {key}, key === 'decision' && ['answered','cancelled','expired'].includes(outputs[key]) ? t(`pending.recordedDecision.${outputs[key]}`) : outputs[key])])) :
          h('p', {className:'pending-history-note'}, t('pending.answerHistoryNote')))));
}

function Row({run, data, current, select, people}) {
  const {t, i18n} = useTranslation();
  const node = data ? taskNode(data) : null, card = node ? parseCard(node.step.humanTask.prompt) : null;
  const title = card ? card.request.title : node ? String(node.step.humanTask.prompt || '').split(/\r?\n/)[0].slice(0, 120) : t('pending.loading');
  const who = card ? card.request.requester : run.name;
  return h('li', null, h('button', {type: 'button', className: 'pending-row', 'aria-current': current ? 'true' : undefined, onClick: select},
    h('span', {className: 'pending-row-who'}, h('span', null, who), h('span', null, ago(run.startedAt, i18n?.language))),
    h('strong', null, title),
    h('span', {className: 'pending-row-meta'}, `${t('pending.for')}: ${assignee(run) === 'team' ? t('pending.team') : recipientName(run, people)}`, ' ',
      (card ? card.blocking : labelsOf(run).includes('blocking=true')) ? h('span', {className: 'pill pill-warn'}, t('pending.blocking')) : h('span', {className: 'pill'}, t('pending.canWait')))));
}

function Pending() {
  const {t} = useTranslation();
  const {project} = useStore();
  let historyUrl = '';
  try { const url = new URL(project.data?.urls?.dagu); if (['http:', 'https:'].includes(url.protocol)) historyUrl = `${url.origin}/dags/${REQUEST}`; } catch { /* project configuration is still loading */ }
  const [people, setPeople] = useState([]), [me, setMe] = useState(loadMe), [other, setOther] = useState(() => { const saved = loadMe(); return !saved.id && Boolean(saved.name); }), [scope, setScope] = useState('mine');
  const [runs, setRuns] = useState([]), [details, setDetails] = useState({}), [selected, setSelected] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState(false), [generation, setGeneration] = useState(0);
  const [history, setHistory] = useState(null), [historyError, setHistoryError] = useState(false);
  const historyGeneration = useRef(0);
  const key = run => `${run.name}/${run.dagRunId}`;
  useEffect(() => {let active = true; listPeople().then(data => {if (active) setPeople(data);}).catch(() => {if (active) setPeople([]);}); return () => {active = false;};}, [generation]);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    setError(false);
    listRequests().then(data => {
      if (!active) return;
      setRuns(data); setLoading(false);
      for (const run of data) runDetail(run, controller.signal).then(detail => { if (active) setDetails(old => ({...old, [key(run)]: detail})); }).catch(() => { if (active) setDetails(old => ({...old, [key(run)]: null})); });
    }).catch(() => { if (active) { setError(true); setLoading(false); } });
    return () => {active = false; controller.abort();};
  }, [generation]);
  useEffect(() => { let active = true; latestHistory(historyGeneration, () => active, value => {setHistory(value); setHistoryError(false);}, () => setHistoryError(true)); return () => {active = false;}; }, [generation]);
  // Requests change without this page acting: other people answer, agents reply.
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) setGeneration(value => value + 1); }, 30000); return () => clearInterval(timer); }, []);
  const reload = () => setGeneration(value => value + 1);
  const chooseMe = value => { const person = people.find(item => item.id === value); const next = person ? {id: person.id, name: person.name} : {id: '', name: ''}; setOther(value === '__other'); setMe(next); saveMe(next); };
  const holds = run => labelsOf(run).includes('blocking=true') ? 0 : 1;
  const visible = runs.filter(run => scope === 'all' || isMine(run, me)).sort((a, b) => holds(a) - holds(b) || String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const current = visible.find(run => key(run) === selected) || visible[0];
  const visibleHistory = (history?.runs || []).filter(run => scope === 'all' || isMine(run, me));
  const blocking = visible.filter(run => holds(run) === 0).length;
  return h('main', {className: 'pending-page'},
    h('header', {className: 'pending-header'}, h('h1', null, t('pending.title')), h('p', null, visible.length ? t('pending.summary', {count: visible.length, blocking}) : t('pending.intro'))),
    h('div', {className: 'pending-toolbar'},
      h('label', null, t('pending.iAm'), people.length ? h('select', {id: 'hr-me', value: me.id || (other ? '__other' : ''), onChange: e => chooseMe(e.target.value)}, h('option', {value: ''}, t('pending.chooseMe')), ...people.map(person => h('option', {key: person.id, value: person.id}, person.name)), h('option', {value: '__other'}, t('pending.otherName'))) : null,
        (!people.length || other) && h('input', {id: 'hr-me-name', type: 'text', autoComplete: 'name', maxLength: 80, placeholder: t('pending.yourName'), value: me.id ? '' : me.name, onChange: e => { const next = {id: '', name: e.target.value}; setMe(next); saveMe(next); }})),
      h('div', {className: 'pending-scope', role: 'group', 'aria-label': t('pending.show')},
        h('button', {type: 'button', className: 'btn ' + (scope === 'mine' ? 'btn-pri' : 'btn-soft'), 'aria-pressed': scope === 'mine', onClick: () => setScope('mine')}, t('pending.mine')),
        h('button', {type: 'button', className: 'btn ' + (scope === 'all' ? 'btn-pri' : 'btn-soft'), 'aria-pressed': scope === 'all', onClick: () => setScope('all')}, t('pending.everyone'))),
      h('button', {type: 'button', className: 'btn btn-soft', onClick: reload}, t('pending.refresh'))),
    loading ? h('p', {role: 'status'}, t('pending.loading')) : error ? h('p', {role: 'alert'}, t('pending.error')) : !visible.length ? h('div', {className: 'pending-empty'}, h('p', null, t('pending.empty')), h('span', null, t('pending.emptyHelp'))) :
      h('div', {className: 'pending-inbox'},
        h('ul', {className: 'pending-list'}, ...visible.map(run => h(Row, {key: key(run), run, data: details[key(run)], people, current: current && key(run) === key(current), select: () => setSelected(key(run))}))),
        h('div', {className: 'card pending-pane'}, current && (details[key(current)] === undefined ? h('p', {role: 'status'}, t('pending.loading')) : details[key(current)] === null ? h('p', {role: 'alert'}, t('pending.detailError')) :
          h(Detail, {key: key(current), run: current, data: details[key(current)], me, people, reload, onDone: () => setTimeout(reload, 4000)})))),
    h('section', {className:'pending-history', 'aria-labelledby':'history-title'}, h('h2', {id:'history-title'}, t('pending.historyTitle')),
      historyError ? h('p', {role:'alert'}, t('pending.historyError')) : !history ? h('p', {role:'status'}, t('pending.loading')) : visibleHistory.length ? h('ul', {className:'pending-history-list'}, ...visibleHistory.map(run => h(HistoryItem, {key:key(run),run, people}))) : h('p', null, t('pending.historyEmpty')),
      history?.truncated && h('p', {className:'pending-history-note'}, t('pending.historyLimited'))),
    h('footer', {className: 'pending-footer'}, h('p', null, t('pending.identity')), historyUrl && h('a', {href: historyUrl, target: '_blank', rel: 'noopener noreferrer'}, t('pending.history'))));
}
mountExtensionPage(Pending, messages);
