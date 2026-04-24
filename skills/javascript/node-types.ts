/** Named node type strings from tree-sitter-javascript@0.25 node-types.json. */
export type JsNamedNodeType =
  | 'program'
  | 'function_declaration'
  | 'generator_function_declaration'
  | 'class_declaration'
  | 'lexical_declaration'
  | 'variable_declaration'
  | 'import_declaration'
  | 'import_statement'
  | 'export_statement'
  | 'expression_statement'
  | 'if_statement'
  | 'else_clause'
  | 'for_statement'
  | 'for_in_statement'
  | 'while_statement'
  | 'do_statement'
  | 'switch_statement'
  | 'switch_case'
  | 'switch_default'
  | 'break_statement'
  | 'continue_statement'
  | 'return_statement'
  | 'throw_statement'
  | 'try_statement'
  | 'catch_clause'
  | 'finally_clause'
  | 'with_statement'
  | 'labeled_statement'
  | 'empty_statement'
  | 'debugger_statement'
  | 'statement_block'
  | 'arrow_function'
  | 'function'
  | 'generator_function'
  | 'call_expression'
  | 'new_expression'
  | 'await_expression'
  | 'yield_expression'
  | 'member_expression'
  | 'subscript_expression'
  | 'assignment_expression'
  | 'augmented_assignment_expression'
  | 'binary_expression'
  | 'unary_expression'
  | 'update_expression'
  | 'ternary_expression'
  | 'sequence_expression'
  | 'parenthesized_expression'
  | 'object'
  | 'array'
  | 'spread_element'
  | 'pair'
  | 'computed_property_name'
  | 'method_definition'
  | 'field_definition'
  | 'class_body'
  | 'class'
  | 'class_heritage'
  | 'template_string'
  | 'template_substitution'
  | 'regex'
  | 'regex_pattern'
  | 'regex_flags'
  | 'string'
  | 'string_fragment'
  | 'escape_sequence'
  | 'number'
  | 'identifier'
  | 'property_identifier'
  | 'private_property_identifier'
  | 'label_identifier'
  | 'shorthand_property_identifier'
  | 'shorthand_property_identifier_pattern'
  | 'formal_parameters'
  | 'required_parameter'
  | 'optional_parameter'
  | 'rest_parameter'
  | 'assignment_pattern'
  | 'object_pattern'
  | 'array_pattern'
  | 'import'
  | 'import_specifier'
  | 'namespace_import'
  | 'named_imports'
  | 'export_specifier'
  | 'export_clause'
  | 'namespace_export'
  | 'arguments'
  | 'comment'
  | 'hash_bang_line'
  | 'meta_property'
  | 'decorator'
  | 'ERROR';

/** Phantom-typed wrapper over a tree-sitter SyntaxNode. */
export interface JsTypedNode<T extends JsNamedNodeType = JsNamedNodeType> {
  readonly type: T;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly startIndex: number;
  readonly endIndex: number;
  readonly text: string;
  readonly hasError: boolean;
  readonly isMissing: boolean;
  readonly isNamed: boolean;
  readonly children: readonly JsTypedNode[];
  readonly namedChildren: readonly JsTypedNode[];
  readonly parent: JsTypedNode | null;
  childForFieldName(name: string): JsTypedNode | null;
  childrenForFieldName(name: string): readonly JsTypedNode[];
}

export type JsProgramNode = JsTypedNode<'program'>;
export type JsFunctionDeclarationNode = JsTypedNode<'function_declaration'>;
export type JsArrowFunctionNode = JsTypedNode<'arrow_function'>;
export type JsClassDeclarationNode = JsTypedNode<'class_declaration'>;
export type JsCallExpressionNode = JsTypedNode<'call_expression'>;
export type JsIdentifierNode = JsTypedNode<'identifier'>;
export type JsImportDeclarationNode = JsTypedNode<'import_declaration'>;
export type JsImportStatementNode = JsTypedNode<'import_statement'>;
export type JsExportStatementNode = JsTypedNode<'export_statement'>;
export type JsLexicalDeclarationNode = JsTypedNode<'lexical_declaration'>;
export type JsVariableDeclarationNode = JsTypedNode<'variable_declaration'>;

/** Narrows a JsTypedNode to a specific node type. */
export function isNodeOfType<T extends JsNamedNodeType>(
  node: JsTypedNode,
  type: T,
): node is JsTypedNode<T> {
  return node.type === type;
}
