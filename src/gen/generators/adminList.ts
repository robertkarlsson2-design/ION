import type { AdminListSpec, FilterSpec } from '../parsers/adminList.js';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function filterStateVar(f: FilterSpec): string {
  return `${f.field}Filter`;
}

export function generateAdminList(spec: AdminListSpec): string {
  const { name, apiPath, paginated, search, filters, columns, rowActions } = spec;

  // Determine which hooks we need
  const hasConfirm = rowActions.some(a => a.includes('delete') || a.includes('remove') || a.includes('flip'));
  const hasDrawer = rowActions.includes('view');

  const imports = [
    `import { useState, useEffect${search ? ', useRef' : ''} } from 'react';`,
    `import { apiGet${rowActions.length ? ', apiPatch, apiPost' : ''} } from '../../lib/apiClient';`,
    `import { DataTable } from '../../components/admin/DataTable';`,
    `import { PageHeader } from '../../components/admin/PageHeader';`,
    ...(hasConfirm ? [`import { ConfirmDialog } from '../../components/admin/ConfirmDialog';`] : []),
    ...(spec.filters.length > 0 || search ? [] : []),
  ].filter(Boolean);

  const PAGE_SIZE = 50;

  // State declarations
  const stateDecls: string[] = [
    `  const [rows, setRows] = useState<any[]>([]);`,
    `  const [loading, setLoading] = useState(false);`,
  ];
  if (paginated) {
    stateDecls.push(`  const [page, setPage] = useState(1);`);
    stateDecls.push(`  const [total, setTotal] = useState(0);`);
  }
  if (search) {
    stateDecls.push(`  const [searchInput, setSearchInput] = useState('');`);
    stateDecls.push(`  const [appliedQ, setAppliedQ] = useState('');`);
    stateDecls.push(`  const debounceRef = useRef<any>(null);`);
  }
  for (const f of filters) {
    stateDecls.push(`  const [${filterStateVar(f)}, set${capitalize(filterStateVar(f))}] = useState('');`);
  }
  if (hasDrawer) {
    stateDecls.push(`  const [detailRow, setDetailRow] = useState<any>(null);`);
    stateDecls.push(`  const [drawerOpen, setDrawerOpen] = useState(false);`);
  }
  if (hasConfirm) {
    stateDecls.push(`  const [actionTarget, setActionTarget] = useState<any>(null);`);
    stateDecls.push(`  const [confirmOpen, setConfirmOpen] = useState(false);`);
  }

  // Fetch effect deps
  const fetchDeps = [
    ...(paginated ? ['page'] : []),
    ...(search ? ['appliedQ'] : []),
    ...filters.map(filterStateVar),
  ];

  const paramLines: string[] = [
    ...(paginated ? [`    const params = new URLSearchParams({ page: String(page), pageSize: String(${PAGE_SIZE}) });`] : [
      `    const params = new URLSearchParams();`,
    ]),
    ...(search ? [`    if (appliedQ) params.set('q', appliedQ);`] : []),
    ...filters.map(f => `    if (${filterStateVar(f)}) params.set('${f.field}', ${filterStateVar(f)});`),
  ];

  const fetchEffect = [
    `  useEffect(() => {`,
    `    let cancelled = false;`,
    `    setLoading(true);`,
    ...paramLines,
    `    apiGet(\`${apiPath}?\` + params.toString()).then((r: any) => {`,
    `      if (cancelled) return;`,
    `      if (r.ok) {`,
    `        setRows(r.data.data);`,
    ...(paginated ? [`        setTotal(r.data.pagination?.total ?? 0);`] : []),
    `      }`,
    `      setLoading(false);`,
    `    }).catch(() => { if (!cancelled) setLoading(false); });`,
    `    return () => { cancelled = true; };`,
    `  }, [${fetchDeps.join(', ')}]);`,
  ];

  // Debounce effect for search
  const debounceEffect = search ? [
    ``,
    `  useEffect(() => {`,
    `    clearTimeout(debounceRef.current);`,
    `    debounceRef.current = setTimeout(() => {`,
    ...(paginated ? [`      setPage(1);`] : []),
    `      setAppliedQ(searchInput);`,
    `    }, 300);`,
    `    return () => clearTimeout(debounceRef.current);`,
    `  }, [searchInput]);`,
  ] : [];

  // Column definitions
  const colDefs = columns.map(col => {
    const label = col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `    { key: '${col}', label: '${label}', render: (r: any) => r.${col} ?? '—' },`;
  });
  if (rowActions.length > 0) {
    const actionBtns = rowActions.map(a =>
      `<button onClick={() => handle${capitalize(a)}(r)} className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50">${a}</button>`
    ).join('');
    colDefs.push(`    { key: 'actions', label: 'Actions', render: (r: any) => (<div className="flex gap-2">${actionBtns}</div>) },`);
  }

  // Action handlers
  const actionHandlers: string[] = [];
  for (const action of rowActions) {
    if (action === 'view') {
      actionHandlers.push(
        `  const handleView = (row: any) => {`,
        `    setDrawerOpen(true); setDetailRow(null);`,
        `    apiGet(\`${apiPath}/\${row.id}\`).then((r: any) => { if (r.ok) setDetailRow(r.data); });`,
        `  };`,
      );
    } else {
      actionHandlers.push(
        `  const handle${capitalize(action)} = (row: any) => {`,
        `    setActionTarget(row);`,
        `    setConfirmOpen(true);`,
        `  };`,
        `  const handleConfirm${capitalize(action)} = async () => {`,
        `    if (!actionTarget) return;`,
        `    // TODO: implement ${action} action`,
        `    setConfirmOpen(false);`,
        `    setActionTarget(null);`,
        `  };`,
      );
    }
  }

  // Render
  const filterButtons = filters.flatMap(f => [
    `      <div className="flex gap-2">`,
    `        {['', ${f.values.map(v => `'${v}'`).join(', ')}].map(v => (`,
    `          <button key={v} onClick={() => { set${capitalize(filterStateVar(f))}(v);${paginated ? ' setPage(1);' : ''} }}`,
    `            className={'px-3 py-1 rounded-full text-xs font-medium border ' + (${filterStateVar(f)} === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300')}>`,
    `            {v === '' ? 'All' : v}`,
    `          </button>`,
    `        ))}`,
    `      </div>`,
  ]);

  const renderLines: string[] = [
    `  return (`,
    `    <div className="p-8 max-w-7xl mx-auto">`,
    `      <PageHeader title="${name}" subtitle={total + ' total'} />`,
    ...(search || filters.length > 0 ? [
      `      <div className="flex flex-wrap items-center gap-3 mb-6">`,
      ...(search ? [
        `        <input type="text" placeholder="Search..." value={searchInput}`,
        `          onChange={e => setSearchInput(e.target.value)}`,
        `          className="flex-1 min-w-60 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none" />`,
      ] : []),
      ...filterButtons,
      `      </div>`,
    ] : []),
    `      <DataTable`,
    `        columns={[`,
    ...colDefs.map(l => '          ' + l),
    `        ]}`,
    `        rows={rows}`,
    `        loading={loading}`,
    `        emptyMessage="No results found."`,
    ...(paginated ? [
      `        page={page}`,
      `        pageSize={${PAGE_SIZE}}`,
      `        total={total}`,
      `        onPageChange={setPage}`,
    ] : []),
    `      />`,
    ...(hasConfirm ? [
      `      <ConfirmDialog`,
      `        open={confirmOpen}`,
      `        title="Confirm action"`,
      `        body="Are you sure?"`,
      `        confirmLabel="Confirm"`,
      `        onConfirm={handleConfirmFlipRole}`,
      `        onCancel={() => { setConfirmOpen(false); setActionTarget(null); }}`,
      `      />`,
    ] : []),
    `    </div>`,
    `  );`,
  ];

  return [
    ...imports,
    ``,
    `const ${name}: React.FC = () => {`,
    ...stateDecls,
    ``,
    ...fetchEffect,
    ...debounceEffect,
    ``,
    ...actionHandlers,
    ``,
    ...renderLines,
    `};`,
    ``,
    `export { ${name} };`,
    ``,
  ].join('\n');
}
