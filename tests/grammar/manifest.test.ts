import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { ION_IR_SCHEMA, GBNF_ION, ION_SURFACE_RULES } from '../../src/grammar/index.js';
import { validateGBNF } from '../../src/grammar/gbnf.js';
import { serializeModule } from '../../src/ir/serde.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule } from '../../src/ir/nodes.js';
import type { Span } from '../../src/types.js';

const ajv = new Ajv({ strict: false });

const span: Span = { file: 't.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
const sid = makeSymbolId('t:x:0');

const minimalModule: IonIRModule = {
  ionir: '1.0',
  module: 'test.module',
  version: '0.1.0',
  dialects: ['core'],
  imports: [],
  data: [],
  decls: [{ kind: 'Var', name: 'x', symbolId: sid, span, type: { kind: 'Int' } }],
};

// ---------------------------------------------------------------------------
// GBNF tests
// ---------------------------------------------------------------------------

describe('GBNF_ION', () => {
  it('starts with "root ::="', () => {
    expect(GBNF_ION.startsWith('root ::=')).toBe(true);
  });

  it('has no undefined rule references', () => {
    expect(validateGBNF(ION_SURFACE_RULES)).toEqual([]);
  });

  it('contains key declaration rules', () => {
    const names = new Set(ION_SURFACE_RULES.map(r => r.name));
    expect(names.has('fn-decl')).toBe(true);
    expect(names.has('let-decl')).toBe(true);
    expect(names.has('data-decl')).toBe(true);
    expect(names.has('module-decl')).toBe(true);
    expect(names.has('extern-decl')).toBe(true);
  });

  it('contains key expression and pattern rules', () => {
    const names = new Set(ION_SURFACE_RULES.map(r => r.name));
    expect(names.has('expr')).toBe(true);
    expect(names.has('expr-pipeline')).toBe(true);
    expect(names.has('pattern')).toBe(true);
    expect(names.has('type-annotation')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ION_IR_SCHEMA tests
// ---------------------------------------------------------------------------

describe('ION_IR_SCHEMA', () => {
  it('has the draft-07 $schema URI', () => {
    expect(ION_IR_SCHEMA.$schema).toBe('http://json-schema.org/draft-07/schema');
  });

  it('has $ref pointing to IonIRModule', () => {
    expect(ION_IR_SCHEMA.$ref).toBe('#/$defs/IonIRModule');
  });

  it('$defs covers all IonIRNode kind strings', () => {
    const schemaStr = JSON.stringify(ION_IR_SCHEMA.$defs);
    const allKinds = [
      'Var', 'Literal', 'App', 'Abs', 'Let', 'Case',
      'Constructor', 'Accessor', 'ModuleRef', 'ForeignRef', 'Effect',
      'OopClass', 'OopInterface', 'OopNew', 'OopVirtualCall', 'OopThis',
      'AsyncBlock', 'Await',
      'AdtDecl', 'AdtMatch',
      'EffectDecl', 'Perform', 'Handle', 'Resume',
    ];
    for (const kind of allKinds) {
      expect(schemaStr).toContain(kind);
    }
  });

  it('validates a minimal IonIRModule', () => {
    const json = JSON.parse(serializeModule(minimalModule));
    const validate = ajv.compile(ION_IR_SCHEMA);
    const valid = validate(json);
    if (!valid) {
      // Surface the first error to aid debugging
      expect(validate.errors).toBeNull();
    }
    expect(valid).toBe(true);
  });

  it('rejects a module missing the required "ionir" field', () => {
    const json = JSON.parse(serializeModule(minimalModule)) as Record<string, unknown>;
    const withoutIonir = Object.fromEntries(
      Object.entries(json).filter(([k]) => k !== 'ionir'),
    );
    const validate = ajv.compile(ION_IR_SCHEMA);
    expect(validate(withoutIonir)).toBe(false);
  });

  it('rejects a decl with an unknown node kind', () => {
    const bogusModule = {
      ionir: '1.0',
      module: 'test.module',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'BogusNode', name: 'x', symbolId: String(sid), span, type: { kind: 'Int' } }],
    };
    const validate = ajv.compile(ION_IR_SCHEMA);
    expect(validate(bogusModule)).toBe(false);
  });
});
