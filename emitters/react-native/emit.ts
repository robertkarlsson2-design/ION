import type {
  IonIRModule,
  IonIRNode,
  AppNode,
  AbsNode,
  LetNode,
  VarNode,
} from '../../src/ir/nodes.js';
import { HTML_TAGS, isHtmlElement, getAttrRaw, emitTsExpr } from '../ui-shared.js';
import { shakePreludeDecls } from '../../src/prelude/dce.js';
import {
  RN_STRIPPED_TAGS, RN_ATTR_MAP,
  RN_TEXT_PRIMITIVES, RN_CONTAINER_PRIMITIVES,
  coerceInputProps, lookupPrimitive,
} from './primitives.js';
import type { ParsedAttrs } from './primitives.js';
import { translateStyleObject, collectAndHoistStyles, canonicalStyleKey, isHoistableStyleObj } from './styles.js';

let _rnCtorFields: Map<string, readonly string[]> = new Map();
let _rnImports: Set<string> = new Set();
let _styleReplacements: Map<string, string> = new Map();

function isJsIdentifier(v: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v);
}

function emitTsExprForRN(node: IonIRNode): string {
  return emitTsExpr(node, { jsxEmitter: emitRnJsxNode, ctorFields: _rnCtorFields, rnImports: _rnImports });
}

function parseRnAttrString(
  raw: string,
  htmlTag: string,
): { attrStr: string; commentChildren: string[] } {
  const commentChildren: string[] = [];
  const trimmed = raw.trim();
  if (!trimmed) return { attrStr: '', commentChildren };

  const rawAttrs: ParsedAttrs = {};
  for (const pair of trimmed.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq < 0) { rawAttrs[pair] = ''; continue; }
    rawAttrs[pair.slice(0, eq)] = pair.slice(eq + 1).replace(/\+/g, ' ');
  }

  const attrs = coerceInputProps(rawAttrs, htmlTag);

  const parts: string[] = [];
  for (const [rawKey, val] of Object.entries(attrs)) {
    if (rawKey === 'class') {
      commentChildren.push(`{/* class=${val} (no-op on RN) */}`);
      continue;
    }
    if (rawKey === 'href') {
      if (val) commentChildren.push(`{/* href=${val} (use onPress + navigation) */}`);
      continue;
    }
    const mappedKey = RN_ATTR_MAP[rawKey];
    if (mappedKey !== undefined) {
      if (mappedKey === '') continue;
      const k = mappedKey;
      if (val.startsWith('{') && val.endsWith('}')) parts.push(`${k}=${val}`);
      else if (rawKey.startsWith('on') && isJsIdentifier(val)) parts.push(`${k}={${val}}`);
      else if (val === '') parts.push(k);
      else parts.push(`${k}="${val}"`);
    } else {
      if (val.startsWith('{') && val.endsWith('}')) parts.push(`${rawKey}=${val}`);
      else if (rawKey.startsWith('on') && isJsIdentifier(val)) parts.push(`${rawKey}={${val}}`);
      else if (val === '') parts.push(rawKey);
      else parts.push(`${rawKey}="${val}"`);
    }
  }
  return { attrStr: parts.join(' '), commentChildren };
}

function emitRnStyleValue(value: IonIRNode): string {
  if (
    value.kind === 'App' &&
    value.callee.kind === 'Var' &&
    (value.callee as VarNode).name === '__obj__' &&
    value.args.length % 2 === 0
  ) {
    const orig = value as AppNode;
    if (_styleReplacements.size > 0 && isHoistableStyleObj(orig)) {
      const styleName = _styleReplacements.get(canonicalStyleKey(orig));
      if (styleName !== undefined) return `styles.${styleName}`;
    }
    const transformed = translateStyleObject(orig);
    const parts: string[] = [];
    for (let i = 0; i < transformed.args.length; i += 2) {
      const origK = orig.args[i]!;
      const tKey = transformed.args[i]!;
      const tVal = transformed.args[i + 1]!;
      const origKs = origK.kind === 'Literal' && origK.value.kind === 'Str'
        ? origK.value.value : null;
      const transKs = tKey.kind === 'Literal' && tKey.value.kind === 'Str'
        ? tKey.value.value : emitTsExprForRN(tKey);
      const vs = emitTsExprForRN(tVal);
      const comment = origKs !== null && origKs !== transKs ? ' /* kebab→camel for RN */' : '';
      parts.push(`${transKs}: ${vs}${comment}`);
    }
    return `{ ${parts.join(', ')} }`;
  }
  return emitTsExprForRN(value);
}

function emitRnPropDictAttrs(
  propDict: readonly { readonly key: string; readonly value: IonIRNode }[],
): string {
  if (propDict.length === 0) return '';
  return ' ' + propDict.map(({ key, value }) =>
    key === 'style'
      ? `style={${emitRnStyleValue(value)}}`
      : `${key}={${emitTsExprForRN(value)}}`
  ).join(' ');
}

function emitRnJsxNode(node: IonIRNode, indent = 0, inTextContext = false): string {
  const pad = '  '.repeat(indent);
  const innerPad = '  '.repeat(indent + 1);
  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Str') {
        if (!v.value) return '';
        return inTextContext ? v.value : `{${JSON.stringify(v.value)}}`;
      }
      if (v.kind === 'Int' || v.kind === 'Float') return `{${v.value}}`;
      if (v.kind === 'Bool') return `{${v.value}}`;
      return '';
    }
    case 'Var': {
      const name = (node as VarNode).name;
      if (name.includes('=')) return '';
      return `{${name}}`;
    }
    case 'App': {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const tagName = (app.callee as VarNode).name;
        if (HTML_TAGS.has(tagName)) {
          if (tagName === 'select' || tagName === 'option') {
            return `${pad}{/* <${tagName}> not supported on RN — use @react-native-picker/picker */}`;
          }
          if (RN_STRIPPED_TAGS.has(tagName)) return '';
          if (tagName === 'img') {
            _rnImports.add('Image');
            const attrRaw = app.args.length > 0 ? getAttrRaw(app.args[0]!) : '';
            const commentChildren: string[] = [];
            let sourceProp = '';
            const sourceDictEntry = app.propDict?.find(p => p.key === 'source');
            if (sourceDictEntry) {
              sourceProp = `source={${emitTsExprForRN(sourceDictEntry.value)}}`;
            } else {
              const srcMatch = attrRaw.match(/\bsrc=(\S+)/);
              if (!srcMatch) {
                commentChildren.push(`{/* missing src on <Image> */}`);
              } else {
                const srcVal = srcMatch[1]!;
                if (srcVal.startsWith('require:')) {
                  sourceProp = `source={require("${srcVal.slice(8)}")}`;
                } else {
                  sourceProp = `source={{ uri: "${srcVal}" }}`;
                }
              }
            }
            const remainingAttrRaw = attrRaw.replace(/\bsrc=\S+/, '').trim();
            const { attrStr, commentChildren: extraComments } = parseRnAttrString(remainingAttrRaw, 'img');
            commentChildren.push(...extraComments);
            const allAttrParts = [sourceProp, attrStr].filter(Boolean).join(' ');
            const attrPart = allAttrParts ? ` ${allAttrParts}` : '';
            const childrenStrs = [
              ...commentChildren.map(c => `${innerPad}${c}`),
              ...app.args.slice(1).map(c => emitRnJsxNode(c, indent + 1)).filter(s => s.trim()),
            ];
            if (childrenStrs.length === 0) return `${pad}<Image${attrPart} />`;
            return `${pad}<Image${attrPart}>\n${childrenStrs.join('\n')}\n${pad}</Image>`;
          }
          const { component, isContainer, isText } = lookupPrimitive(tagName);
          if (!component) return '';
          const attrRaw = app.args.length > 0 ? getAttrRaw(app.args[0]!) : '';
          const { attrStr, commentChildren } = parseRnAttrString(attrRaw, tagName);
          const attrPart = attrStr ? ` ${attrStr}` : '';
          const propDictStr = app.propDict ? emitRnPropDictAttrs(app.propDict) : '';
          const allAttrs = attrPart + propDictStr;
          const childInTextCtx = isText ? true : (isContainer ? false : inTextContext);
          const childrenStrs = [
            ...commentChildren.map(c => `${innerPad}${c}`),
            ...app.args.slice(1).map(c => emitRnJsxNode(c, indent + 1, childInTextCtx)).filter(s => s.trim()),
          ];
          if (childrenStrs.length === 0) return `${pad}<${component}${allAttrs} />`;
          return `${pad}<${component}${allAttrs}>\n${childrenStrs.join('\n')}\n${pad}</${component}>`;
        }
        if (/^[A-Z]/.test(tagName)) {
          const first = app.args[0];
          const hasAttrStr = first !== undefined && first.kind === 'Literal' && first.value.kind === 'Str';
          const rawAttr = hasAttrStr ? (first.value as { value: string }).value : '';
          const { attrStr, commentChildren } = parseRnAttrString(rawAttr, tagName.toLowerCase());
          const attrPart = attrStr ? ` ${attrStr}` : '';
          const propDictStr = app.propDict ? emitRnPropDictAttrs(app.propDict) : '';
          const allAttrs = attrPart + propDictStr;
          const childArgs = hasAttrStr ? app.args.slice(1) : app.args;
          const childInTextCtx = RN_TEXT_PRIMITIVES.has(tagName) ? true
            : RN_CONTAINER_PRIMITIVES.has(tagName) ? false
            : inTextContext;
          const childrenStrs = [
            ...commentChildren.map(c => `${innerPad}${c}`),
            ...childArgs.map(c => emitRnJsxNode(c, indent + 1, childInTextCtx)).filter(s => s.trim()),
          ];
          if (childrenStrs.length === 0) return `${pad}<${tagName}${allAttrs} />`;
          return `${pad}<${tagName}${allAttrs}>\n${childrenStrs.join('\n')}\n${pad}</${tagName}>`;
        }
      }
      return `{${emitTsExprForRN(node)}}`;
    }
    case 'Abs': return emitRnJsxNode((node as AbsNode).body, indent, inTextContext);
    case 'Effect': return emitRnJsxNode(node.body, indent, inTextContext);
    case 'RawInject': return node.code;
    default: return `{${emitTsExprForRN(node)}}`;
  }
}

interface RnEmitConfig {
  reactNative?: { entryComponent?: string | null; styleHoistThreshold?: number };
}

export function emitReactNative(irModule: IonIRModule, config?: RnEmitConfig): string {
  irModule = shakePreludeDecls(irModule);

  _rnCtorFields = new Map();
  for (const d of irModule.data) {
    for (const v of d.variants) {
      _rnCtorFields.set(v.tag, v.fields.map(f => f.name));
    }
  }

  _rnImports = new Set<string>(['View', 'Text']);

  const threshold = Math.max(2, config?.reactNative?.styleHoistThreshold ?? 3);
  const { replacements, hoisted } = collectAndHoistStyles(irModule, threshold);
  _styleReplacements = replacements;
  if (hoisted.length > 0) _rnImports.add('StyleSheet');

  const declParts: string[] = [];

  const entryName = config?.reactNative?.entryComponent !== undefined
    ? config.reactNative.entryComponent
    : 'App';
  let foundEntryComponent = false;

  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      const lt = d as LetNode;
      const { name, value } = lt;
      if (value.kind === 'Abs') {
        const abs = value as AbsNode;
        const params = abs.params.map(p => p.name).join(', ');
        const body = emitRnJsxNode(abs.body, 1);
        const isJsx = body.trim().startsWith('<') || body.trim().startsWith('{/*');
        if (isJsx && entryName !== null && name === entryName) foundEntryComponent = true;
        if (isJsx) {
          declParts.push(`const ${name}: React.FC = (${params}) => (`);
          declParts.push(`  ${body.trim()}`);
          declParts.push(`);`);
        } else {
          declParts.push(`const ${name} = (${params}) => ${emitTsExprForRN(abs.body)};`);
        }
      } else if (isHtmlElement(value)) {
        const jsx = emitRnJsxNode(value, 1);
        declParts.push(`const ${name}: React.FC = () => (`);
        declParts.push(`  ${jsx.trim()}`);
        declParts.push(`);`);
      } else {
        declParts.push(`const ${name} = ${emitTsExprForRN(value)};`);
      }
    }
  }

  if (hoisted.length > 0) {
    const styleEntries = hoisted.map(({ name, body }) => `  ${name}: ${body},`).join('\n');
    declParts.push(`const styles = StyleSheet.create({\n${styleEntries}\n});`);
  }

  if (foundEntryComponent && entryName !== null) {
    _rnImports.add('AppRegistry');
    declParts.push(`AppRegistry.registerComponent('${entryName}', () => ${entryName});`);
  }

  const parts: string[] = [
    '"use strict";',
    "import React from 'react';",
    `import { ${[..._rnImports].join(', ')} } from 'react-native';`,
    '',
    ...declParts,
  ];

  return parts.join('\n') + '\n';
}
