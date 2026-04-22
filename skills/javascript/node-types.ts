import type Parser from 'tree-sitter';

type SyntaxNode = Parser.SyntaxNode;

/** Base typed wrapper over a tree-sitter SyntaxNode. */
export interface JsNode {
  readonly raw: SyntaxNode;
}

class BaseJsNode implements JsNode {
  constructor(readonly raw: SyntaxNode) {}
}

export interface JsProgram extends JsNode {
  /** Top-level statements in the file. */
  statements(): JsNode[];
}

export interface JsIdentifier extends JsNode {
  text(): string;
}

export interface JsNumber extends JsNode {
  text(): string;
}

export interface JsString extends JsNode {
  text(): string;
}

export interface JsFunctionDecl extends JsNode {
  name(): JsIdentifier | null;
  params(): JsNode[];
  body(): JsNode;
}

export interface JsArrowFunction extends JsNode {
  params(): JsNode[];
  body(): JsNode;
}

export interface JsCallExpr extends JsNode {
  callee(): JsNode;
  args(): JsNode[];
}

export interface JsMemberExpr extends JsNode {
  object(): JsNode;
  property(): JsNode;
}

export type VariableKind = 'var' | 'let' | 'const';

export interface JsVariableDeclarator extends JsNode {
  name(): JsNode;
  value(): JsNode | null;
}

export interface JsVariableDecl extends JsNode {
  kind(): VariableKind;
  declarators(): JsVariableDeclarator[];
}

export interface JsReturnStmt extends JsNode {
  value(): JsNode | null;
}

export interface JsExprStmt extends JsNode {
  expression(): JsNode;
}

export interface JsIfStmt extends JsNode {
  condition(): JsNode;
  consequence(): JsNode;
  alternative(): JsNode | null;
}

export interface JsClassDecl extends JsNode {
  name(): JsIdentifier | null;
  body(): JsNode;
}

export interface JsImportStmt extends JsNode {
  source(): JsString;
}

export interface JsExportStmt extends JsNode {
  declaration(): JsNode | null;
}

// ---------------------------------------------------------------------------
// Concrete implementations
// ---------------------------------------------------------------------------

class JsProgramImpl extends BaseJsNode implements JsProgram {
  statements(): JsNode[] {
    return this.raw.namedChildren.map(wrapNode);
  }
}

class JsIdentifierImpl extends BaseJsNode implements JsIdentifier {
  text(): string {
    return this.raw.text;
  }
}

class JsNumberImpl extends BaseJsNode implements JsNumber {
  text(): string {
    return this.raw.text;
  }
}

class JsStringImpl extends BaseJsNode implements JsString {
  text(): string {
    return this.raw.text;
  }
}

class JsFunctionDeclImpl extends BaseJsNode implements JsFunctionDecl {
  name(): JsIdentifier | null {
    const n = this.raw.childForFieldName('name');
    return n ? (wrapNode(n) as JsIdentifier) : null;
  }

  params(): JsNode[] {
    const p = this.raw.childForFieldName('parameters');
    return p ? p.namedChildren.map(wrapNode) : [];
  }

  body(): JsNode {
    const b = this.raw.childForFieldName('body');
    // body is required by the grammar; fall back to self only if tree is malformed
    return wrapNode(b ?? this.raw);
  }
}

class JsArrowFunctionImpl extends BaseJsNode implements JsArrowFunction {
  params(): JsNode[] {
    // arrow_function has either `parameter` (single identifier) or `parameters` (formal_parameters)
    const multi = this.raw.childForFieldName('parameters');
    if (multi) return multi.namedChildren.map(wrapNode);
    const single = this.raw.childForFieldName('parameter');
    return single ? [wrapNode(single)] : [];
  }

  body(): JsNode {
    const b = this.raw.childForFieldName('body');
    return wrapNode(b ?? this.raw);
  }
}

class JsCallExprImpl extends BaseJsNode implements JsCallExpr {
  callee(): JsNode {
    const fn = this.raw.childForFieldName('function');
    return wrapNode(fn ?? this.raw);
  }

  args(): JsNode[] {
    const argList = this.raw.childForFieldName('arguments');
    return argList ? argList.namedChildren.map(wrapNode) : [];
  }
}

class JsMemberExprImpl extends BaseJsNode implements JsMemberExpr {
  object(): JsNode {
    const o = this.raw.childForFieldName('object');
    return wrapNode(o ?? this.raw);
  }

  property(): JsNode {
    const p = this.raw.childForFieldName('property');
    return wrapNode(p ?? this.raw);
  }
}

class JsVariableDeclaratorImpl extends BaseJsNode implements JsVariableDeclarator {
  name(): JsNode {
    const n = this.raw.childForFieldName('name');
    return wrapNode(n ?? this.raw);
  }

  value(): JsNode | null {
    const v = this.raw.childForFieldName('value');
    return v ? wrapNode(v) : null;
  }
}

class JsVariableDeclImpl extends BaseJsNode implements JsVariableDecl {
  kind(): VariableKind {
    if (this.raw.type === 'lexical_declaration') {
      // lexical_declaration has a named `kind` field with type 'let' or 'const'
      const kw = this.raw.childForFieldName('kind')?.type;
      if (kw === 'let' || kw === 'const') return kw;
    }
    // variable_declaration is always `var` in ES2015+
    return 'var';
  }

  declarators(): JsVariableDeclarator[] {
    return this.raw.namedChildren.map(c => new JsVariableDeclaratorImpl(c));
  }
}

class JsReturnStmtImpl extends BaseJsNode implements JsReturnStmt {
  value(): JsNode | null {
    // return_statement has no named fields; the expression is namedChild(0)
    const v = this.raw.namedChild(0);
    return v ? wrapNode(v) : null;
  }
}

class JsExprStmtImpl extends BaseJsNode implements JsExprStmt {
  expression(): JsNode {
    // expression_statement has no named fields; the expression is namedChild(0)
    const e = this.raw.namedChild(0);
    return wrapNode(e ?? this.raw);
  }
}

class JsIfStmtImpl extends BaseJsNode implements JsIfStmt {
  condition(): JsNode {
    const c = this.raw.childForFieldName('condition');
    return wrapNode(c ?? this.raw);
  }

  consequence(): JsNode {
    const c = this.raw.childForFieldName('consequence');
    return wrapNode(c ?? this.raw);
  }

  alternative(): JsNode | null {
    const a = this.raw.childForFieldName('alternative');
    return a ? wrapNode(a) : null;
  }
}

class JsClassDeclImpl extends BaseJsNode implements JsClassDecl {
  name(): JsIdentifier | null {
    const n = this.raw.childForFieldName('name');
    return n ? (wrapNode(n) as JsIdentifier) : null;
  }

  body(): JsNode {
    const b = this.raw.childForFieldName('body');
    return wrapNode(b ?? this.raw);
  }
}

class JsImportStmtImpl extends BaseJsNode implements JsImportStmt {
  source(): JsString {
    const s = this.raw.childForFieldName('source');
    return new JsStringImpl(s ?? this.raw);
  }
}

class JsExportStmtImpl extends BaseJsNode implements JsExportStmt {
  declaration(): JsNode | null {
    const d = this.raw.childForFieldName('declaration');
    return d ? wrapNode(d) : null;
  }
}

/** Dispatch on `node.type` to return a typed wrapper; falls back to the base JsNode. */
export function wrapNode(node: SyntaxNode): JsNode {
  switch (node.type) {
    case 'program': return new JsProgramImpl(node);
    case 'identifier': return new JsIdentifierImpl(node);
    case 'number': return new JsNumberImpl(node);
    case 'string': return new JsStringImpl(node);
    case 'function_declaration': return new JsFunctionDeclImpl(node);
    case 'arrow_function': return new JsArrowFunctionImpl(node);
    case 'call_expression': return new JsCallExprImpl(node);
    case 'member_expression': return new JsMemberExprImpl(node);
    case 'variable_declaration':
    case 'lexical_declaration': return new JsVariableDeclImpl(node);
    case 'variable_declarator': return new JsVariableDeclaratorImpl(node);
    case 'return_statement': return new JsReturnStmtImpl(node);
    case 'expression_statement': return new JsExprStmtImpl(node);
    case 'if_statement': return new JsIfStmtImpl(node);
    case 'class_declaration': return new JsClassDeclImpl(node);
    case 'import_statement': return new JsImportStmtImpl(node);
    case 'export_statement': return new JsExportStmtImpl(node);
    default: return new BaseJsNode(node);
  }
}
