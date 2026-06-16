// React feature screen .def parser
// Syntax:
//   ComponentName
//     load:
//       varName <- GET /path
//       varName <- GET /path?query=value
//     actions:
//       actionName(param) -> POST /path/:param -> reload
//       actionName(param) -> DEL /path/:param  -> reload
//     render: @custom

export interface LoadSpec {
  varName: string;
  method: 'GET' | 'POST';
  path: string;
}

export interface ActionSpec {
  name: string;
  params: string[];
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DEL';
  path: string;         // may contain :param
  pathParams: string[]; // params that appear in path as :param
  bodyParams: string[]; // params passed as body
  effect: 'reload' | 'navigate';
  navigateTo?: string | undefined;
}

export interface ScreenSpec {
  name: string;
  loads: LoadSpec[];
  actions: ActionSpec[];
  renderMode: '@custom' | 'generated';
}

export function parseScreen(src: string): ScreenSpec {
  const lines = src.split('\n').map(l => l.trimEnd()).filter(l => !l.trim().startsWith('#'));
  let i = 0;

  // First line: component name
  const name = lines[i].trim();
  i++;

  const loads: LoadSpec[] = [];
  const actions: ActionSpec[] = [];
  let renderMode: ScreenSpec['renderMode'] = '@custom';
  let section: 'none' | 'load' | 'actions' | 'render' = 'none';

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    if (trimmed === 'load:') { section = 'load'; i++; continue; }
    if (trimmed === 'actions:') { section = 'actions'; i++; continue; }
    if (trimmed.startsWith('render:')) {
      section = 'render';
      renderMode = trimmed.includes('@custom') ? '@custom' : 'generated';
      i++; continue;
    }

    if (section === 'load' && (line.startsWith('    ') || line.startsWith('\t\t'))) {
      // varName <- METHOD /path
      const m = trimmed.match(/^(\w+)\s*<-\s*(GET|POST)\s+(\S+)$/);
      if (m) loads.push({ varName: m[1], method: m[2] as LoadSpec['method'], path: m[3] });
    } else if (section === 'actions' && (line.startsWith('    ') || line.startsWith('\t\t'))) {
      // name(params) -> METHOD /path -> effect
      const m = trimmed.match(/^(\w+)\(([^)]*)\)\s*->\s*(GET|POST|PUT|PATCH|DEL)\s+(\S+)\s*->\s*(\w+)(.*)$/);
      if (m) {
        const params = m[2].split(',').map(p => p.trim()).filter(Boolean);
        const path = m[4];
        // Find which params appear in the path as :param
        const pathParams = params.filter(p => path.includes(`:${p}`));
        const bodyParams = params.filter(p => !path.includes(`:${p}`) && m[3] !== 'GET');
        actions.push({
          name: m[1],
          params,
          method: m[3] as ActionSpec['method'],
          path,
          pathParams,
          bodyParams,
          effect: m[5] === 'reload' ? 'reload' : 'navigate',
          navigateTo: m[5] !== 'reload' ? m[5] : undefined,
        });
      }
    }

    i++;
  }

  return { name, loads, actions, renderMode };
}
