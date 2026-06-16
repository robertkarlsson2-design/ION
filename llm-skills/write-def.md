# Skill: write-def — write .def intent files for ion gen

## When to use .def vs plain TypeScript

Use `.def` for: CRUD routes, DB queries, fetch+display screens, paginated admin lists.
Use `.ts` for: payment flows, complex business logic, third-party integrations, unusual response shapes.

## Pattern 1: Route file

```
/resource  auth
  GET  /          listItems(userId)              -> data
  GET  /:id       getItem(userId, :id)           -> data   uuid:id
  POST /          createItem(userId, body.name, body.type) -> 201
  PUT  /:id       updateItem(:id, userId, body.name)       uuid:id
  DEL  /:id       deleteItem(:id, userId)        -> 204    uuid:id
```

Rules: `auth` once for all routes. `uuid:param` adds validation. `-> 204` for no-body responses. `-> 201` for created. Default `-> data` wraps in `{ data }`.

## Pattern 2: Service queries

```
query getItemById(id)
  SQL: SELECT id, name, type FROM items WHERE id=$1
  -> first | null

transaction createItem(userId, name, type)
  INSERT INTO items (owner_id, name, type) VALUES ($1, $2, $3) RETURNING id
  -> ok | DUPLICATE

query listUserItems(userId)
  SQL: SELECT id, name, type, created_at FROM items WHERE owner_id=$1 ORDER BY created_at DESC
  -> rows
```

Rules: `-> rows` for lists, `-> first | null` for single, `-> ok | ERR` for mutations with error codes. `RETURNING col` in transactions auto-declares the variable.

## Pattern 3: React screen

```
ItemList
  load:
    items <- GET /items
  actions:
    remove(id) -> DEL /items/:id -> reload
  render: @custom
```

Multiple load lines run in parallel. `:param` in path is interpolated from action args. `render: @custom` means you write the JSX in plain TypeScript after the generated boilerplate.

## Token comparison

```
# .def version (~20 tokens)
/items  auth
  GET  /     listItems(userId)   -> data
  POST /     createItem(userId, body.name) -> 201

# Equivalent TypeScript (~80 tokens)
import { Router } from 'express';
import { listItems, createItem } from '../../services/items';
const router = Router();
router.get('/', async (req, res, next) => {
  try { const data = await listItems(req.user.id); res.json({ data }); }
  catch (err) { next(err); }
});
// ... createItem handler
```

## Run

```bash
ion gen src/routes/items.def     # generates src/routes/items.ts
ion gen --watch                  # watch all .def files
```
