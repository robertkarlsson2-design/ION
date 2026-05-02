import { describe, it, expect } from 'vitest';
import { emitJava } from '../../emitters/java/emit.js';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import { desugarModule } from '../../src/desugar/index.js';

/** End-to-end pipeline: Ion source string → emitted Java string. */
function compile(src: string, moduleName = 'TestModule'): string {
  const tokens = lex(src, `${moduleName}.ion`);
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bind = bindModule(ast, moduleName);
  const check = checkModule(ast, bind, moduleName);
  const ir = desugarModule(ast, bind, check, moduleName, '0.0.0');
  return emitJava(ir);
}

describe('emitJava — module structure', () => {
  it('wraps in a public final class derived from the module name', () => {
    const out = compile('pub fn fib(n: Int) -> Int = if n <= 1 then n else fib(n - 1) + fib(n - 2)', 'Fibonacci');
    expect(out).toContain('public final class Fibonacci');
    expect(out).toContain('private Fibonacci()');
    expect(out).toContain('import java.util.List;');
  });

  it('emits a self-contained Prelude inner class', () => {
    const out = compile('pub fn double(n: Int) -> Int = n * 2', 'M');
    expect(out).toContain('static final class Prelude');
    expect(out).toContain('static List<Object> map(');
    expect(out).toContain('static List<Object> filter(');
    expect(out).toContain('static Object fold(');
    expect(out).toContain('static List<Object> range(long lo, long hi)');
  });

  it('strips path + extension when forming the class name', () => {
    const out = compile('pub fn id(n: Int) -> Int = n', 'src/api/users.ion');
    expect(out).toContain('public final class Users');
  });
});

describe('emitJava — primitives', () => {
  it('emits typed top-level fns with primitive Java types', () => {
    const out = compile('pub fn add(a: Int, b: Int) -> Int = a + b');
    expect(out).toContain('public static long add(long a, long b)');
    expect(out).toContain('return a + b;');
  });

  it('lowers if/then/else to a ternary', () => {
    const out = compile('pub fn fib(n: Int) -> Int = if n <= 1 then n else fib(n - 1) + fib(n - 2)');
    // We expect a ternary, not a switch statement (Java disallows switch on boolean).
    expect(out).toMatch(/return \([^?]*\) \? \([^?]*\) : \([^?]*\);/);
    expect(out).not.toContain('switch (n');
  });

  it('emits boolean literals and arithmetic correctly', () => {
    const out = compile('pub fn pos(x: Int) -> Bool = x > 0');
    expect(out).toContain('public static boolean pos(long x)');
    expect(out).toContain('return x > 0L;');
  });
});

describe('emitJava — untyped (TypeVar) parameters', () => {
  it('widens to Object and inserts (Long) casts at arithmetic sites', () => {
    const out = compile('pub fn double(n) = n * 2');
    expect(out).toContain('public static Object double(Object n)');
    expect(out).toContain('((Long) n).longValue() * 2L');
  });

  it('does NOT cast Object Vars at non-arithmetic positions (range, list ops)', () => {
    const out = compile('pub fn upTo(n) = range(2, n)');
    // n is passed as a numeric arg to range — not as a function — so the cast
    // is to long (via Prelude.toLong), NOT to Function<Object, Object>.
    expect(out).toContain('Prelude.range(Prelude.toLong(2L), Prelude.toLong(n))');
    expect(out).not.toContain('(java.util.function.Function<Object, Object>) n)');
  });
});

describe('emitJava — prelude and HOF', () => {
  it('emits prelude calls via the inlined templates', () => {
    const out = compile('pub fn squares(n) = range(0, n) |> map(x -> x * x)');
    expect(out).toContain('Prelude.map(Prelude.range(');
    expect(out).toContain('(java.util.function.Function<Object, Object>)');
  });

  it('emits a top-level fn passed by name as a method reference', () => {
    const out = compile('pub fn isPos(n: Int) -> Bool = n > 0\npub fn keep(ns) = filter(ns, isPos)', 'M');
    expect(out).toContain('M::isPos');
  });

  it('emits a prelude fn passed by name as a wrapping lambda', () => {
    const out = compile('pub fn allCaps(words) = map(words, toUpper)');
    expect(out).toContain('java.util.function.Function<Object, Object>');
    expect(out).toContain('Prelude.toUpper(_x)');
  });
});

describe('emitJava — strings', () => {
  it('compiles string literals with proper Java escaping', () => {
    const out = compile('pub fn greet() -> Str = "hello world"');
    expect(out).toContain('"hello world"');
  });

  it('emits prelude string ops via Prelude helpers', () => {
    const out = compile('pub fn upper(s) = toUpper(s)');
    expect(out).toContain('Prelude.toUpper(s)');
  });

  it('compiles Str == Str to .equals() not ==', () => {
    const out = compile('pub fn eq(a: Str, b: Str) -> Bool = a == b');
    expect(out).toContain('public static boolean eq(String a, String b)');
    expect(out).toContain('return a.equals(b);');
    expect(out).not.toContain('a == b');
  });

  it('compiles Str != Str to !.equals() not !=', () => {
    const out = compile('pub fn ne(a: Str, b: Str) -> Bool = a != b');
    expect(out).toContain('public static boolean ne(String a, String b)');
    expect(out).toContain('return !a.equals(b);');
    expect(out).not.toContain('a != b');
  });

  it('keeps == for Int comparison (not .equals)', () => {
    const out = compile('pub fn intEq(a: Int, b: Int) -> Bool = a == b');
    expect(out).toContain('return a == b;');
    expect(out).not.toContain('.equals(');
  });
});

describe('emitJava — list literals', () => {
  it('emits empty list as List.<Object>of()', () => {
    const out = compile('pub fn empty() = []');
    expect(out).toContain('java.util.List.<Object>of()');
  });

  it('emits non-empty list with element values', () => {
    const out = compile('pub fn xs() = [1, 2, 3]');
    expect(out).toContain('java.util.<Object>List.of(1L, 2L, 3L)');
  });
});

describe('emitJava — escape hatch', () => {
  it('passes RawInject code through unchanged', () => {
    const out = compile('pub fn boom() -> Int = raw("System.exit(0); return 0;")');
    expect(out).toContain('System.exit(0); return 0;');
  });
});

describe('emitJava — output is roughly idiomatic Java', () => {
  // Sanity: the emitted code should look like Java. No Python/JS-isms.
  it('uses Java-style braces, semicolons, and `public static`', () => {
    const out = compile('pub fn sq(n: Int) -> Int = n * n');
    expect(out).toContain('public static long sq(long n) {');
    expect(out).toContain('return n * n;');
    expect(out).not.toContain(' = lambda');
    expect(out).not.toContain(' = (n) =>');
  });
});

describe('emitJava — data declarations', () => {
  it('emits a single-ctor data type as a plain record (no sealed interface)', () => {
    const out = compile('data User = User { id: Int; email: Str }');
    expect(out).toContain('public record User(');
    expect(out).not.toContain('sealed interface User');
    expect(out).toContain('Long id');
    expect(out).toContain('String email');
  });

  it('emits a multi-ctor data type as a sealed interface with records', () => {
    const out = compile('data Shape = Circle { r: Float } | Rect { w: Float; h: Float }');
    expect(out).toContain('sealed interface Shape');
    expect(out).toContain('record Circle(');
    expect(out).toContain('record Rect(');
    expect(out).toContain('implements Shape');
  });
});
