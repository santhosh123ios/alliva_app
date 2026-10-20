function line(level: string, context: string, message: string) {
  return `[Alliva] ${process.pid}  - ${new Date().toLocaleString()} ${level.padStart(7)} [${context}] ${message}`;
}

export class Logger {
  constructor(private readonly context: string) {}

  log(message: string) {
    console.log(line('LOG', this.context, message));
  }

  error(message: string) {
    console.error(line('ERROR', this.context, message));
  }
}
