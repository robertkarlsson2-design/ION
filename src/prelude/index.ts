import { lex } from '../lexer/index.js';
import { parseModule } from '../parser/declarations.js';
import { buildModule } from '../ast/builder.js';
import type { AstDeclNode } from '../ast/nodes.js';

// Embedded so no file-copy step is needed after `tsc`.
const PRELUDE_SRC = `
@foreign("", "map", "$1.map($2)")
pub extern fn map(list: List<a>, f: fn(a) -> b) -> List<b>

@foreign("", "filter", "$1.filter($2)")
pub extern fn filter(list: List<a>, pred: fn(a) -> Bool) -> List<a>

@foreign("", "reduce", "$1.reduce($3, $2)")
pub extern fn fold(list: List<a>, init: b, f: fn(b, a) -> b) -> b

@foreign("", "length", "$1.length")
pub extern fn length(list: List<a>) -> Int

@foreign("Array", "from", "Array.from(Array($2-$1),(_,i)=>$1+i)")
pub extern fn range(start: Int, end: Int) -> List<Int>

@foreign("", "concat", "[...$1, ...$2]")
pub extern fn concat(a: List<elem>, b: List<elem>) -> List<elem>

@foreign("", "includes", "$1.includes($2)")
pub extern fn contains(list: List<a>, item: a) -> Bool

@foreign("Array", "isArray", "$1.length===0")
pub extern fn isEmpty(list: List<a>) -> Bool

@foreign("", "reverse", "[...$1].reverse()")
pub extern fn reverse(list: List<a>) -> List<a>

@foreign("", "slice", "$1.slice($2,$3)")
pub extern fn slice(list: List<a>, from: Int, to: Int) -> List<a>

@foreign("", "join", "$1.join($2)")
pub extern fn joinWith(list: List<Str>, sep: Str) -> Str

@foreign("", "flatMap", "$1.flatMap($2)")
pub extern fn flatMap(list: List<a>, f: fn(a) -> List<b>) -> List<b>

@foreign("", "some", "$1.some($2)")
pub extern fn any(list: List<a>, pred: fn(a) -> Bool) -> Bool

@foreign("", "every", "$1.every($2)")
pub extern fn all(list: List<a>, pred: fn(a) -> Bool) -> Bool

@foreign("Math", "abs", "Math.abs($1)")
pub extern fn abs(n: Int) -> Int

@foreign("Math", "floor", "Math.floor($1)")
pub extern fn floor(n: Float) -> Int

@foreign("Math", "ceil", "Math.ceil($1)")
pub extern fn ceil(n: Float) -> Int

@foreign("Math", "round", "Math.round($1)")
pub extern fn round(n: Float) -> Int

@foreign("Math", "sqrt", "Math.sqrt($1)")
pub extern fn sqrt(n: Float) -> Float

@foreign("Math", "min", "Math.min($1,$2)")
pub extern fn min(a: Int, b: Int) -> Int

@foreign("Math", "max", "Math.max($1,$2)")
pub extern fn max(a: Int, b: Int) -> Int

@foreign("Math", "pow", "Math.pow($1,$2)")
pub extern fn pow(base: Float, exp: Float) -> Float

@foreign("", "toString", "String($1)")
pub extern fn toString(n: Int) -> Str

@foreign("", "split", "$1.split($2)")
pub extern fn split(s: Str, sep: Str) -> List<Str>

@foreign("", "trim", "$1.trim()")
pub extern fn trim(s: Str) -> Str

@foreign("", "toUpperCase", "$1.toUpperCase()")
pub extern fn toUpper(s: Str) -> Str

@foreign("", "toLowerCase", "$1.toLowerCase()")
pub extern fn toLower(s: Str) -> Str

@foreign("", "startsWith", "$1.startsWith($2)")
pub extern fn startsWith(s: Str, prefix: Str) -> Bool

@foreign("", "endsWith", "$1.endsWith($2)")
pub extern fn endsWith(s: Str, suffix: Str) -> Bool

@foreign("console", "log", "console.log($1)")
pub extern fn print(msg: Str) !io -> Unit

@foreign("console", "log", "console.log($1)")
pub extern fn printInt(n: Int) !io -> Unit
`;

let _cached: readonly AstDeclNode[] | null = null;

/** Returns the prelude declarations, parsed and cached on first call. */
export function getPreludeDecls(): readonly AstDeclNode[] {
  if (_cached !== null) return _cached;
  const tokens = lex(PRELUDE_SRC, '<prelude>');
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  _cached = ast.decls;
  return _cached;
}
