// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
/** Thrown when encoding encounters an irrecoverable structural problem. */
export class WireEncodeError extends Error {
    path;
    constructor(message, path) {
        super(message);
        this.path = path;
        this.name = 'WireEncodeError';
    }
}
// ---------------------------------------------------------------------------
// Internal: AliasGenerator
// ---------------------------------------------------------------------------
class AliasGenerator {
    n = 0;
    /** Returns the next alias: 0→'a', 25→'z', 26→'aa', 51→'az', 52→'ba', … */
    next() {
        const n = this.n++;
        if (n < 26)
            return String.fromCharCode(97 + n);
        const m = n - 26;
        return String.fromCharCode(97 + Math.floor(m / 26)) + String.fromCharCode(97 + (m % 26));
    }
}
/**
 * Pooling heuristic: approximate cl100k token savings.
 * inline_tokens ≈ ceil(len/4), ref_tokens = 1, decl_cost = ref + '=' + inline
 */
function shouldPool(key, count) {
    const inlineTokens = Math.ceil(key.length / 4);
    if (inlineTokens <= 1)
        return false;
    const declCost = 1 + 1 + inlineTokens;
    return count * (inlineTokens - 1) > declCost;
}
function symOrName(name, ctx) {
    return ctx.symbolPool.get(name) ?? name;
}
// ---------------------------------------------------------------------------
// Canonical type expression — uses S pool, NOT T pool (for T-pool key)
// ---------------------------------------------------------------------------
function canonicalEffects(sortedTags) {
    return sortedTags.length === 0 ? '' : `!${sortedTags.join(',')}`;
}
function canonicalType(type, symPool) {
    switch (type.kind) {
        case 'Int': return 'int';
        case 'Float': return 'float';
        case 'Str': return 'str';
        case 'Bool': return 'bool';
        case 'Null': return 'null';
        case 'Unit': return 'unit';
        case 'Never': return 'never';
        case 'TypeVar': return `?${type.id}`;
        case 'List': return `list<${canonicalType(type.elem, symPool)}>`;
        case 'Option': return `opt<${canonicalType(type.inner, symPool)}>`;
        case 'Map': return `map<${canonicalType(type.key, symPool)},${canonicalType(type.value, symPool)}>`;
        case 'Result': return `res<${canonicalType(type.ok, symPool)},${canonicalType(type.err, symPool)}>`;
        case 'Fn': {
            const params = type.params.map(p => canonicalType(p, symPool)).join(',');
            const ret = canonicalType(type.ret, symPool);
            const effects = canonicalEffects([...type.effects].sort());
            return `(${params})->${ret}${effects}`;
        }
        case 'User': {
            const name = symPool.get(type.name) ?? type.name;
            const args = type.args.length
                ? `<${type.args.map(a => canonicalType(a, symPool)).join(',')}>`
                : '';
            return name + args;
        }
    }
}
// ---------------------------------------------------------------------------
// Type encoding for wire output — uses both S and T pools
// ---------------------------------------------------------------------------
function encodeType(type, ctx) {
    const key = canonicalType(type, ctx.symbolPool);
    return ctx.typePool.get(key) ?? encodeTypeRaw(type, ctx);
}
function encodeTypeRaw(type, ctx) {
    switch (type.kind) {
        case 'Int': return 'int';
        case 'Float': return 'float';
        case 'Str': return 'str';
        case 'Bool': return 'bool';
        case 'Null': return 'null';
        case 'Unit': return 'unit';
        case 'Never': return 'never';
        case 'TypeVar': return `?${type.id}`;
        case 'List': return `list<${encodeType(type.elem, ctx)}>`;
        case 'Option': return `opt<${encodeType(type.inner, ctx)}>`;
        case 'Map': return `map<${encodeType(type.key, ctx)},${encodeType(type.value, ctx)}>`;
        case 'Result': return `res<${encodeType(type.ok, ctx)},${encodeType(type.err, ctx)}>`;
        case 'Fn': {
            const params = type.params.map(p => encodeType(p, ctx)).join(',');
            const ret = encodeType(type.ret, ctx);
            const effects = canonicalEffects([...type.effects].sort());
            return `(${params})->${ret}${effects}`;
        }
        case 'User': {
            const name = symOrName(type.name, ctx);
            const args = type.args.length
                ? `<${type.args.map(a => encodeType(a, ctx)).join(',')}>`
                : '';
            return name + args;
        }
    }
}
// ---------------------------------------------------------------------------
// Name collection for symbol pool
// ---------------------------------------------------------------------------
function collectNamesModule(module) {
    const counts = new Map();
    const firstUse = new Map();
    let order = 0;
    function rec(name) {
        if (!firstUse.has(name))
            firstUse.set(name, order++);
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    function walkType(type) {
        switch (type.kind) {
            case 'List':
                walkType(type.elem);
                break;
            case 'Option':
                walkType(type.inner);
                break;
            case 'Map':
                walkType(type.key);
                walkType(type.value);
                break;
            case 'Result':
                walkType(type.ok);
                walkType(type.err);
                break;
            case 'Fn':
                type.params.forEach(walkType);
                walkType(type.ret);
                break;
            case 'User':
                rec(type.name);
                type.args.forEach(walkType);
                break;
            default: break;
        }
    }
    function walkParam(p) {
        rec(p.name);
        walkType(p.type);
    }
    function walkPattern(pat) {
        switch (pat.kind) {
            case 'Var':
                rec(pat.name);
                break;
            case 'Constructor':
                rec(pat.ctorName);
                pat.fields.forEach(walkPattern);
                break;
            case 'Literal':
            case 'Wildcard': break;
        }
    }
    function walkNode(node) {
        walkType(node.type);
        switch (node.kind) {
            case 'Var':
                rec(node.name);
                break;
            case 'Literal': break;
            case 'App':
                walkNode(node.callee);
                node.args.forEach(walkNode);
                break;
            case 'Abs':
                node.params.forEach(walkParam);
                walkNode(node.body);
                break;
            case 'Let':
                rec(node.name);
                walkType(node.bindingType);
                walkNode(node.value);
                walkNode(node.body);
                break;
            case 'Case':
                walkNode(node.scrutinee);
                for (const arm of node.arms) {
                    walkPattern(arm.pattern);
                    if (arm.guard)
                        walkNode(arm.guard);
                    walkNode(arm.body);
                }
                break;
            case 'Constructor':
                rec(node.ctorName);
                node.args.forEach(walkNode);
                break;
            case 'Accessor':
                walkNode(node.receiver);
                break;
            case 'ModuleRef':
                rec(node.modulePath.join('.'));
                break;
            case 'ForeignRef':
                node.sig.params.forEach(walkType);
                walkType(node.sig.ret);
                break;
            case 'Effect':
                walkNode(node.body);
                break;
            case 'OopClass':
                rec(node.name);
                node.fields.forEach(walkParam);
                for (const m of node.methods) {
                    rec(m.name);
                    m.params.forEach(walkParam);
                    walkType(m.retType);
                    if (m.body)
                        walkNode(m.body);
                }
                break;
            case 'OopInterface':
                rec(node.name);
                for (const m of node.members)
                    walkType(m.type);
                break;
            case 'OopNew':
                node.args.forEach(walkNode);
                break;
            case 'OopVirtualCall':
                walkNode(node.receiver);
                node.args.forEach(walkNode);
                break;
            case 'OopThis': break;
            case 'AsyncBlock':
                walkNode(node.body);
                break;
            case 'Await':
                walkNode(node.expr);
                break;
            case 'AdtDecl':
                rec(node.name);
                for (const v of node.variants) {
                    rec(v.tag);
                    v.fields.forEach(walkParam);
                }
                break;
            case 'AdtMatch':
                walkNode(node.scrutinee);
                for (const arm of node.arms) {
                    rec(arm.tag);
                    arm.bindings.forEach(walkParam);
                    walkNode(arm.body);
                }
                break;
            case 'EffectDecl':
                rec(node.name);
                for (const op of node.operations) {
                    op.params.forEach(walkParam);
                    walkType(op.retType);
                }
                break;
            case 'Perform':
                node.args.forEach(walkNode);
                break;
            case 'Handle':
                walkNode(node.body);
                for (const h of node.handlers) {
                    h.params.forEach(walkParam);
                    walkNode(h.body);
                }
                if (node.returnClause)
                    walkNode(node.returnClause);
                break;
            case 'Resume':
                walkNode(node.value);
                break;
            default: {
                const _exhaustive = node;
                void _exhaustive;
                throw new WireEncodeError(`Unexpected node kind during name collection`, []);
            }
        }
    }
    for (const imp of module.imports)
        walkNode(imp);
    for (const d of module.data)
        walkNode(d);
    for (const decl of module.decls)
        walkNode(decl);
    return { counts, firstUse };
}
function buildSymbolPool(module) {
    const { counts, firstUse } = collectNamesModule(module);
    const gen = new AliasGenerator();
    const pool = new Map();
    // Sort by first-use order to assign shortest aliases to earliest-seen names.
    const sorted = [...counts.entries()]
        .filter(([name, count]) => shouldPool(name, count))
        // Non-null: every key in counts was added to firstUse in the same pass.
        .sort(([a], [b]) => firstUse.get(a) - firstUse.get(b));
    for (const [name] of sorted) {
        pool.set(name, gen.next());
    }
    return pool;
}
// ---------------------------------------------------------------------------
// Type collection for type pool
// ---------------------------------------------------------------------------
function collectTypesModule(module, symPool) {
    const counts = new Map();
    const firstUse = new Map();
    let order = 0;
    function recType(type) {
        const key = canonicalType(type, symPool);
        if (!firstUse.has(key))
            firstUse.set(key, order++);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        switch (type.kind) {
            case 'List':
                recType(type.elem);
                break;
            case 'Option':
                recType(type.inner);
                break;
            case 'Map':
                recType(type.key);
                recType(type.value);
                break;
            case 'Result':
                recType(type.ok);
                recType(type.err);
                break;
            case 'Fn':
                type.params.forEach(recType);
                recType(type.ret);
                break;
            case 'User':
                type.args.forEach(recType);
                break;
            default: break;
        }
    }
    function walkParam(p) {
        recType(p.type);
    }
    function walkNode(node) {
        recType(node.type);
        switch (node.kind) {
            case 'Literal':
            case 'Var':
            case 'OopThis':
            case 'ModuleRef': break;
            case 'App':
                walkNode(node.callee);
                node.args.forEach(walkNode);
                break;
            case 'Abs':
                node.params.forEach(walkParam);
                walkNode(node.body);
                break;
            case 'Let':
                recType(node.bindingType);
                walkNode(node.value);
                walkNode(node.body);
                break;
            case 'Case':
                walkNode(node.scrutinee);
                for (const arm of node.arms) {
                    if (arm.guard)
                        walkNode(arm.guard);
                    walkNode(arm.body);
                }
                break;
            case 'Constructor':
                node.args.forEach(walkNode);
                break;
            case 'Accessor':
                walkNode(node.receiver);
                break;
            case 'ForeignRef':
                node.sig.params.forEach(recType);
                recType(node.sig.ret);
                break;
            case 'Effect':
                walkNode(node.body);
                break;
            case 'OopClass':
                node.fields.forEach(walkParam);
                for (const m of node.methods) {
                    m.params.forEach(walkParam);
                    recType(m.retType);
                    if (m.body)
                        walkNode(m.body);
                }
                break;
            case 'OopInterface':
                for (const m of node.members)
                    recType(m.type);
                break;
            case 'OopNew':
                node.args.forEach(walkNode);
                break;
            case 'OopVirtualCall':
                walkNode(node.receiver);
                node.args.forEach(walkNode);
                break;
            case 'AsyncBlock':
                walkNode(node.body);
                break;
            case 'Await':
                walkNode(node.expr);
                break;
            case 'AdtDecl':
                for (const v of node.variants)
                    v.fields.forEach(walkParam);
                break;
            case 'AdtMatch':
                walkNode(node.scrutinee);
                for (const arm of node.arms) {
                    arm.bindings.forEach(walkParam);
                    walkNode(arm.body);
                }
                break;
            case 'EffectDecl':
                for (const op of node.operations) {
                    op.params.forEach(walkParam);
                    recType(op.retType);
                }
                break;
            case 'Perform':
                node.args.forEach(walkNode);
                break;
            case 'Handle':
                walkNode(node.body);
                for (const h of node.handlers) {
                    h.params.forEach(walkParam);
                    walkNode(h.body);
                }
                if (node.returnClause)
                    walkNode(node.returnClause);
                break;
            case 'Resume':
                walkNode(node.value);
                break;
            default: {
                const _exhaustive = node;
                void _exhaustive;
                throw new WireEncodeError(`Unexpected node kind during type collection`, []);
            }
        }
    }
    for (const imp of module.imports)
        walkNode(imp);
    for (const d of module.data)
        walkNode(d);
    for (const decl of module.decls)
        walkNode(decl);
    return { counts, firstUse };
}
function buildTypePool(module, symPool) {
    const { counts, firstUse } = collectTypesModule(module, symPool);
    const gen = new AliasGenerator();
    const pool = new Map();
    const sorted = [...counts.entries()]
        .filter(([key, count]) => shouldPool(key, count))
        // Non-null: every key in counts was added to firstUse in the same pass.
        .sort(([a], [b]) => firstUse.get(a) - firstUse.get(b));
    for (const [key] of sorted) {
        pool.set(key, gen.next());
    }
    return pool;
}
// ---------------------------------------------------------------------------
// Node sub-encoders
// ---------------------------------------------------------------------------
function encodeLiteral(value) {
    switch (value.kind) {
        case 'Int': return String(value.value);
        case 'Float': return String(value.value);
        case 'Str': return JSON.stringify(value.value);
        case 'Bool': return value.value ? 'true' : 'false';
        case 'Null': return 'null';
    }
}
function encodeParam(p, ctx) {
    return `${symOrName(p.name, ctx)}:${encodeType(p.type, ctx)}`;
}
function encodePat(pat, ctx) {
    switch (pat.kind) {
        case 'Wildcard': return '_';
        case 'Var': return `@${symOrName(pat.name, ctx)}`;
        case 'Constructor':
            return `${symOrName(pat.ctorName, ctx)}(${pat.fields.map(f => encodePat(f, ctx)).join(',')})`;
        case 'Literal': return encodeLiteral(pat.value);
    }
}
function encodeArm(arm, ctx) {
    const pat = encodePat(arm.pattern, ctx);
    const guard = arm.guard ? `?${encodeNode(arm.guard, ctx)}` : '';
    return `${pat}${guard}->${encodeNode(arm.body, ctx)}`;
}
function encodeAdtArm(arm, ctx) {
    const bindings = arm.bindings.map(p => encodeParam(p, ctx)).join(',');
    return `${symOrName(arm.tag, ctx)}(${bindings})->${encodeNode(arm.body, ctx)}`;
}
function encodeHandler(h, ctx) {
    const params = h.params.map(p => encodeParam(p, ctx)).join(',');
    return `${h.operation}(${params})->${encodeNode(h.body, ctx)}`;
}
function encodeMethod(m, ctx) {
    const params = m.params.map(p => encodeParam(p, ctx)).join(',');
    const ret = encodeType(m.retType, ctx);
    const flags = `${m.isAbstract ? '!abstract' : ''}${m.isStatic ? '!static' : ''}`;
    const body = m.body ? `=${encodeNode(m.body, ctx)}` : '';
    return `${m.name}(${params}):${ret}${flags}${body}`;
}
function encodeAdtVariants(variants, ctx) {
    return variants.map(v => {
        const fields = v.fields.map(f => encodeParam(f, ctx)).join(',');
        return `${symOrName(v.tag, ctx)}(${fields})`;
    }).join('|');
}
function encodeNode(node, ctx) {
    switch (node.kind) {
        case 'Var': return symOrName(node.name, ctx);
        case 'Literal': return encodeLiteral(node.value);
        case 'App':
            return `${encodeNode(node.callee, ctx)}(${node.args.map(a => encodeNode(a, ctx)).join(',')})`;
        case 'Abs': {
            const params = node.params.map(p => encodeParam(p, ctx)).join(',');
            return `(${params})->${encodeNode(node.body, ctx)}`;
        }
        case 'Let': {
            const name = symOrName(node.name, ctx);
            const bt = encodeType(node.bindingType, ctx);
            return `let ${name}:${bt}=${encodeNode(node.value, ctx)};${encodeNode(node.body, ctx)}`;
        }
        case 'Case': {
            const arms = node.arms.map(a => encodeArm(a, ctx)).join(';');
            return `case(${encodeNode(node.scrutinee, ctx)}){${arms}}`;
        }
        case 'Constructor': {
            const args = node.args.map(a => encodeNode(a, ctx)).join(',');
            return `${symOrName(node.ctorName, ctx)}(${args})`;
        }
        case 'Accessor': return `${encodeNode(node.receiver, ctx)}.${node.member}`;
        case 'ModuleRef': {
            const path = node.modulePath.join('.');
            return ctx.symbolPool.get(path) ?? path;
        }
        case 'ForeignRef': return `ffi:${node.target}.${node.symbol}`;
        case 'Effect': return `eff[${node.effectTag}]{${encodeNode(node.body, ctx)}}`;
        case 'OopClass': {
            const superC = node.superClass ? `:${node.superClass}` : '';
            const fields = node.fields.map(f => encodeParam(f, ctx)).join(';');
            const methods = node.methods.map(m => encodeMethod(m, ctx)).join(';');
            return `class ${symOrName(node.name, ctx)}${superC}{${fields};${methods}}`;
        }
        case 'OopInterface': {
            const members = node.members.map(m => `${m.name}:${encodeType(m.type, ctx)}`).join(';');
            return `iface ${symOrName(node.name, ctx)}{${members}}`;
        }
        case 'OopNew':
            return `new ${node.ctorSymbolId}(${node.args.map(a => encodeNode(a, ctx)).join(',')})`;
        case 'OopVirtualCall': {
            const args = node.args.map(a => encodeNode(a, ctx)).join(',');
            return `${encodeNode(node.receiver, ctx)}.${node.method}(${args})`;
        }
        case 'OopThis': return 'this';
        case 'AsyncBlock': return `async{${encodeNode(node.body, ctx)}}`;
        case 'Await': return `await(${encodeNode(node.expr, ctx)})`;
        case 'AdtDecl': {
            const variants = encodeAdtVariants(node.variants, ctx);
            return `${symOrName(node.name, ctx)}{${variants}}`;
        }
        case 'AdtMatch': {
            const arms = node.arms.map(a => encodeAdtArm(a, ctx)).join(';');
            return `match(${encodeNode(node.scrutinee, ctx)}){${arms}}`;
        }
        case 'EffectDecl': {
            const ops = node.operations.map(op => {
                const params = op.params.map(p => encodeParam(p, ctx)).join(',');
                return `${op.name}(${params}):${encodeType(op.retType, ctx)}`;
            }).join(';');
            return `eff ${symOrName(node.name, ctx)}{${ops}}`;
        }
        case 'Perform': {
            const args = node.args.map(a => encodeNode(a, ctx)).join(',');
            return `perf ${node.effectSymbolId}.${node.operation}(${args})`;
        }
        case 'Handle': {
            const body = encodeNode(node.body, ctx);
            const handlers = node.handlers.map(h => encodeHandler(h, ctx));
            const ret = node.returnClause ? `;ret:${encodeNode(node.returnClause, ctx)}` : '';
            return `handle{${body}}[${handlers.join(';')}${ret}]`;
        }
        case 'Resume': return `resume(${encodeNode(node.value, ctx)})`;
        default: {
            const _exhaustive = node;
            void _exhaustive;
            throw new WireEncodeError(`Unexpected node kind`, []);
        }
    }
}
// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------
function buildI1() {
    return 'I1';
}
function buildM(module) {
    const sortedDialects = [...module.dialects].sort();
    return `M ${module.module} v=${module.version} d=${sortedDialects.join(',')}`;
}
function buildS(symbolPool) {
    if (symbolPool.size === 0)
        return null;
    const entries = [...symbolPool.entries()].map(([name, alias]) => `${alias}=${name}`).join(' ');
    return `S ${entries}`;
}
function buildT(typePool) {
    if (typePool.size === 0)
        return null;
    const sorted = [...typePool.entries()].sort(([a], [b]) => a.localeCompare(b));
    const entries = sorted.map(([expr, alias]) => `${alias}=${expr}`).join(' ');
    return `T ${entries}`;
}
function buildX(module, ctx) {
    const parts = [];
    for (const imp of module.imports) {
        const path = imp.modulePath.join('.');
        parts.push(`import ${ctx.symbolPool.get(path) ?? path}`);
    }
    for (const decl of module.decls) {
        if (decl.kind === 'ForeignRef') {
            parts.push(`extern ${decl.target}.${decl.module}.${decl.symbol} ${encodeType(decl.sig.ret, ctx)}`);
        }
    }
    return parts.length === 0 ? null : `X ${parts.join(' ')}`;
}
function buildD(module, ctx) {
    const lines = [];
    for (const adt of module.data) {
        lines.push(`D ${symOrName(adt.name, ctx)}{${encodeAdtVariants(adt.variants, ctx)}}`);
    }
    for (const decl of module.decls) {
        switch (decl.kind) {
            case 'AdtDecl':
                lines.push(`D ${symOrName(decl.name, ctx)}{${encodeAdtVariants(decl.variants, ctx)}}`);
                break;
            case 'OopClass': {
                const superC = decl.superClass ? `:${decl.superClass}` : '';
                const fields = decl.fields.map(f => encodeParam(f, ctx)).join(';');
                const methods = decl.methods.map(m => encodeMethod(m, ctx)).join(';');
                lines.push(`D class ${symOrName(decl.name, ctx)}${superC}{${fields};${methods}}`);
                break;
            }
            case 'OopInterface': {
                const members = decl.members.map(m => `${m.name}:${encodeType(m.type, ctx)}`).join(';');
                lines.push(`D iface ${symOrName(decl.name, ctx)}{${members}}`);
                break;
            }
            case 'EffectDecl': {
                const ops = decl.operations.map(op => {
                    const params = op.params.map(p => encodeParam(p, ctx)).join(',');
                    return `${op.name}(${params}):${encodeType(op.retType, ctx)}`;
                }).join(';');
                lines.push(`D eff ${symOrName(decl.name, ctx)}{${ops}}`);
                break;
            }
            default: break;
        }
    }
    return lines;
}
const D_SECTION_KINDS = new Set([
    'ForeignRef', 'OopClass', 'OopInterface', 'AdtDecl', 'EffectDecl',
]);
function buildF(module, ctx) {
    const lines = [];
    for (const decl of module.decls) {
        if (!D_SECTION_KINDS.has(decl.kind)) {
            lines.push(`F ${encodeNode(decl, ctx)}`);
        }
    }
    return lines;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Encodes an IonIRModule to .ionw text (byte-stable, deterministic).
 * Sections are emitted in order: I1 M S? T? X? D* F*
 */
export function encodeModule(module) {
    const symbolPool = buildSymbolPool(module);
    const typePool = buildTypePool(module, symbolPool);
    const ctx = { symbolPool, typePool };
    const sections = [];
    sections.push(buildI1());
    sections.push(buildM(module));
    const sSection = buildS(symbolPool);
    if (sSection !== null)
        sections.push(sSection);
    const tSection = buildT(typePool);
    if (tSection !== null)
        sections.push(tSection);
    const xSection = buildX(module, ctx);
    if (xSection !== null)
        sections.push(xSection);
    sections.push(...buildD(module, ctx));
    sections.push(...buildF(module, ctx));
    return sections.join('\n') + '\n';
}
