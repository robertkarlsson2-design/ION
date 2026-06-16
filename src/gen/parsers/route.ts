// Route .def parser
// Input syntax:
//   /path  [auth]
//     METHOD /subpath  serviceFn(args)  [-> data|204|201|...]  [uuid:param]  [body.field...]
export interface RouteParam {
  name: string;
  source: 'path' | 'userId' | 'body' | 'query';
  fieldName?: string;  // for body.field
  validate?: 'uuid';
}

export interface RouteHandlerSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  subpath: string;
  serviceFn: string;
  serviceArgs: RouteParam[];
  returns: { type: 'data' } | { type: 'status'; code: number } | { type: 'status-data'; code: number };
  uuidParams: string[];
}

export interface RouteSpec {
  basePath: string;
  auth: boolean;
  handlers: RouteHandlerSpec[];
  // derived: file stem -> router export name
  routerExport?: string;
}

export function parseRoute(src: string, fileStem = 'resource'): RouteSpec {
  const lines = src.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '' && !l.trim().startsWith('#'));

  // First non-empty line: /path [auth]
  const header = lines[0].trim();
  const headerParts = header.split(/\s+/);
  const basePath = headerParts[0];
  const auth = headerParts.includes('auth');

  const handlers: RouteHandlerSpec[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith(' ') && !line.startsWith('\t')) continue; // skip non-indented

    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    // METHOD /subpath serviceFn(args) [-> return] [uuid:param]
    const method = parts[0].toUpperCase() as RouteHandlerSpec['method'];
    const subpath = parts[1];

    // Extract call expression robustly: grab from fn( to matching )
    const callMatch = trimmed.match(/\w+\s+\S+\s+(\w+\([^)]*\))/);
    if (!callMatch) throw new Error(`Invalid route line: ${trimmed}`);
    const callExpr = callMatch[1];
    // Tokens after the call expression
    const afterCall = trimmed.slice(trimmed.indexOf(callExpr) + callExpr.length).trim().split(/\s+/).filter(Boolean);

    // Parse service function and args
    const fnMatch = callExpr.match(/^(\w+)\(([^)]*)\)$/);
    if (!fnMatch) throw new Error(`Invalid call expression: ${callExpr}`);
    const serviceFn = fnMatch[1];
    const argTokens = fnMatch[2].split(',').map(a => a.trim()).filter(Boolean);

    const serviceArgs: RouteParam[] = argTokens.map(arg => {
      if (arg === 'userId') return { name: 'userId', source: 'userId' };
      if (arg.startsWith('body.')) return { name: arg.slice(5), source: 'body', fieldName: arg.slice(5) };
      if (arg.startsWith('?') || arg.startsWith('query.')) {
        const n = arg.replace(/^\?|^query\./, '');
        return { name: n, source: 'query', fieldName: n };
      }
      if (arg.startsWith(':')) return { name: arg.slice(1), source: 'path', fieldName: arg.slice(1) };
      return { name: arg, source: 'path', fieldName: arg };
    });

    // Parse return annotation (-> data | 204 | 201 | ...)
    const arrowIdx = afterCall.indexOf('->');
    let returns: RouteHandlerSpec['returns'] = { type: 'data' };
    if (arrowIdx !== -1) {
      const ret = afterCall[arrowIdx + 1];
      if (ret === 'data' || ret === undefined) returns = { type: 'data' };
      else {
        const code = parseInt(ret, 10);
        returns = { type: 'status', code };
      }
    }

    // Parse uuid: annotations
    const uuidParams = afterCall
      .filter(p => p.startsWith('uuid:'))
      .map(p => p.slice(5));

    handlers.push({ method, subpath, serviceFn, serviceArgs, returns, uuidParams });
  }

  return {
    basePath,
    auth,
    handlers,
    routerExport: `${fileStem}Router`,
  };
}
