#!/bin/zsh
set -e
# REPO must point at a checkout whose css-parser is BUILT (lib/ present).
REPO=${REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}
SRC=$REPO/packages/syntax/css/css-parser/lib
AB=${AB_DIR:-/tmp/jess-cst-spread-ab}

# Resolve the parseman the BUILT parser is actually linked against, and report
# it -- stale pointers fail silently and clean, so the artifact is evidence.
PARSEMAN_ENTRY=$(node -e "const{createRequire}=require('module');console.log(createRequire('$REPO/packages/syntax/css/css-parser/package.json').resolve('parseman'))")
PARSEMAN_PKG=${PARSEMAN_ENTRY%/dist/index.cjs}
echo "parseman pkg : $PARSEMAN_PKG"
echo "parseman ver : $(node -p "require('$PARSEMAN_PKG/package.json').version")"

rm -rf "$AB"
mkdir -p "$AB/base" "$AB/patched" "$AB/node_modules/@jesscss"
printf '{ "type": "module" }\n' > "$AB/package.json"
# Bare specifiers now resolve by normal node_modules lookup from $AB/<variant>/
ln -s "$PARSEMAN_PKG" "$AB/node_modules/parseman"
ln -s "$REPO/packages/core" "$AB/node_modules/@jesscss/core"
ln -s "$REPO/packages/parser-shared" "$AB/node_modules/@jesscss/parser-shared"
ln -s "$REPO/packages/_shared" "$AB/node_modules/@jesscss/shared"

for V in base patched; do
  cp "$SRC"/cst-css.js "$SRC"/grammar.js "$SRC"/index.js "$SRC"/cst.js "$AB/$V"/
done

# PATCHED variant: replace the conditional object SPREAD with two explicit
# branches producing the SAME two hidden classes. Nothing else changes.
python3 - "$AB/patched/cst-css.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = '''	return {
		_tag: "node",
		type: publicTypeName(type),
		grammarType: type,
		...publicTags === void 0 || publicTags.length === 0 ? {} : { tags: publicTags },
		span: publicSpan(grammarType, span, rawChildren),
		state: state ?? null,
		rules,
		children: rules
	};'''
new = '''	const __type = publicTypeName(type);
	const __span = publicSpan(grammarType, span, rawChildren);
	const __state = state ?? null;
	if (publicTags === void 0 || publicTags.length === 0) {
		return { _tag: "node", type: __type, grammarType: type, span: __span, state: __state, rules, children: rules };
	}
	return { _tag: "node", type: __type, grammarType: type, tags: publicTags, span: __span, state: __state, rules, children: rules };'''
assert old in s, "spread site not found -- bundle shape changed"
open(p, 'w').write(s.replace(old, new))
print("patched OK")
PY

echo "diff line count (base vs patched, expect only the one site):"
diff "$AB/base/cst-css.js" "$AB/patched/cst-css.js" | grep -c '^[<>]' || true
echo "setup done"
