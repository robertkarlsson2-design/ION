import type { ScreenSpec, LoadSpec, ActionSpec } from '../parsers/screen.js';

function httpFn(method: ActionSpec['method'] | LoadSpec['method']): string {
  const map: Record<string, string> = { GET: 'apiGet', POST: 'apiPost', PUT: 'apiPut', PATCH: 'apiPatch', DEL: 'apiDel' };
  return map[method] ?? 'apiGet';
}

function interpolatePath(path: string, params: string[]): string {
  let result = path;
  for (const p of params) result = result.replace(`:${p}`, `\${${p}}`);
  return result.includes('${') ? `\`${result}\`` : `'${result}'`;
}

function emitLoadBody(loads: LoadSpec[]): string[] {
  if (loads.length === 0) return [];
  if (loads.length === 1) {
    const l = loads[0];
    return [
      `    setLoading(true);`,
      `    const res = await ${httpFn(l.method)}('${l.path}');`,
      `    if (res.ok) set${l.varName.charAt(0).toUpperCase() + l.varName.slice(1)}(res.data.data ?? []);`,
      `    setLoading(false);`,
    ];
  }
  // Parallel
  const calls = loads.map(l => `${httpFn(l.method)}('${l.path}')`).join(', ');
  const vars = loads.map(l => `${l.varName}Res`).join(', ');
  const lines: string[] = [
    `    setLoading(true);`,
    `    const [${vars}] = await Promise.all([${calls}]);`,
  ];
  for (const l of loads) {
    const cap = l.varName.charAt(0).toUpperCase() + l.varName.slice(1);
    lines.push(`    if (${l.varName}Res.ok) set${cap}(${l.varName}Res.data.data ?? []);`);
  }
  lines.push(`    setLoading(false);`);
  return lines;
}

function emitAction(a: ActionSpec): string[] {
  const paramList = a.params.map(p => `${p}: string`).join(', ');
  const path = interpolatePath(a.path, a.pathParams);
  const bodyArg = a.bodyParams.length > 0
    ? `{ ${a.bodyParams.join(', ')} }`
    : a.method === 'DEL' ? 'null' : '{}';
  const callArgs = a.method === 'GET' ? path : `${path}, ${bodyArg}`;
  const effect = a.effect === 'reload' ? `await load();` : `navigate('${a.navigateTo}');`;

  return [
    `  const ${a.name} = async (${paramList}) => {`,
    `    await ${httpFn(a.method)}(${callArgs});`,
    `    ${effect}`,
    `  };`,
  ];
}

export function generateScreen(spec: ScreenSpec, apiClientPath = '../../lib/apiClient'): string {
  const usedApiFns = new Set<string>();
  for (const l of spec.loads) usedApiFns.add(httpFn(l.method));
  for (const a of spec.actions) usedApiFns.add(httpFn(a.method));

  const hooks: string[] = ['useState', 'useCallback', 'useEffect'];
  const imports: string[] = [
    `import { ${hooks.join(', ')} } from 'react';`,
    `import { ${Array.from(usedApiFns).join(', ')} } from '${apiClientPath}';`,
  ];

  // State declarations
  const stateDecls: string[] = [];
  for (const l of spec.loads) {
    const cap = l.varName.charAt(0).toUpperCase() + l.varName.slice(1);
    stateDecls.push(`  const [${l.varName}, set${cap}] = useState<any[]>([]);`);
  }
  stateDecls.push(`  const [loading, setLoading] = useState(true);`);

  // load callback
  const loadBody = emitLoadBody(spec.loads);
  const loadFn: string[] = [
    `  const load = useCallback(async () => {`,
    ...loadBody,
    `  }, []);`,
    ``,
    `  useEffect(() => { load(); }, [load]);`,
  ];

  // action handlers
  const actionBlocks = spec.actions.flatMap(a => emitAction(a));

  const renderComment = spec.renderMode === '@custom'
    ? [`  // @custom — render JSX goes here`]
    : [];

  return [
    ...imports,
    ``,
    `const ${spec.name}: React.FC = () => {`,
    ...stateDecls,
    ``,
    ...loadFn,
    ``,
    ...actionBlocks,
    ``,
    ...renderComment,
    `  return null;`,
    `};`,
    ``,
    `export { ${spec.name} };`,
    ``,
  ].join('\n');
}
