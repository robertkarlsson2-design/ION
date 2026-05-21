# .def Format — Minimal Declarative Intent Files

`.def` files express *what* code should do. The `ion gen` command expands them to idiomatic TypeScript. The AI writes `.def`; humans and tools read `.ts`.

## Core principle

Only write what the generator cannot infer. Everything structural (error handling, try/catch, async wrappers, import statements, loading state, response envelope) is a default.

## Pattern 1: Route handlers

```
/basepath  [auth]
  METHOD /subpath  serviceFn(args)  [-> data|STATUS]  [uuid:param]
```

**Header:** `/basepath` sets the Express Router mount point. `auth` means all routes require `req.user`.

**Per-route line:**
- `METHOD` — `GET`, `POST`, `PUT`, `PATCH`, `DEL`
- `/subpath` — path relative to base; `:param` segments are path params
- `serviceFn(args)` — service function + arg list. Arg sources:
  - `userId` → `req.user.id`
  - `:param` → `req.params.param`
  - `body.field` → `req.body?.field`
  - `?field` → `req.query?.field`
- `-> data` (default) → `res.json({ data })`
- `-> 204` → `res.status(204).send()`
- `-> 201` → `res.status(201).json({ data: result })`
- `uuid:param` — adds `isUuid(param)` guard → 400 on failure

**Generator adds automatically:** `import { Router }`, service imports, sanitize import, `try/catch/next`, response envelope.

**Example:**
```
/friends  auth
  GET  /                    listFriends(userId)                          -> data
  DEL  /:targetId           unfriend(userId, :targetId)                  -> 204  uuid:targetId
  POST /requests            sendFriendRequest(userId, body.addresseeEmail) -> 201
  POST /requests/:id/accept acceptRequest(:id, userId)                   -> 200  uuid:id
```

---

## Pattern 2: Service DB queries

```
query fnName(param1, param2)
  SQL: SELECT ...
  -> rows | first | null | ok | ERR_CODE

transaction fnName(params)
  SQL STATEMENT 1 [RETURNING col]
  SQL STATEMENT 2
  -> ok | ERR_CODE
```

**Return types:**
- `-> rows` — `Promise<any[]>`, returns `r.rows`
- `-> first | null` — `Promise<any | null>`, returns `r.rows[0] ?? null`
- `-> void` — no return value
- `-> ok | ERR_CODE` — `Promise<{ ok: true } | { err: 'ERR_CODE' }>`, checks `rowCount`

**transaction:** uses `pool.connect()` + `BEGIN/COMMIT/ROLLBACK/release`. A `RETURNING col` clause auto-declares `const colName = r.rows[0].col` for use in subsequent statements as `$colName`.

**Example:**
```
query listFriends(userId)
  SQL: SELECT u.id, u.email FROM user_friends uf JOIN users u ON u.id=uf.friend_id WHERE uf.user_id=$1
  -> rows

transaction acceptRequest(requestId, addresseeId)
  UPDATE friend_requests SET state='accepted' WHERE id=$1 AND addressee_id=$2 RETURNING requester_id
  INSERT INTO user_friends VALUES ($requesterId, $2), ($2, $requesterId) ON CONFLICT DO NOTHING
  -> ok | NOT_FOUND
```

---

## Pattern 3: React feature screens

```
ComponentName
  load:
    varName <- METHOD /path
  actions:
    actionName(params) -> METHOD /path/:param -> reload
  render: @custom
```

**load:** each line fetches data on mount. Multiple lines run in parallel (`Promise.all`). Variable name determines the state variable and setter (`friends` → `friends`, `setFriends`).

**actions:** `-> reload` calls `load()` after the API call. Path params (`:param`) are interpolated from the function arguments. Non-path params become request body.

**render: @custom** — the generator emits a `// @custom` comment placeholder. The developer (or AI) fills in the JSX. Use plain TypeScript for complex render logic.

**Generator adds automatically:** `useState`, `useCallback`, `useEffect`, loading state, parallel fetch wiring, action handlers.

**Example:**
```
Friends
  load:
    friends <- GET /friends
    pending <- GET /friends/requests?direction=incoming
  actions:
    accept(requestId)  -> POST /friends/requests/:requestId/accept  -> reload
    decline(requestId) -> POST /friends/requests/:requestId/decline -> reload
    unfriend(friendId) -> DEL  /friends/:friendId                   -> reload
  render: @custom
```

---

## Pattern 4: Paginated admin lists

```
ComponentName  /admin/path  paginated  [search]  [filter=field[val1|val2]]
  columns: field1 field2 field3
  row-actions: action1  action2
```

**Options:**
- `paginated` — adds page/pageSize/total state + page controls
- `search` — adds debounced search input (300ms) that resets page
- `filter=role[user|admin]` — adds filter buttons, passes as query param

**Generator adds:** DataTable component wiring, useEffect with all filter deps, page reset on filter change, ConfirmDialog for row actions.

---

## Escape hatch: @raw

When code doesn't fit a pattern, use a `@raw` block. The generator passes it through verbatim:

```
@raw
const result = await stripe.paymentIntents.create({
  amount: cents,
  currency: 'sek',
  customer: customerId,
});
@end
```

---

## File naming

| Input | Output |
|---|---|
| `routes/friends.def` | `routes/friends.ts` |
| `services/friends.def` | `services/friends.ts` |
| `screens/Friends.def` | `screens/Friends.ts` |

## CLI usage

```bash
ion gen                    # process all .def files from current directory
ion gen src/routes/        # process .def files under src/routes/
ion gen src/routes/friends.def  # single file
ion gen --watch            # watch mode
```

## Token savings

Based on real TWF files (cl100k_base tokenizer):

| Pattern | .def tokens | Generated .ts tokens | Original hand-written .ts |
|---|---|---|---|
| Route (6 handlers) | ~35 | ~180 | ~180 |
| Service (4 queries) | ~60 | ~160 | ~160 |
| Screen (3 loads, 3 actions) | ~40 | ~120 | ~200+ |

**The AI writes 35 tokens. The user gets 180 tokens of correct TypeScript.**

## Decision guide

Use `.def` when:
- The code follows one of the 4 patterns above
- The structure is the same as existing files in the same directory

Use plain TypeScript when:
- Complex business logic (payment flows, permission checks, data transformations)
- Third-party library integration (Stripe, SendGrid, etc.)
- Unusual response shapes or error structures
- One-off handlers that don't share the CRUD structure
