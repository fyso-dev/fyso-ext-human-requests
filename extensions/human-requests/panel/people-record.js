// Pure helpers for `fyso-people/<uuid>` wiki records, shared by the People page
// and its tests. A record is `{"version":1,"name":"..."}`; other fields are
// tolerated. Records synced by the fyso-ext-biz extension also carry
// `"source":"biz"` and `"biz_id"`: they mirror the Fyso Biz project and are
// managed there, so this extension never edits or removes them and never
// writes those fields itself.

// Parses a record's page content; throws when it is not a valid person.
export function parsePerson(content) {
  if (typeof content !== 'string') throw new Error('Invalid person');
  const record = JSON.parse(content);
  if (!record || typeof record !== 'object' || record.version !== 1 || typeof record.name !== 'string' || !record.name.trim()) throw new Error('Invalid person');
  return record;
}

// True for records owned by Fyso Biz, which are read-only here.
export const isManaged = record => Boolean(record) && record.source === 'biz';

// The content this extension writes: only `version` and `name`.
export const personContent = name => JSON.stringify({version: 1, name}) + '\n';

// Decides whether a write to `original` (as listed) may go ahead, given the
// record re-read just before it: '' to proceed, 'locked' when the fresh record
// is managed by Fyso Biz, 'changed' when it differs from what was listed.
export const writeProblem = (original, fresh) => fresh.managed ? 'locked' : fresh.content === original.content ? '' : 'changed';
