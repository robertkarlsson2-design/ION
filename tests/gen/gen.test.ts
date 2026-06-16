import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../src/gen/parsers/route.js';
import { generateRoute } from '../../src/gen/generators/route.js';
import { parseServiceFile } from '../../src/gen/parsers/query.js';
import { generateServiceFile } from '../../src/gen/generators/query.js';
import { parseScreen } from '../../src/gen/parsers/screen.js';
import { generateScreen } from '../../src/gen/generators/screen.js';

// ---------------------------------------------------------------------------
// Route parser + generator
// ---------------------------------------------------------------------------

describe('parseRoute', () => {
  it('parses basic GET + DELETE + POST', () => {
    const src = `/friends  auth
  GET  /              listFriends(userId)                    -> data
  DEL  /:targetId     unfriend(userId, :targetId)           -> 204  uuid:targetId
  POST /requests      sendRequest(userId, body.email)       -> 201`;

    const spec = parseRoute(src, 'friends');
    expect(spec.basePath).toBe('/friends');
    expect(spec.auth).toBe(true);
    expect(spec.handlers).toHaveLength(3);

    const [get, del, post] = spec.handlers;
    expect(get.method).toBe('GET');
    expect(get.serviceFn).toBe('listFriends');
    expect(get.returns).toEqual({ type: 'data' });

    expect(del.method).toBe('DELETE');
    expect(del.uuidParams).toContain('targetId');
    expect(del.returns).toEqual({ type: 'status', code: 204 });

    expect(post.method).toBe('POST');
    expect(post.returns).toEqual({ type: 'status', code: 201 });
    expect(post.serviceArgs.find(a => a.source === 'body')?.fieldName).toBe('email');
  });

  it('parses no-auth route', () => {
    const src = `/public\n  GET  /  getPublic()  -> data`;
    const spec = parseRoute(src, 'public');
    expect(spec.auth).toBe(false);
  });
});

describe('generateRoute', () => {
  it('generates valid Express router from simple spec', () => {
    const src = `/items  auth
  GET  /       listItems(userId)             -> data
  POST /       createItem(userId, body.name) -> 201
  DEL  /:id    deleteItem(:id, userId)       -> 204  uuid:id`;

    const spec = parseRoute(src, 'items');
    const output = generateRoute(spec);

    expect(output).toContain(`import { Router } from 'express'`);
    expect(output).toContain(`import { listItems, createItem, deleteItem }`);
    expect(output).toContain(`import { isUuid }`);
    expect(output).toContain(`router.get('/'`);
    expect(output).toContain(`router.post('/'`);
    expect(output).toContain(`router.delete('/:id'`);
    expect(output).toContain(`res.json({ data })`);
    expect(output).toContain(`res.status(204).send()`);
    expect(output).toContain(`if (!isUuid(id))`);
    expect(output).toContain(`catch (err) { next(err); }`);
    expect(output).toContain(`export { router as itemsRouter }`);
  });

  it('omits isUuid import when no uuid params', () => {
    const src = `/simple\n  GET  /  getAll()  -> data`;
    const spec = parseRoute(src, 'simple');
    const output = generateRoute(spec);
    expect(output).not.toContain('isUuid');
  });
});

// ---------------------------------------------------------------------------
// Query parser + generator
// ---------------------------------------------------------------------------

describe('parseServiceFile', () => {
  it('parses query with -> rows', () => {
    const src = `query listFriends(userId)\n  SQL: SELECT id FROM users WHERE id=$1\n  -> rows`;
    const specs = parseServiceFile(src);
    expect(specs).toHaveLength(1);
    const q = specs[0];
    expect(q.kind).toBe('query');
    if (q.kind === 'query') {
      expect(q.name).toBe('listFriends');
      expect(q.params).toEqual(['userId']);
      expect(q.returns.kind).toBe('rows');
    }
  });

  it('parses query with -> first | null', () => {
    const src = `query getById(id)\n  SQL: SELECT id FROM users WHERE id=$1\n  -> first | null`;
    const specs = parseServiceFile(src);
    expect(specs[0].kind).toBe('query');
    if (specs[0].kind === 'query') {
      expect(specs[0].returns.kind).toBe('firstOrNull');
    }
  });

  it('parses transaction with RETURNING', () => {
    const src = `transaction accept(requestId, addresseeId)
  UPDATE requests SET state='accepted' WHERE id=$1 AND addressee_id=$2 RETURNING requester_id
  INSERT INTO friends VALUES ($requesterId, $2)
  -> ok | NOT_FOUND`;
    const specs = parseServiceFile(src);
    expect(specs[0].kind).toBe('transaction');
    if (specs[0].kind === 'transaction') {
      expect(specs[0].statements[0].returningAlias).toBe('requester_id');
      expect(specs[0].returns.kind).toBe('discriminated');
    }
  });
});

describe('generateServiceFile', () => {
  it('generates pool.query wrapper for rows', () => {
    const src = `query listUsers()\n  SQL: SELECT id, email FROM users ORDER BY created_at\n  -> rows`;
    const output = generateServiceFile(parseServiceFile(src));
    expect(output).toContain(`import { pool }`);
    expect(output).toContain(`export async function listUsers`);
    expect(output).toContain(`await pool.query`);
    expect(output).toContain(`return r.rows`);
  });

  it('generates pool.query with null fallback for firstOrNull', () => {
    const src = `query getUser(id)\n  SQL: SELECT id FROM users WHERE id=$1\n  -> first | null`;
    const output = generateServiceFile(parseServiceFile(src));
    expect(output).toContain(`return r.rows[0] ?? null`);
  });

  it('generates transaction with BEGIN/COMMIT/ROLLBACK', () => {
    const src = `transaction doThing(a, b)
  UPDATE items SET done=true WHERE id=$1 RETURNING owner_id
  -> ok | NOT_FOUND`;
    const output = generateServiceFile(parseServiceFile(src));
    expect(output).toContain(`pool.connect()`);
    expect(output).toContain(`client.query('BEGIN')`);
    expect(output).toContain(`client.query('COMMIT')`);
    expect(output).toContain(`client.query('ROLLBACK')`);
    expect(output).toContain(`client.release()`);
  });
});

// ---------------------------------------------------------------------------
// Screen parser + generator
// ---------------------------------------------------------------------------

describe('parseScreen', () => {
  it('parses load + actions', () => {
    const src = `Friends
  load:
    friends <- GET /friends
    pending <- GET /friends/requests
  actions:
    accept(id) -> POST /friends/requests/:id/accept -> reload
  render: @custom`;

    const spec = parseScreen(src);
    expect(spec.name).toBe('Friends');
    expect(spec.loads).toHaveLength(2);
    expect(spec.loads[0]).toMatchObject({ varName: 'friends', method: 'GET', path: '/friends' });
    expect(spec.actions).toHaveLength(1);
    expect(spec.actions[0].name).toBe('accept');
    expect(spec.actions[0].pathParams).toContain('id');
    expect(spec.renderMode).toBe('@custom');
  });
});

describe('generateScreen', () => {
  it('generates useState, useCallback, useEffect boilerplate', () => {
    const src = `MyList
  load:
    items <- GET /items
  actions:
    remove(id) -> DEL /items/:id -> reload
  render: @custom`;

    const output = generateScreen(parseScreen(src));
    expect(output).toContain(`useState`);
    expect(output).toContain(`useCallback`);
    expect(output).toContain(`useEffect`);
    expect(output).toContain(`const [items, setItems] = useState`);
    expect(output).toContain(`const [loading, setLoading] = useState(true)`);
    expect(output).toContain(`apiGet('/items')`);
    expect(output).toContain(`apiDel`);
    expect(output).toContain(`await load()`);
    expect(output).toContain(`// @custom`);
    expect(output).toContain(`export { MyList }`);
  });

  it('uses Promise.all for multiple loads', () => {
    const src = `Multi
  load:
    a <- GET /a
    b <- GET /b
  render: @custom`;
    const output = generateScreen(parseScreen(src));
    expect(output).toContain('Promise.all');
  });
});

// ---------------------------------------------------------------------------
// Admin list parser + generator
// ---------------------------------------------------------------------------

import { parseAdminList } from '../../src/gen/parsers/adminList.js';
import { generateAdminList } from '../../src/gen/generators/adminList.js';

describe('parseAdminList', () => {
  it('parses header with paginated, search, filter', () => {
    const src = `AdminUsers  /admin/users  paginated  search  filter=role[user|admin]
  columns: email display_name role created_at
  row-actions: view  flip-role`;

    const spec = parseAdminList(src);
    expect(spec.name).toBe('AdminUsers');
    expect(spec.apiPath).toBe('/admin/users');
    expect(spec.paginated).toBe(true);
    expect(spec.search).toBe(true);
    expect(spec.filters).toEqual([{ field: 'role', values: ['user', 'admin'] }]);
    expect(spec.columns).toEqual(['email', 'display_name', 'role', 'created_at']);
    expect(spec.rowActions).toEqual(['view', 'flip-role']);
  });
});

describe('generateAdminList', () => {
  it('generates paginated list with search and filter', () => {
    const src = `AdminUsers  /admin/users  paginated  search  filter=role[user|admin]
  columns: email role created_at
  row-actions: view`;

    const output = generateAdminList(parseAdminList(src));
    expect(output).toContain(`useState`);
    expect(output).toContain(`useEffect`);
    expect(output).toContain(`useRef`);  // debounce ref
    expect(output).toContain(`apiGet`);
    expect(output).toContain(`DataTable`);
    expect(output).toContain(`page`);           // pagination
    expect(output).toContain(`setPage(1)`);     // reset on filter
    expect(output).toContain(`roleFilter`);     // filter state
    expect(output).toContain(`export { AdminUsers }`);
  });
});
