/** Prints what a test compares across routes: the CSS, each error's code and message, and each warning by code and place. */
export const report = async (compiler, file) => {
  const { css, errors, warnings } = await compiler.renderToResult(file, { suppressWarnings: true });
  process.stdout.write(JSON.stringify({
    css,
    errors: errors.map(error => ({ code: error.code, message: error.message })),
    warnings: warnings.filter(warning => warning.code !== 'deprecation/less-plugin').map(warning => `${warning.code} ${warning.line}:${warning.column}`)
  }));
  compiler.dispose();
};
