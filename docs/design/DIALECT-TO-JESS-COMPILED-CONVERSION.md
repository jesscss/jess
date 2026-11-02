# Dialect → Jess compiled conversion — design queue

## Status and boundary

This is queued design work. It begins only after the four dialect packages have
complete public direct `parse() -> Root` routes, the plugin/Context document
path carries `Root`, and the relevant dialect evaluator is trustworthy. It is
not a CST-to-AST bridge, a source-text rewrite, or a parser fallback.

The primary conversion contract is structural and behavioral:

1. Parsing the generated `.jess` must create the same canonical AST v2 node
   kinds, containment, bindings, calls, and semantic roles as parsing the
   original `.less` or `.scss`, modulo an explicitly documented target spelling
   rewrite such as a relative import path/extension.
2. Under equivalent compilation options, `.less -> .css` must equal
   `.less -> .jess -> .css`, and likewise for SCSS. Output equality is the
   external proof; canonical-node equivalence is the construction proof.

Compilation/evaluation facts are supporting evidence for target spellings that
the source dialect omits. They do not replace the source canonical AST as the
conversion input, nor license a source-text guess. Unobserved or conditional
behavior remains an explicit conversion diagnostic/candidate.

### Built so far

- **Import provenance**, the first fact below. When a caller sets
  `Context.importTargets`, the serializer's import expansion records, per
  import node, each target it resolved and what that target became: the loaded
  document, or `null` when it stays a CSS `@import` (a `.css` terminal or a
  URL), written back as authored; and which imports a document's
  `processImports: false` policy skipped, which convert as a gap (`.jess` has
  no such policy). It also records which root CSS `@import` statements the
  render wrote into the output prelude (ledger N9), and which it dropped there
  as duplicates. Unset, nothing is recorded and nothing is allocated.
- **`Compiler.convertToJess(file)`** renders the file once with that map set,
  then prints every loaded `.less`/`.scss` document with `emitJess`. Each
  import names its recorded target, relative to the converted file (a
  converted target's `.jess` sibling); an import the render never resolved, or
  resolved to more than one target, is a spelling gap, never a guess. A
  `.jess` CSS `@import` is written where it stands, so the entry's prelude
  imports lead its `.jess` (a dropped duplicate is not written), and a prelude
  import from an imported file, or a Less import left a CSS `@import` after a
  rule, is a gap. A converted file's `.jess` path is not written, and the file
  and every import of it are gaps, when another converted file of the render
  takes the path first (`b.less` and `b.scss`), when the path is a symlink, or
  when it exists. An existing file is replaced only when the caller passes
  `{ overwrite: true }`, and even then never when it is the same file (`dev` and
  `ino`) as one the render loaded, however the import spelled it (`B.jess`,
  `alias/b.jess`). The call runs where the render runs, so a sandboxed compile
  converts in the sandbox, under the same rules. The host rebuilds each entry
  the engine returns from checked fields (ledger A19):
  - the entry's `source` must be a `.less`, `.scss` or `.css` file;
  - with `..` and symlinks resolved, the file and its folder must lie inside
    the read roots that the script plugin computes on the host for the render;
  - its `jessPath` is derived on the host from `source` as the render spelled
    it, as the in-process route derives it, so a partial reached through a
    symlink keeps the name its importer uses;
  - the `jessPath` must not be a symlink, and must not exist for `.jess` text
    without `overwrite`.

  Anything else is refused. So the engine can make the host write only the
  `.jess` sibling of a stylesheet the render was allowed to read. Only the
  engine's own conversion code knows which files its render loaded, so the
  host does not repeat the loaded-file check for an engine result.
- **Proof:** the equivalence harness (`JESS-EQUIVALENCE-HARNESS.md`) runs every
  Less and SCSS corpus file through it and compares the two renders.

Not built: the canonical-tree gate (the harness compares reprints and CSS, not
canonical trees), the resolver identity and resolution kind on each import
fact, and the function-call outcome facts below.

## Core model

Keep two inputs separate:

1. The canonical AST v2 source tree is the conversion subject. The generated
   Jess program must parse back to an equivalent canonical tree under the
   approved rewrite mapping. The parser, evaluator, and retained Context/plugin
   topology continue to own that tree.
2. A consumer-gated `ConversionFacts` sidecar records observed compilation
   facts keyed by source node/import edge/call site. It must not add mandatory
   per-node fields, parser work, or a second runtime parse/load path.

The conversion planner receives `{ sourceRoot, facts, outputFilePath,
targetDialect: 'jess' }`. It emits Jess source/AST plus a complete diagnostics
report. It does not read files, resolve imports, replay evaluation, or infer
facts that were not observed. Its first gate compares source and reparsed-Jess
canonical trees under the approved rewrite mapping; its second gate compares
their compiled CSS.

## Required observed facts

### Import/file provenance

Less and SCSS may resolve imports without the relative path and extension that
Jess requires. The resolver/plugin chain already owns this information; when
an import succeeds it must record, for that import edge:

- source specifier bytes and source file identity;
- actual resolved canonical file path and extension;
- resolver/plugin identity and resolution kind (explicit file, extension
  inference, index/package/module form);
- whether the import was evaluated, emitted as CSS, inlined, skipped, or
  conditional/deferred;
- the target module/file identity used by compilation.

The Jess projection changes only the import node's spelling fields as necessary
to compute a required relative specifier from the actual resolved target and
the requested Jess output location. It retains an explicit diagnostic when no
stable relative Jess target exists. It never guesses an extension from the
original specifier or re-resolves the path.

### Function-call outcome and dependency provenance

Whether a Less/SCSS-looking call is a CSS function call or an evaluated dialect
function is runtime information. On every attempted resolvable function call,
record a fact only at the existing dispatcher/evaluator boundary:

- source call node and normalized call identity;
- resolution result: unresolved CSS-preserved call, resolved callable, thrown
  diagnostic, or deliberately deferred;
- callable provenance when resolved: owning module/plugin, exported binding,
  namespace/import shape, and actual return classification;
- whether evaluation completed normally and the resulting canonical value or
  emitted CSS call.

The Jess conversion planner may add the import declaration needed to preserve a
source `Call` node only after a successful observed resolution. A direct named
binding normally projects to Jess `@-from ... import (...)`; a namespace/module
dependency normally projects to `@-use ... as ...`. These are distinct Jess
constructs, not aliases. A call preserved as CSS or one that threw must not
invent either import form. The resulting Jess parse must still construct the
same call/binding node relationship; the observed fact changes target module
settings, not the semantic node family.

### Less math-mode expression projection

Less value-position math and comparison are not ordinary CSS adjacency. The Less
parser lowers them to expression structure according to the active `mathMode`;
the converter must preserve that expression fact by emitting an explicit Jess
`$(...)` expression. A Less variable reference inside that generated expression
projects to the Jess scoped/final read form, not to a normal live `$foo` read.
The preferred Jess syntax is an expression-only `^foo` atom, so a source value
such as `@foo + 1` projects structurally as `$(^foo + 1)`. Like the
expression-only `.foo` declaration/property lookup, plain `^foo` must be illegal
in ordinary Jess value positions.

This projection is based on the parsed Less `Operation`/comparison tree plus
`mathMode`, never on a source-text sniff. If `mathMode` would leave the same
tokens as a plain CSS value/list, the converter must not invent a Jess
expression. If the Less expression contains a construct with no Jess expression
equivalent, emit the compiled fragment with a conversion diagnostic rather than
guessing a partial expression.

## Candidate next observed facts

These require evidence before becoming conversion features:

| Compilation fact | Possible Jess projection | Rule |
| --- | --- | --- |
| Mixin/include actually expanded | Jess mixin/application candidate | Only if the expansion/provenance identifies one stable callable boundary. |
| Conditional branch chosen | `$if` candidate | Preserve source condition only if it remains representable; otherwise emit compiled output with diagnostic. |
| Loop/control expansion | `$for`/`$while` candidate | Require an observed stable iteration/control model, never reverse-engineer repeated output. |
| Variable/module binding resolved | `$` declaration/reference or `@-use`/`@-from` candidate | Preserve scope and binding provenance, not just final string value. |
| URL/asset resolution | Jess-relative asset path candidate | Same actual-path rule as imports; no source-specifier guessing. |

## Invariants

- Facts are append-only per compilation session and are keyed by stable source
  identity plus an occurrence ordinal; they cannot be global mutable state.
- Context continues to coordinate plugins/resolution/source loading. The facts
  observe that existing path; they do not replace it.
- Collection is opt-in for conversion/diagnostics. Normal compilation must not
  pay a universal provenance allocation tax; measure any enabled cost.
- A failed or unresolved operation is a first-class fact, not a reason to
  pretend the source was a successful Jess construct.
- Conversion output includes a machine-readable explanation for every emitted
  Jess import/dependency and every retained compiled fragment.
- No conversion may call a parser bridge, reparse source, scan source strings,
  or perform independent filesystem resolution.

## Design and proof gates

Before implementation, produce paired Less and SCSS fixtures covering actual
path inference, explicit/implicit extension, successful function resolution,
CSS-preserved functions, throw paths, and module namespaces. For each fixture,
prove: source canonical tree; facts recorded by the existing Context →
plugin/evaluator path; generated Jess source; reparsed-Jess canonical-tree
equivalence under the approved rewrite map; and source/Jess compiled CSS
equality where the conversion claims fidelity.

Run an adversarial review against false provenance, duplicate resolution,
unconditional import insertion, and hot-path allocation. Do not add a
conversion package or AST fields until these fixtures and the fact ownership
boundary are approved.
