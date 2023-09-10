import chalk from 'chalk'

export interface Logger {
  configure?(log: Logger): void
  log?(...args: any[]): void
  info?(...args: any[]): void
  warn?(...args: any[]): void
  error?(...args: any[]): void
}
/** Configure with custom behavior */
export const logger: Required<Logger> = {
  configure(log: Logger) {
    Object.assign(logger, log)
  },

  log(...args: any[]) {
    console.log(...args)
  },

  info(...args: any[]) {
    console.info(...args)
  },

  warn(...args: any[]) {
    console.error(chalk.yellow(...args))
  },

  error(...args: any[]) {
    console.error(chalk.red(...args))
  }
}
