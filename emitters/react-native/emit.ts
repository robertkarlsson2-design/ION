import type {
  IonIRModule,
  IonIRNode,
  LetNode,
} from '../../src/ir/nodes.js';
import { isHtmlElement, emitTsExpr } from '../ui-shared.js';
import { shakePreludeDecls } from '../../src/prelude/dce.js';

export function emitReactNative(irModule: IonIRModule): string {
  irModule = shakePreludeDecls(irModule);

  const ctorFields = new Map<string, readonly string[]>();
  for (const d of irModule.data) {
    for (const v of d.variants) {
      ctorFields.set(v.tag, v.fields.map(f => f.name));
    }
  }

  const rnImports = new Set<string>(['View', 'Text']);
  const declParts: string[] = [];

  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      const lt = d as LetNode;
      const { name, value } = lt;
      if (value.kind === 'Abs' || isHtmlElement(value)) {
        declParts.push(`const ${name}: React.FC = () => ();`);
      } else {
        declParts.push(`const ${name} = ${emitTsExpr(value, { ctorFields, rnImports })};`);
      }
    }
  }

  const parts: string[] = [
    '"use strict";',
    "import React from 'react';",
    `import { ${[...rnImports].join(', ')} } from 'react-native';`,
    '',
    ...declParts,
  ];

  return parts.join('\n') + '\n';
}
