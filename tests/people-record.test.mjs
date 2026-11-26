import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePerson, isManaged, personContent, writeProblem} from '../extensions/human-requests/panel/people-record.js';

test('parsePerson accepts a manual record', () => {
  assert.deepEqual(parsePerson('{"version":1,"name":"Ana"}\n'), {version: 1, name: 'Ana'});
});

test('parsePerson tolerates the fields of a Biz record', () => {
  const record = parsePerson(JSON.stringify({version: 1, name: 'Ana Pérez', source: 'biz', biz_id: '42'}));
  assert.equal(record.name, 'Ana Pérez');
  assert.equal(record.biz_id, '42');
});

test('parsePerson rejects invalid records', () => {
  for (const content of [undefined, 'null', '[]', '{"version":2,"name":"Ana"}', '{"version":1}', '{"version":1,"name":"  "}']) {
    assert.throws(() => parsePerson(content), content);
  }
  assert.throws(() => parsePerson('not json'));
});

test('isManaged is true only for source "biz"', () => {
  assert.equal(isManaged({version: 1, name: 'Ana', source: 'biz', biz_id: '42'}), true);
  assert.equal(isManaged({version: 1, name: 'Ana'}), false);
  assert.equal(isManaged({version: 1, name: 'Ana', source: 'manual'}), false);
  assert.equal(isManaged({version: 1, name: 'Ana', source: 'BIZ'}), false);
  assert.equal(isManaged(null), false);
  assert.equal(isManaged(undefined), false);
});

test('personContent writes only version and name', () => {
  const content = personContent('Ana');
  assert.equal(content, '{"version":1,"name":"Ana"}\n');
  const record = parsePerson(content);
  assert.equal(isManaged(record), false);
  assert.deepEqual(Object.keys(record), ['version', 'name']);
});

test('writeProblem refuses Biz records and changed records', () => {
  const listed = {id: 'fyso-people/x', content: '{"version":1,"name":"Ana"}\n', managed: false};
  assert.equal(writeProblem(listed, {...listed}), '');
  assert.equal(writeProblem(listed, {...listed, content: '{"version":1,"name":"Ana B"}\n'}), 'changed');
  const synced = '{"version":1,"name":"Ana","source":"biz","biz_id":"42"}';
  assert.equal(writeProblem(listed, {...listed, content: synced, managed: true}), 'locked');
  assert.equal(writeProblem({...listed, content: synced, managed: true}, {...listed, content: synced, managed: true}), 'locked');
});
