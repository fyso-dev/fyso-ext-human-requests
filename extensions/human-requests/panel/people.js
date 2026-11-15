// A descriptive directory of the people who share the project's access: names
// with stable IDs, one Dagu wiki page each. It creates no accounts and proves
// no identity; requests use the ID as their recipient.
const {mountExtensionPage, createElement: h, useState, useEffect, useTranslation} = await import('/assets/extension-sdk.js');
const messages = Object.fromEntries(await Promise.all(['es', 'en'].map(async lang => [lang, await (await fetch(`./locales/${lang}.json`)).json()])));
const prefix = 'fyso-people/';
const idPattern = /^fyso-people\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const pageUrl = id => `/api/dagu/wiki/page?path=${encodeURIComponent(id)}`;
const jsonHeaders = {'Content-Type': 'application/json'};
async function request(url, init) {
  const response = await fetch(url, {credentials: 'same-origin', cache: 'no-store', ...init});
  if (response.status === 401) window.dispatchEvent(new Event('fyso-session-expired'));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}
async function readPerson(id) {
  const data = await (await request(pageUrl(id))).json();
  if (typeof data.content !== 'string') throw new Error('Invalid person');
  const record = JSON.parse(data.content);
  if (record.version !== 1 || typeof record.name !== 'string' || !record.name.trim()) throw new Error('Invalid person');
  return {id, name: record.name, content: data.content};
}
async function listPeople() {
  const ids = [];
  for (let page = 1; page <= 100; page++) {
    const query = new URLSearchParams({flat: 'true', prefix: prefix.slice(0, -1), page: String(page), perPage: '100'});
    const data = await (await request(`/api/dagu/wiki?${query}`)).json();
    if (!Array.isArray(data.items) || typeof data.pagination?.hasNextPage !== 'boolean') throw new Error('Invalid directory');
    ids.push(...data.items.map(item => item.id).filter(id => typeof id === 'string' && idPattern.test(id)));
    if (!data.pagination.hasNextPage) return (await Promise.all(ids.map(readPerson))).sort((a, b) => a.name.localeCompare(b.name));
  }
  throw new Error('Directory exceeds page limit');
}
const content = name => JSON.stringify({version: 1, name}) + '\n';

function People() {
  const {t} = useTranslation();
  const [people, setPeople] = useState(null), [error, setError] = useState('');
  const [editing, setEditing] = useState(null), [name, setName] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(false), [removing, setRemoving] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => { let active = true; setPeople(null); listPeople().then(data => { if (active) setPeople(data); }).catch(() => { if (active) setError('error'); }); return () => { active = false; }; }, [generation]);
  // The wiki has no compare-and-swap: re-read just before writing to narrow the race.
  const unchanged = async person => { try { return (await readPerson(person.id)).content === person.content; } catch { return false; } };
  const save = async event => {
    event.preventDefault(); const value = name.trim(); if (!value || value.length > 80 || !editing || busy) return;
    setBusy(true); setError(''); setNotice(false);
    try {
      if (editing === 'new') await request('/api/dagu/wiki', {method: 'POST', headers: jsonHeaders, body: JSON.stringify({id: prefix + crypto.randomUUID(), content: content(value)})});
      else {
        if (!await unchanged(editing)) { setError('changed'); return; }
        await request(pageUrl(editing.id), {method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({content: content(value)})});
      }
      setEditing(null); setNotice(true); setGeneration(v => v + 1);
    } catch { setError('error'); } finally { setBusy(false); }
  };
  const remove = async person => {
    if (busy) return;
    setBusy(true); setError(''); setNotice(false);
    try {
      if (!await unchanged(person)) { setError('changed'); return; }
      await request(pageUrl(person.id), {method: 'DELETE'}); setNotice(true); setGeneration(v => v + 1);
    } catch { setError('error'); } finally { setBusy(false); setRemoving(''); }
  };
  return h('main', {className: 'people-page'},
    h('header', null, h('h1', null, t('people.title')), h('p', null, t('people.intro'))),
    h('p', {className: 'pending-note'}, t('people.shared')),
    error && h('p', {role: 'alert'}, t(`people.${error}`), ' ', h('button', {className: 'btn btn-soft', type: 'button', onClick: () => { setError(''); setEditing(null); setGeneration(v => v + 1); }}, t('people.retry'))),
    notice && h('p', {role: 'status'}, t('people.saved')),
    !people ? (!error && h('p', {role: 'status'}, t('people.loading'))) : [
      !people.length ? h('p', {key: 'empty'}, t('people.empty')) : h('ul', {key: 'list', className: 'people-list'}, ...people.map(person => h('li', {className: 'card people-row', key: person.id},
        h('span', null, h('strong', null, person.name), h('small', null, `${t('people.id')}: ${person.id.slice(prefix.length)}`)),
        removing === person.id ? h('span', {className: 'people-actions'}, t('people.removeConfirm', {name: person.name}), h('button', {className: 'btn btn-soft', type: 'button', disabled: busy, onClick: () => remove(person)}, t('people.removeYes')), h('button', {className: 'btn btn-soft', type: 'button', onClick: () => setRemoving('')}, t('people.cancel'))) :
          h('span', {className: 'people-actions'}, h('button', {className: 'btn btn-soft', type: 'button', disabled: busy, onClick: () => { setEditing(person); setName(person.name); setNotice(false); }}, t('people.edit')), h('button', {className: 'btn btn-soft', type: 'button', disabled: busy, onClick: () => setRemoving(person.id)}, t('people.remove')))))),
      !editing && h('button', {key: 'add', type: 'button', className: 'btn btn-pri', disabled: busy, onClick: () => { setEditing('new'); setName(''); setNotice(false); }}, t('people.add')),
      editing && h('form', {key: 'editor', className: 'card people-editor', onSubmit: save},
        h('h2', null, t(editing === 'new' ? 'people.add' : 'people.edit')),
        h('label', {htmlFor: 'people-name'}, t('people.name')), h('input', {id: 'people-name', value: name, maxLength: 80, required: true, onChange: e => setName(e.target.value)}),
        h('div', {className: 'people-actions'}, h('button', {type: 'button', className: 'btn btn-soft', disabled: busy, onClick: () => setEditing(null)}, t('people.cancel')), h('button', {type: 'submit', className: 'btn btn-pri', disabled: busy || !name.trim()}, t('people.save'))))]);
}
mountExtensionPage(People, messages);
