import chalk from 'chalk'

/** Extend to override behavior */
export class Logger {
  log(...args: any[]) {
    console.log(...args)
  }

  info(...args: any[]) {
    console.info(...args)
  }

  warn(...args: any[]) {
    console.error(chalk.yellow(...args))
  }

  error(...args: any[]) {
    console.error(chalk.red(...args))
  }
}

type LoggerExport = Logger & {
  configure(log: Logger): void
}

export const logger = {
  configure(log: Logger) {
    Object.assign(logger, log)
  }
} as LoggerExport

logger.configure(new Logger())