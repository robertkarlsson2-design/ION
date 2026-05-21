// Query/transaction .def parser
// Syntax:
//   query fnName(param1, param2)
//     SQL: SELECT ...
//     -> rows | first | null | first | null | ok | ERR_CODE
//
//   transaction fnName(params)
//     SQL statement 1 [RETURNING col]
//     SQL statement 2
//     -> ok | ERR_CODE

export type QueryReturn =
  | { kind: 'rows' }
  | { kind: 'firstOrNull' }
  | { kind: 'void' }
  | { kind: 'discriminated'; errCodes: string[] };

export interface QuerySpec {
  kind: 'query';
  name: string;
  params: string[];
  sql: string;
  returns: QueryReturn;
}

export interface TransactionStatement {
  sql: string;
  returningAlias?: string | undefined;
}

export interface TransactionSpec {
  kind: 'transaction';
  name: string;
  params: string[];
  statements: TransactionStatement[];
  returns: QueryReturn;
}

export type ServiceSpec = QuerySpec | TransactionSpec;

export function parseServiceFile(src: string): ServiceSpec[] {
  const lines = src.split('\n').map(l => l.trimEnd());
  const specs: ServiceSpec[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) { i++; continue; }

    if (line.startsWith('query ')) {
      const spec = parseQueryBlock(lines, i);
      specs.push(spec.result);
      i = spec.nextLine;
    } else if (line.startsWith('transaction ')) {
      const spec = parseTransactionBlock(lines, i);
      specs.push(spec.result);
      i = spec.nextLine;
    } else {
      i++;
    }
  }

  return specs;
}

function parseFnHeader(line: string, keyword: string): { name: string; params: string[] } {
  const rest = line.slice(keyword.length).trim();
  const m = rest.match(/^(\w+)\(([^)]*)\)/);
  if (!m) throw new Error(`Invalid header: ${line}`);
  const params = m[2].split(',').map(p => p.trim()).filter(Boolean);
  return { name: m[1], params };
}

function parseReturn(token: string): QueryReturn {
  if (token === 'rows') return { kind: 'rows' };
  if (token === 'void') return { kind: 'void' };
  if (token === 'first') return { kind: 'firstOrNull' }; // "first | null" becomes firstOrNull
  const codes = token.split('|').map(s => s.trim()).filter(s => s && s !== 'ok');
  if (codes.length > 0) return { kind: 'discriminated', errCodes: codes };
  return { kind: 'void' };
}

function parseQueryBlock(lines: string[], start: number): { result: QuerySpec; nextLine: number } {
  const header = parseFnHeader(lines[start].trim(), 'query ');
  let sql = '';
  let returns: QueryReturn = { kind: 'rows' };
  let i = start + 1;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || (!line.startsWith(' ') && !lines[i].startsWith('\t') && i > start + 1 && !line.startsWith('SQL:') && !line.startsWith('->') && !line.startsWith('#'))) break;
    if (line.startsWith('SQL:')) {
      sql = line.slice(4).trim();
    } else if (line.startsWith('->')) {
      const retParts = line.slice(2).trim().split(/\s*\|\s*/);
      returns = parseReturn(retParts[0]);
      // "first | null" -> firstOrNull
      if (retParts[0] === 'first' && retParts.includes('null')) returns = { kind: 'firstOrNull' };
    }
    i++;
  }

  return {
    result: { kind: 'query', name: header.name, params: header.params, sql, returns },
    nextLine: i,
  };
}

function parseTransactionBlock(lines: string[], start: number): { result: TransactionSpec; nextLine: number } {
  const header = parseFnHeader(lines[start].trim(), 'transaction ');
  const statements: TransactionStatement[] = [];
  let returns: QueryReturn = { kind: 'discriminated', errCodes: [] };
  let i = start + 1;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || (!raw.startsWith(' ') && !raw.startsWith('\t') && i > start)) {
      // check if truly end of block
      if (!line.startsWith('SQL:') && !line.startsWith('->') && !line.startsWith('UPDATE') &&
          !line.startsWith('INSERT') && !line.startsWith('DELETE') && !line.startsWith('SELECT') && line) break;
    }
    if (line.startsWith('->')) {
      const retParts = line.slice(2).trim().split(/\s*\|\s*/);
      const errCodes = retParts.filter(p => p !== 'ok');
      returns = errCodes.length > 0 ? { kind: 'discriminated', errCodes } : { kind: 'void' };
    } else if (line.match(/^(UPDATE|INSERT|DELETE|SELECT|WITH)\b/i)) {
      // Check for RETURNING clause to detect alias
      const retMatch = line.match(/RETURNING\s+(\w+)/i);
      statements.push({
        sql: line,
        returningAlias: retMatch ? retMatch[1] : undefined,
      });
    }
    i++;
  }

  return {
    result: { kind: 'transaction', name: header.name, params: header.params, statements, returns },
    nextLine: i,
  };
}
