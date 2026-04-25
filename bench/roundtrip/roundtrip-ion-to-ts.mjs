// ION → TypeScript: decode an advanced hand-crafted ION file and emit TypeScript
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { decodeModule } = require(join(__dirname, '../../dist/src/wire/decoder.js'));
const { emitTS } = require(join(__dirname, '../../dist/emitters/typescript/emit.js'));

// ── 1. Read the wire file ────────────────────────────────────────────────────
const ionText = readFileSync(join(__dirname, 'advanced-app.ion'), 'utf8');

console.log('=== advanced-app.ion wire format ===');
const lines = ionText.trim().split('\n');
console.log(`Header: ${lines[0]}`);
console.log(`Module: ${lines[1]}`);
const symLine = lines[2] ?? '';
const symCount = (symLine.match(/\b\w+=\S+/g) ?? []).length;
console.log(`Symbols: ${symCount} aliases in pool`);
const fLine = lines[3] ?? '';
const fnCount = (fLine.match(/\blet \w+:/g) ?? []).length;
const adtCount = (fLine.match(/\badt \w+{/g) ?? []).length;
console.log(`F section: ${adtCount} ADT declaration(s), ${fnCount} function(s)`);
console.log(`Wire size: ${ionText.length} bytes across ${lines.length} lines`);
console.log();

// ── 2. Decode wire → IonIR ───────────────────────────────────────────────────
const decoded = decodeModule(ionText);
if (decoded && 'error' in decoded) {
  console.error('Decode error:', decoded.error);
  process.exit(1);
}
const irModule = decoded;

const decls = irModule.decls ?? [];
const letDecls = decls.filter(d => d.kind === 'Let');
const adtDecls = decls.filter(d => d.kind === 'AdtDecl');

console.log('=== Decoded IonIR module ===');
console.log(`Module: ${irModule.module}  version: ${irModule.version}`);
console.log(`Declarations: ${decls.length} total (${adtDecls.length} ADT + ${letDecls.length} let)`);
if (adtDecls.length > 0) {
  for (const adt of adtDecls) {
    const variants = adt.variants?.map(v => `${v.tag}(${v.fields?.length ?? 0} fields)`).join(', ');
    console.log(`  ADT ${adt.name}: { ${variants} }`);
  }
}
console.log();

// ── 3. Emit TypeScript ────────────────────────────────────────────────────────
let emitted;
try {
  emitted = emitTS(irModule);
} catch (e) {
  console.error('Emit error:', e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

console.log('=== Emitted TypeScript (ION → TS) ===');
console.log(emitted);

// ── 4. Verification ───────────────────────────────────────────────────────────
console.log('=== Verification ===');
const expectedFunctions = [
  'filterByStatus', 'filterByPriority', 'filterByAssignee', 'filterByTag',
  'filterOverdue', 'filterCompleted', 'filterPending', 'filterByDateRange',
  'sortByPriority', 'sortByDueDate', 'sortByCreatedAt',
  'totalTasks', 'completionRate', 'overdueCount', 'highPriorityCount',
  'pendingCount', 'countWithStatus', 'assignedTasks', 'unassignedTasks', 'searchByTitle',
  'findById', 'findByAssignee',
  'isOverdue', 'isDone', 'isPending', 'isCritical', 'isCancelled',
  'getWorkload', 'getUserCompletionRate',
  'priorityScore', 'rankByScore', 'getHighPriorityPending',
  'statusLabel', 'priorityLabel',
  'taskAge', 'daysUntilDue', 'isExpiringSoon', 'getExpiringSoon',
  'topPriorityTask', 'paginateTasks', 'mergeTaskLists',
  'averagePriority', 'hasTag', 'tasksWithNoTags', 'validateTask',
  'taskTitle', 'overdueDurations', 'topNByPriority', 'getTaskTitle', 'chainFilter',
];

const found = expectedFunctions.filter(fn => emitted.includes(fn));
const missing = expectedFunctions.filter(fn => !emitted.includes(fn));

console.log(`Functions verified: ${found.length}/${expectedFunctions.length}`);
if (missing.length > 0) {
  console.log('Missing:', missing.join(', '));
}

// Check ADT emitted
const adtEmitted = emitted.includes('TaskFound') && emitted.includes('NotFound');
console.log(`ADT (TaskResult) emitted: ${adtEmitted ? 'YES' : 'NO'}`);

// Check advanced patterns
const checks = [
  ['OopVirtualCall chains (task.tags.includes)', emitted.includes('.includes(')],
  ['OopVirtualCall sort/filter', emitted.includes('.filter(') && emitted.includes('.sort(')],
  ['Builtin operators (+, -, *, /)', emitted.includes(' + ') && emitted.includes(' - ') && emitted.includes(' * ')],
  ['Equality (===, !==)', emitted.includes(' === ') && emitted.includes(' !== ')],
  ['Comparison (<, >=)', emitted.includes(' < ') && emitted.includes(' >= ')],
  ['Let bindings (const ... = ...)', emitted.includes('const userTasks')],
  ['Ternary (match → ?:)', emitted.includes(' ? ') && emitted.includes(' : ')],
  ['String patterns (statusLabel)', emitted.includes('"done"') && emitted.includes('"To Do"')],
  ['Number patterns (priorityLabel)', emitted.includes('"Low"') && emitted.includes('"Critical"')],
  ['AdtMatch (switch)', emitted.includes('switch')],
  ['String method chains (.toLowerCase)', emitted.includes('.toLowerCase()')],
  ['Slice pagination (.slice(', emitted.includes('.slice(')],
  ['Nested lambdas', emitted.includes('=> tasks.filter')],
  ['Multi-param lambdas', emitted.includes('(p1: never, p2: never)')],
];

console.log('\nAdvanced IR features in emitted code:');
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
}

console.log();
console.log('=== Size comparison ===');
console.log(`ION wire:    ${ionText.length} bytes (${lines.length} lines)`);
console.log(`Emitted TS:  ${emitted.length} bytes (${emitted.split('\n').length} lines)`);
console.log(`Ratio:       ${(emitted.length / ionText.length).toFixed(1)}x expansion`);
