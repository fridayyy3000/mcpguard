type LogLevel = "info" | "error";

function writeLog(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> = {},
): void {
  // stdout may be reserved for a wire protocol, so all application logs use
  // stderr consistently across the assessment.
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    })}\n`,
  );
}

export const logger = {
  info(message: string, context?: Record<string, unknown>): void {
    writeLog("info", message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    writeLog("error", message, context);
  },
};
