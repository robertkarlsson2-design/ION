import type { ServiceSpec, QuerySpec, TransactionSpec, QueryReturn } from '../parsers/query.js';

function emitReturnType(r: QueryReturn): string {
  if (r.kind === 'rows') return 'Promise<any[]>';
  if (r.kind === 'firstOrNull') return 'Promise<any | null>';
  if (r.kind === 'void') return 'Promise<void>';
  const errUnions = r.errCodes.map(c => `{ err: '${c}' }`).join(' | ');
  return `Promise<{ ok: true } | ${errUnions}>`;
}

function emitQuery(spec: QuerySpec): string {
  const paramList = spec.params.map(p => `${p}: string`).join(', ');
  const paramArray = spec.params.length > 0 ? `[${spec.params.join(', ')}]` : '[]';
  const returnType = emitReturnType(spec.returns);

  const body: string[] = [
    `  const r = await pool.query(`,
    `    '${spec.sql.replace(/'/g, "\\'")}',`,
    `    ${paramArray}`,
    `  );`,
  ];

  if (spec.returns.kind === 'rows') body.push(`  return r.rows;`);
  else if (spec.returns.kind === 'firstOrNull') body.push(`  return r.rows[0] ?? null;`);
  else if (spec.returns.kind === 'void') body.push(`  // no return value`);
  else body.push(`  return r.rowCount && r.rowCount > 0 ? { ok: true } : { err: '${spec.returns.errCodes[0]}' as const };`);

  return [
    `export async function ${spec.name}(${paramList}): ${returnType} {`,
    ...body,
    `}`,
  ].join('\n');
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function emitTransaction(spec: TransactionSpec): string {
  const paramList = spec.params.map(p => `${p}: string`).join(', ');
  const returnType = emitReturnType(spec.returns);

  const stmtLines: string[] = [];
  const declaredVars: string[] = [];

  for (let i = 0; i < spec.statements.length; i++) {
    const stmt = spec.statements[i];
    // Figure out params for this statement ($N references)
    const allVars = [...spec.params, ...declaredVars];
    // Build param array in order of $1, $2...
    const refs = [...stmt.sql.matchAll(/\$(\w+)/g)].map(m => m[1]);
    const paramArr = refs
      .map(ref => {
        const num = parseInt(ref, 10);
        if (!isNaN(num)) return allVars[num - 1] || `param${num}`;
        return toCamel(ref);
      });
    const paramArrayStr = paramArr.length > 0 ? `[${paramArr.join(', ')}]` : '[]';
    // Normalize $alias -> $N
    const sql = stmt.sql.replace(/\$(\w+)/g, (m, ref) => {
      const num = parseInt(ref, 10);
      if (!isNaN(num)) return m;
      const idx = allVars.indexOf(toCamel(ref));
      return idx >= 0 ? `$${idx + 1}` : m;
    });

    if (stmt.returningAlias) {
      const varName = toCamel(stmt.returningAlias);
      declaredVars.push(varName);
      stmtLines.push(
        `    const r${i + 1} = await client.query(`,
        `      \`${sql.replace(/`/g, '\\`')}\`,`,
        `      ${paramArrayStr}`,
        `    );`,
      );
      if (spec.returns.kind === 'discriminated') {
        stmtLines.push(
          `    if (!r${i + 1}.rowCount) return { err: '${spec.returns.errCodes[0]}' as const };`,
          `    const ${varName} = r${i + 1}.rows[0].${stmt.returningAlias};`,
        );
      } else {
        stmtLines.push(`    const ${varName} = r${i + 1}.rows[0]?.${stmt.returningAlias};`);
      }
    } else {
      stmtLines.push(
        `    await client.query(`,
        `      \`${sql.replace(/`/g, '\\`')}\`,`,
        `      ${paramArrayStr}`,
        `    );`,
      );
    }
  }

  const returnStmt = spec.returns.kind === 'discriminated'
    ? `    return { ok: true as const };`
    : `    // void`;

  return [
    `export async function ${spec.name}(${paramList}): ${returnType} {`,
    `  const client = await pool.connect();`,
    `  try {`,
    `    await client.query('BEGIN');`,
    ...stmtLines,
    returnStmt,
    `  } catch (e) {`,
    `    await client.query('ROLLBACK');`,
    `    throw e;`,
    `  } finally {`,
    `    client.release();`,
    `    await client.query('COMMIT');`,
    `  }`,
    `}`,
  ].join('\n');
}

export function generateServiceFile(specs: ServiceSpec[]): string {
  const fns = specs.map(s => s.kind === 'query' ? emitQuery(s) : emitTransaction(s));
  return [
    `import { pool } from '../../models/db';`,
    '',
    ...fns,
    '',
  ].join('\n');
}
