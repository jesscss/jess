# Optimization ideas

When a mixin is evaluated for the first time, figure out if (when in a Less context) it tries to reach to the caller context to evaluate a mixin or variable. If not, cache the mixin output.