import type { Node } from '../node.js';
import type { List } from '../list.js';
import type { CallableEntry, MixinEntry } from '../rules.js';
import { prepareCallableEvalCandidates, type CallableEvalCandidatePreparation } from './callable-candidate.js';
import { matchCallableParams, type CallableParamMatch } from './callable-param-match.js';

export type CallableCandidateMatchPreparation = CallableEvalCandidatePreparation & {
  resolvedParamBindings: WeakMap<CallableEntry, CallableParamMatch>;
};

type PrepareCallableCandidateMatchesOptions = {
  mixinEntries: readonly MixinEntry[];
  nodeArgs: Node[];
  hasFileContext: boolean;
  rulesEvalStack: readonly Node[];
  caller?: Node;
  isCallableEntry: (entry: MixinEntry) => entry is CallableEntry;
  getCallableEntryParams: (entry: CallableEntry) => List<Node> | undefined;
};

export function prepareCallableCandidateMatches({
  mixinEntries,
  nodeArgs,
  hasFileContext,
  rulesEvalStack,
  caller,
  isCallableEntry,
  getCallableEntryParams
}: PrepareCallableCandidateMatchesOptions): CallableCandidateMatchPreparation {
  const mixinCandidates: MixinEntry[] = [];
  const resolvedParamBindings = new WeakMap<CallableEntry, CallableParamMatch>();

  for (const mixinEntry of mixinEntries) {
    const paramLength = isCallableEntry(mixinEntry)
      ? getCallableEntryParams(mixinEntry)?.length ?? 0
      : 0;
    if (!paramLength) {
      if (nodeArgs.length) {
        continue;
      }
      mixinCandidates.push(mixinEntry);
      continue;
    }

    if (!isCallableEntry(mixinEntry)) {
      continue;
    }

    const params = getCallableEntryParams(mixinEntry);
    if (!params) {
      continue;
    }

    const matchedParams = matchCallableParams({
      params,
      args: nodeArgs,
      hasFileContext
    });
    if (!matchedParams) {
      continue;
    }

    resolvedParamBindings.set(mixinEntry, matchedParams);
    mixinCandidates.push(mixinEntry);
  }

  const preparedCandidates = prepareCallableEvalCandidates({
    mixinCandidates,
    rulesEvalStack,
    caller
  });

  return {
    ...preparedCandidates,
    resolvedParamBindings
  };
}

export function resolveCallableCandidateMatches(
  options: PrepareCallableCandidateMatchesOptions
): CallableCandidateMatchPreparation {
  const prepared = prepareCallableCandidateMatches(options);
  if (prepared.evalCandidates.length === 0) {
    throw new ReferenceError('No matching mixins found.');
  }
  return prepared;
}
