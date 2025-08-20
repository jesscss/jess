export type SafePipeOptions<R = unknown> = {
  onError?: (error: unknown) => void;
  fallback?: R | (() => R);
};


