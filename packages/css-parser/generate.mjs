import shell from 'shelljs'

shell.rm('-rf', 'tmp')
shell.mkdir('tmp')

/**
 * Generate tokens
 * Antlr's CLI is counter-intuitive, in that the output directory is
 * relative to the input, not relative to process.cwd()
 */
shell.exec('antlr -Xexact-output-dir -o ../css-parser/tmp -Dlanguage=TypeScript ../grammar/CssLexer.g4')
shell.exec('antlr -Xexact-output-dir -o ../css-parser/tmp -Dlanguage=TypeScript ../grammar/CssParser.g4')
shell.mv('tmp/CssLexer.ts', 'src/generated/CssLexer.ts')
shell.mv('tmp/CssParser.ts', 'src/generated/CssParser.ts')
shell.mv('tmp/CssParserListener.ts', 'src/generated/CssParserListener.ts')
shell.rm('-rf', 'tmp')
