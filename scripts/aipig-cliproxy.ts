import { runAipigCli } from "../src/cli/aipig";

const result = await runAipigCli(["cliproxy", ...Bun.argv.slice(2)]);
if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
if (result.stderr) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
process.exit(result.status);
