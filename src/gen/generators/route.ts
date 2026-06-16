import type { RouteSpec, RouteHandlerSpec, RouteParam } from '../parsers/route.js';

function extractImports(handlers: RouteHandlerSpec[]): Set<string> {
  return new Set(handlers.map(h => h.serviceFn));
}

function needsUuidCheck(handlers: RouteHandlerSpec[]): boolean {
  return handlers.some(h => h.uuidParams.length > 0);
}

function emitParam(p: RouteParam): string {
  if (p.source === 'userId') return `req.user.id`;
  if (p.source === 'path') return `req.params.${p.fieldName}`;
  if (p.source === 'body') return `req.body?.${p.fieldName}`;
  if (p.source === 'query') return `req.query?.${p.fieldName}`;
  return p.name;
}

function emitHandler(h: RouteHandlerSpec): string {
  const method = h.method === 'DELETE' ? 'delete' : h.method.toLowerCase();
  const path = h.subpath;
  const lines: string[] = [];

  // UUID validations
  for (const param of h.uuidParams) {
    lines.push(`    const ${param} = req.params.${param};`);
    lines.push(`    if (!isUuid(${param})) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid UUID' } });`);
  }

  // Extract userId if needed
  if (h.serviceArgs.some(a => a.source === 'userId')) {
    lines.push(`    const userId = req.user.id;`);
  }

  // Extract body fields
  for (const a of h.serviceArgs.filter(a => a.source === 'body')) {
    lines.push(`    const ${a.name} = req.body?.${a.fieldName};`);
  }

  // Extract path params not already extracted via uuid:
  for (const a of h.serviceArgs.filter(a => a.source === 'path' && !h.uuidParams.includes(a.name))) {
    lines.push(`    const ${a.name} = req.params.${a.fieldName};`);
  }

  // Service call
  const argList = h.serviceArgs.map(a => {
    if (a.source === 'userId') return 'userId';
    return a.name;
  }).join(', ');

  if (h.returns.type === 'data') {
    lines.push(`    const data = await ${h.serviceFn}(${argList});`);
    lines.push(`    res.json({ data });`);
  } else if (h.returns.type === 'status') {
    if (h.returns.code === 204) {
      lines.push(`    await ${h.serviceFn}(${argList});`);
      lines.push(`    res.status(204).send();`);
    } else {
      lines.push(`    const result = await ${h.serviceFn}(${argList});`);
      lines.push(`    res.status(${h.returns.code}).json({ data: result });`);
    }
  }

  return [
    `router.${method}('${path}', async (req, res, next) => {`,
    `  try {`,
    ...lines.map(l => '  ' + l),
    `  } catch (err) { next(err); }`,
    `});`,
  ].join('\n');
}

export function generateRoute(spec: RouteSpec, serviceImportPath = '../../services'): string {
  const serviceFns = Array.from(extractImports(spec.handlers));
  const hasUuid = needsUuidCheck(spec.handlers);

  const importLines = [
    `import { Router } from 'express';`,
    `import { ${serviceFns.join(', ')} } from '${serviceImportPath}';`,
  ];
  if (hasUuid) importLines.push(`import { isUuid } from '../../middleware/sanitize';`);

  const handlerBlocks = spec.handlers.map(emitHandler).join('\n\n');

  return [
    ...importLines,
    '',
    `const router = Router();`,
    '',
    handlerBlocks,
    '',
    `export { router as ${spec.routerExport} };`,
    '',
  ].join('\n');
}
