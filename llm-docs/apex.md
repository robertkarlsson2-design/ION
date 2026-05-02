
# Writing Ion for Apex

The Apex emitter (`emitters/apex/emit.ts`) targets **Salesforce Apex** and produces a single `.cls` file wrapped in `public with sharing class <ModuleName>Controller { ... }`. The emitter recognises naming conventions that map to Apex annotations: functions starting with `get`/`filter` become `@AuraEnabled(cacheable=true)`, functions starting with `create`/`update`/`delete` become `@AuraEnabled` (non-cacheable, mutating).

> **Status:** the Apex emitter is marked "Code present, not wired into CLI" in the README status table. Today, call `emitApex(irModule)` directly from a Node script.


## Apex-specific type mapping

```
Int   → Integer
Float → Decimal       (NOT Double — Apex uses Decimal for arbitrary precision)
Bool  → Boolean
Str   → String
Unit  → void
List<T> → List<T>     (Apex generic, Ion type preserved)
Map<K,V> → Map<K,V>
Option<T> → T          (Apex has no Option; nullability is implicit)
Never → Object
User type → T (treated as a custom Apex class or SObject)
```

Verified per `tests/emit/apex.test.ts:105-133`.


## Class wrapping — naming convention

```ion
// module: claims-controller
fn getClaims(input: Str) -> Str = input
```

emits:

```apex
public with sharing class ClaimsControllerController {
  @AuraEnabled(cacheable=true)
  public static Object getClaims(Object claims) {
    return claims;
  }
}
```

Module name `claims-controller` becomes `ClaimsControllerController` (PascalCase + `Controller` suffix). The `with sharing` keyword enforces row-level security — the safe default for any class invoked from Lightning.

⚠️ **Naming gotcha:** because the emitter appends `Controller`, a module named `task-manager` becomes `TaskManagerController` — but a module named `task-manager-controller` becomes `TaskManagerControllerController` (double suffix). Pick module names without `-controller`.


## `@AuraEnabled` annotation rules

The emitter inspects the function name to decide which annotation to emit:

| Name pattern | Annotation | Use case |
|---|---|---|
| `get*` | `@AuraEnabled(cacheable=true)` | Read query (cached client-side) |
| `filter*` | `@AuraEnabled(cacheable=true)` | Pure filter (cached) |
| `create*`/`createX` | `@AuraEnabled` | Insert (not cacheable) |
| `update*`/`updateX` | `@AuraEnabled` | Update (not cacheable) |
| `delete*` | `@AuraEnabled` | Delete (not cacheable) |
| Other | `@AuraEnabled` | Default — not cacheable |

Verified by `tests/emit/apex.test.ts:262-289`.

If you DON'T want `@AuraEnabled` (e.g., for a private helper), the emitter has no opt-out today. **Workaround:** either prefix the function with `_` (untested) or hand-edit the emitted `.cls` to delete the annotation.


## Operators

Apex has different operators than JS/TS:

| Ion | Apex |
|---|---|
| `__add__`/`-`/`*`/`/` | `+`/`-`/`*`/`/` |
| `__mod__` | `Math.mod($1, $2)` (not `%`) |
| `__eq__` | `==` (NOT `===` — Apex has no triple-equals) |
| `__ne__` | `!=` |
| `__lt__`/`__gt__`/`__le__`/`__ge__` | `<`/`>`/`<=`/`>=` |
| `__and__` | `(a && b)` (parens added) |
| `__or__` | `(a || b)` (parens added) |
| `__not__` | `!a` |

Verified per `tests/emit/apex.test.ts:135-181`.

⚠️ **Apex `==` is value-equality for Strings** (unlike Java) — so the string-equality gap from the Java target does NOT exist here. `name == 'admin'` works correctly.


## Method calls remap to Apex idioms

The emitter rewrites known JS-style calls to Apex equivalents (`emit.ts::emitApexExpr`):

| Ion | Apex |
|---|---|
| `xs.includes(x)` (OopVirtualCall) | `xs.contains(x)` |
| `xs.sort()` | `xs.sort()` (built-in) |
| `s.toLowerCase()` | `s.toLowerCase()` |
| `s.toUpperCase()` | `s.toUpperCase()` |
| `xs.length` (Accessor) | `xs.size()` |
| `xs.k` (Accessor — single-letter abbreviation) | `xs.size()` |

Verified per `tests/emit/apex.test.ts:183-211`. The `length` → `size()` translation is critical — Apex collections use `.size()`, not `.length`.


## Lists and maps

```ion
let nums = [1, 2, 3]
```

emits:

```apex
new List<Object>{1, 2, 3}
```

⚠️ Apex requires explicit element types — `List<Object>` is the safe-but-loose default. If you want `List<Integer>`, hand-edit (or open an enhancement to inspect `ListLit.type.elem`).

Maps: untested in surface syntax. Apex has `new Map<String, Integer>{ 'a' => 1, 'b' => 2 }`. Most likely emit shape is `new Map<Object, Object>{...}`.


## Pattern matching → Apex ternaries

`if/then/else` → ternary (surface-syntax form):

```ion
fn statusLabel(active: Bool) -> Str = if active then "Active" else "Inactive"
```

emits:

```apex
public static Object statusLabel(Object active) {
  return active ? 'Active' : 'Inactive';
}
```

Verified per `tests/emit/apex.test.ts:223-246`. **String literals use single quotes** (Apex convention) — the emitter wraps with `'...'` not `"..."`.

For multi-arm cases, ternary chains are emitted (same pattern as TS/Python). Apex 60+ adds `switch on` statements, but the emitter does not target that form today.


## Return type — always `Object`

⚠️ **Every emitted method has `Object` as its return type**, regardless of the Ion `-> Int` or `-> Bool` declaration:

```ion
fn double(x: Int) -> Int = x * 2
```

emits:

```apex
@AuraEnabled
public static Object double(Object x) {
  return x * 2;
}
```

This is a deliberate erasure (similar to Java's `Object`-everywhere prelude pattern) but it costs you Apex's strong typing. Lightning component callers will receive an `Object` they need to cast on the JS side.

**Workaround:** hand-edit the return types after emission, or use `@AuraEnabled` annotations explicitly with `cacheable` set so Salesforce's metadata API handles type marshalling. Neither path is automated today.

Also note: **`double` is not an Apex reserved word**, but **`Date`, `Time`, `Datetime`, `Database` ARE** (they're system classes). Avoid those as Ion function/data names.


## Worked example — Lightning controller

```ion
// module: claims-controller

@foreign("Database", "query", "Database.query($1)")
extern fn soql(query: Str) -> Str

fn getClaims(status: Str) -> Str = soql("SELECT Id, Name FROM Claim__c WHERE Status__c = :status")

fn createClaim(data: Str) -> Str = soql("INSERT INTO Claim__c VALUES (:data)")
```

Expected emit shape:

```apex
public with sharing class ClaimsControllerController {
  @AuraEnabled(cacheable=true)
  public static Object getClaims(Object status) {
    return Database.query('SELECT Id, Name FROM Claim__c WHERE Status__c = :status');
  }
  
  @AuraEnabled
  public static Object createClaim(Object data) {
    return Database.query('INSERT INTO Claim__c VALUES (:data)');
  }
}
```

⚠️ **The bind variable `:status` won't actually bind** — it's a literal string in Ion that becomes a literal string in Apex. To get true SOQL bind behaviour, you need to construct the query in Apex code, not Ion. Either hand-edit or use a more elaborate `extern` template.


## Gap summary — Apex target

| Feature | Status | Workaround |
|---|---|---|
| `public with sharing class XController` wrapping | ✅ works | — |
| `@AuraEnabled(cacheable=true)` for `get*`/`filter*` | ✅ works | — |
| `@AuraEnabled` for `create*`/`update*` | ✅ works | — |
| Apex-specific type mapping (`Int → Integer`, `Float → Decimal`) | ✅ works | — |
| `length → size()` accessor remap | ✅ works | — |
| `includes → contains` method remap | ✅ works | — |
| Single-quoted string literals | ✅ works | — |
| `==` is value-equality for strings | ✅ works (no Java gap) | — |
| Sharp return types (not just `Object`) | ❌ everything is `Object` | hand-edit or open enhancement |
| Sharp `List<T>` element types | ❌ always `List<Object>` | hand-edit |
| SOQL bind variables (`:varname`) | ❌ literal strings only | hand-write the query in Apex |
| Trigger handlers, batch classes | ❌ no surface | hand-write Apex |
| `data` decls → SObject definitions | ❌ no SObject path | hand-write `*.object-meta.xml` |
| `try`/`catch` for `DML` exceptions | ❌ no Ion construct | hand-edit or use `raw(...)` (untested) |
| Test methods (`@isTest`) | ❌ no annotation path | hand-write in `*.cls-meta.xml` |
| `ion build --target apex` from CLI | ❌ not wired up | call `emitApex(irModule)` from Node |


## When to use Apex target

- **Read-heavy controllers** wrapping SOQL queries and returning data to Lightning.
- **Pure helpers** — pricing calculations, date math, predicate functions.
- **Boilerplate-heavy CRUD** where Ion's structural compression saves the most.

## When to NOT use Apex target

- **Triggers** — Apex triggers have a fixed signature (`trigger Foo on Account (before insert) {...}`) the emitter does not target.
- **Test classes** — `@isTest` annotation path doesn't exist; hand-write test classes.
- **Anything needing precise SObject types** — Ion has no SObject schema awareness today.


## Recommended workflow

1. Pick a narrow controller scope — 5-10 read/write methods.
2. Use the **`get*`/`filter*`/`create*`/`update*` naming convention** to drive annotation choice automatically.
3. Wrap SOQL/DML calls in `@foreign` extern declarations — that's the only path to real Apex DB access.
4. After emission, run **`sfdx force:apex:test:run`** or compile via Salesforce CLI to catch the inevitable cast/type errors.
5. Hand-fix the `Object` return types and `List<Object>` element types where Lightning callers need precision.

The Apex emitter is concise and has the cleanest annotation logic of any target, but the **Object-erased return types** are the dominant ergonomic gap. For production controllers, expect 30-50% of lines to need hand-editing; the saved tokens are still worth it for the structural shell.
