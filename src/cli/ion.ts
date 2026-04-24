#!/usr/bin/env node
import { runBuild } from './build.js';
import { runCheck } from './check.js';
import { runFmt } from './fmt.js';
import { runGrammar } from './grammar.js';
import { runIngest } from './ingest.js';
import { runTokens } from './tokens.js';

const [, , command, ...rest] = process.argv;

const USAGE = `usage: ion <command> [options]

commands:
  build    compile .ion files to a target language
  check    type-check .ion files
  fmt      format IonIR files
  grammar  output GBNF grammar and IR schema
  ingest   convert source files to Ion (wire format)
  tokens   count tokens in IonIR files
`;

async function main(): Promise<number> {
  switch (command) {
    case 'build':   return (await runBuild(rest)).exitCode;
    case 'check':   return (await runCheck(rest)).exitCode;
    case 'fmt':     return (await runFmt(rest)).exitCode;
    case 'grammar': return (await runGrammar(rest)).exitCode;
    case 'ingest':  return (await runIngest(rest)).exitCode;
    case 'tokens':  return (await runTokens(rest)).exitCode;
    default:
      process.stderr.write(command !== undefined
        ? `error: unknown command: ${command}\n${USAGE}`
        : USAGE,
      );
      return 2;
  }
}

main()
  .then(exitCode => { process.exit(exitCode); })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fatal: ${msg}\n`);
    process.exit(2);
  });
