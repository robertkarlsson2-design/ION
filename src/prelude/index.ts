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

@foreign("console", "log", "console.log($1)")
pub extern fn printFloat(n: Float) !io -> Unit

@foreign("", "reduce", "$1.reduce((a,b)=>a+b,0)")
pub extern fn sum(list: List<Int>) -> Int

@foreign("", "reduce", "$1.reduce((a,b)=>a*b,1)")
pub extern fn product(list: List<Int>) -> Int

@foreign("", "at", "$1[0]")
pub extern fn head(list: List<a>) -> a

@foreign("", "at", "$1[$1.length-1]")
pub extern fn last(list: List<a>) -> a

@foreign("", "slice", "$1.slice(1)")
pub extern fn tail(list: List<a>) -> List<a>

@foreign("", "flat", "$1.flat()")
pub extern fn flatten(list: List<List<a>>) -> List<a>

@foreign("", "sort", "[...$1].sort((a,b)=>a-b)")
pub extern fn sort(list: List<Int>) -> List<Int>

@foreign("", "sort", "[...$1].sort()")
pub extern fn sortStrs(list: List<Str>) -> List<Str>

@foreign("", "sort", "[...$1].sort($2)")
pub extern fn sortBy(list: List<a>, cmp: fn(a, a) -> Int) -> List<a>

@foreign("Set", "from", "[...new Set($1)]")
pub extern fn unique(list: List<a>) -> List<a>

@foreign("", "map", "$1.map((_,i)=>[$1[i],$2[i]]).slice(0,$1.length<$2.length?$1.length:$2.length)")
pub extern fn zip(a: List<a>, b: List<b>) -> List<List<a>>

@foreign("", "indexOf", "$1.indexOf($2)")
pub extern fn indexOf(list: List<a>, item: a) -> Int

@foreign("", "find", "$1.find($2)")
pub extern fn find(list: List<a>, pred: fn(a) -> Bool) -> a

@foreign("", "findIndex", "$1.findIndex($2)")
pub extern fn findIndex(list: List<a>, pred: fn(a) -> Bool) -> Int

@foreign("", "includes", "$1.includes($2)")
pub extern fn strContains(s: Str, sub: Str) -> Bool

@foreign("", "repeat", "$1.repeat($2)")
pub extern fn repeat(s: Str, n: Int) -> Str

@foreign("", "replace", "$1.replace($2,$3)")
pub extern fn replace(s: Str, from: Str, to: Str) -> Str

@foreign("", "indexOf", "$1.indexOf($2)")
pub extern fn strIndexOf(s: Str, sub: Str) -> Int

@foreign("", "toString", "parseFloat($1)")
pub extern fn toFloat(s: Str) -> Float

@foreign("", "toString", "parseInt($1,10)")
pub extern fn toInt(s: Str) -> Int

@foreign("", "length", "$1.length")
pub extern fn strLen(s: Str) -> Int

@foreign("", "charAt", "$1[$2] ?? ''")
pub extern fn strAt(s: Str, i: Int) -> Str

@foreign("", "slice", "$1.slice($2,$3)")
pub extern fn strSlice(s: Str, from_: Int, to: Int) -> Str

@foreign("", "charCodeAt", "$1.charCodeAt($2)")
pub extern fn strCharCode(s: Str, i: Int) -> Int

@foreign("String", "fromCharCode", "String.fromCharCode($1)")
pub extern fn charFromCode(n: Int) -> Str

@foreign("", "padStart", "$1.padStart($2,$3)")
pub extern fn strPadStart(s: Str, len: Int, pad: Str) -> Str

@foreign("", "padEnd", "$1.padEnd($2,$3)")
pub extern fn strPadEnd(s: Str, len: Int, pad: Str) -> Str

@foreign("", "match", "$1.match(new RegExp($2)) !== null")
pub extern fn strMatchesRegex(s: Str, pattern: Str) -> Bool

@foreign("Map", "new", "new Map()")
pub extern fn mapNew() -> Map<a, b>

@foreign("", "get", "$1.get($2)")
pub extern fn mapGet(m: Map<k, v>, k: k) -> v

@foreign("", "set", "($1.set($2,$3),$1)")
pub extern fn mapSet(m: Map<k, v>, k: k, v: v) -> Map<k, v>

@foreign("", "has", "$1.has($2)")
pub extern fn mapHas(m: Map<k, v>, k: k) -> Bool

@foreign("", "delete", "($1.delete($2),$1)")
pub extern fn mapDelete(m: Map<k, v>, k: k) -> Map<k, v>

@foreign("", "size", "$1.size")
pub extern fn mapSize(m: Map<k, v>) -> Int

@foreign("Array", "from", "[...$1.keys()]")
pub extern fn mapKeys(m: Map<k, v>) -> List<k>

@foreign("Array", "from", "[...$1.values()]")
pub extern fn mapValues(m: Map<k, v>) -> List<v>

@foreign("Array", "from", "[...$1.entries()].map(([k,v])=>[k,v])")
pub extern fn mapEntries(m: Map<k, v>) -> List<List<a>>

@foreign("", "at", "$1[$2]")
pub extern fn arrGet(a: List<v>, i: Int) -> v

@foreign("", "push", "($1.push($2),$1)")
pub extern fn arrPush(a: List<v>, v: v) -> List<v>

@foreign("", "pop", "($1.pop(),$1)")
pub extern fn arrPop(a: List<v>) -> List<v>

@foreign("", "includes", "$1.includes($2)")
pub extern fn arrIncludes(a: List<v>, v: v) -> Bool

@foreign("", "findIndex", "$1.findIndex($2)")
pub extern fn arrFindIndex(a: List<v>, pred: fn(v) -> Bool) -> Int

@foreign("", "indexOf", "$1.indexOf($2)")
pub extern fn arrIndexOf(a: List<v>, v: v) -> Int

@foreign("", "join", "$1.join('')")
pub extern fn arrJoin(a: List<Str>) -> Str

@foreign("", "parseInt", "parseInt($1,$2)")
pub extern fn parseIntRadix(s: Str, radix: Int) -> Int

@foreign("", "parseFloat", "parseFloat($1)")
pub extern fn parseFloatStr(s: Str) -> Float

@foreign("Number", "isNaN", "Number.isNaN($1)")
pub extern fn isNaN(n: Float) -> Bool

@foreign("Number", "isFinite", "Number.isFinite($1)")
pub extern fn isFinite(n: Float) -> Bool

@foreign("", "toFixed", "$1.toFixed($2)")
pub extern fn numToFixed(n: Float, digits: Int) -> Str

@foreign("JSON", "stringify", "JSON.stringify($1)")
pub extern fn jsonStringify(v: a) -> Str

@foreign("JSON", "parse", "JSON.parse($1)")
pub extern fn jsonParse(s: Str) -> a

@foreign("process", "argv", "process.argv.slice($1)")
pub extern fn processArgs(skip: Int) -> List<Str>

@foreign("process", "env", "process.env[$1] ?? ''")
pub extern fn processEnv(key: Str) -> Str

@foreign("process", "exit", "process.exit($1)")
pub extern fn exit(code: Int) -> Unit
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
