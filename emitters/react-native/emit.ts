import type {
  IonIRModule,
  IonIRNode,
  LetNode,
} from '../../src/ir/nodes.js';
import { isHtmlElement } from '../ui-shared.js';
import { shakePreludeDecls } from '../../src/prelude/dce.js';

export function emitReactNative(irModule: IonIRModule): string {
  irModule = shakePreludeDecls(irModule);

  const parts: string[] = [
    '"use strict";',
    "import React from 'react';",
    "import { View, Text } from 'react-native';",
    '',
  ];

  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      const lt = d as LetNode;
      const { name, value } = lt;
      if (value.kind === 'Abs' || isHtmlElement(value)) {
        parts.push(`const ${name}: React.FC = () => ();`);
      } else {
        parts.push(`const ${name} = /* TODO */;`);
      }
    }
  }

  return parts.join('\n') + '\n';
}
