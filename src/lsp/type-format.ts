import type { IonType } from '../ir/types.js';

/** Format an IonType as a concise human-readable string for hover Markdown. */
export function formatIonType(t: IonType): string {
  switch (t.kind) {
    case 'Int': return 'Int';
    case 'Float': return 'Float';
    case 'Str': return 'Str';
    case 'Bool': return 'Bool';
    case 'Null': return 'Null';
    case 'Unit': return 'Unit';
    case 'Never': return 'Never';
    case 'List': return `List[${formatIonType(t.elem)}]`;
    case 'Map': return `Map[${formatIonType(t.key)}, ${formatIonType(t.value)}]`;
    case 'Option': return `Option[${formatIonType(t.inner)}]`;
    case 'Result': return `Result[${formatIonType(t.ok)}, ${formatIonType(t.err)}]`;
    case 'Fn': {
      const params = t.params.map(formatIonType).join(', ');
      const base = `Fn(${params}) -> ${formatIonType(t.ret)}`;
      if (t.effects.size === 0) return base;
      const effects = [...t.effects].sort().join(' ');
      return `${base} { ${effects} }`;
    }
    case 'User': {
      if (t.args.length === 0) return t.name;
      return `${t.name}[${t.args.map(formatIonType).join(', ')}]`;
    }
    case 'TypeVar': return `'t${t.id}`;
  }
}
