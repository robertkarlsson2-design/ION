// Admin paginated list .def parser
// Syntax:
//   ComponentName  /admin/path  paginated  [search]  [filter=field[val1|val2|...]]
//     columns: col1 col2 col3
//     row-actions: action1  action2

export interface FilterSpec {
  field: string;
  values: string[];
}

export interface AdminListSpec {
  name: string;
  apiPath: string;
  paginated: boolean;
  search: boolean;
  filters: FilterSpec[];
  columns: string[];
  rowActions: string[];
}

export function parseAdminList(src: string): AdminListSpec {
  const lines = src.split('\n').map(l => l.trimEnd()).filter(l => l.trim() && !l.trim().startsWith('#'));

  // Header line: ComponentName /admin/path paginated [search] [filter=field[v1|v2]]
  const header = lines[0].trim().split(/\s+/);
  const name = header[0];
  const apiPath = header[1];
  const paginated = header.includes('paginated');
  const search = header.includes('search');
  const filters: FilterSpec[] = header
    .filter(p => p.startsWith('filter='))
    .map(p => {
      const rest = p.slice(7); // strip 'filter='
      const m = rest.match(/^(\w+)\[([^\]]+)\]$/);
      if (!m) throw new Error(`Invalid filter spec: ${p}`);
      return { field: m[1], values: m[2].split('|') };
    });

  let columns: string[] = [];
  let rowActions: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('columns:')) {
      columns = trimmed.slice(8).trim().split(/\s+/).filter(Boolean);
    } else if (trimmed.startsWith('row-actions:')) {
      rowActions = trimmed.slice(12).trim().split(/\s+/).filter(Boolean);
    }
  }

  return { name, apiPath, paginated, search, filters, columns, rowActions };
}
