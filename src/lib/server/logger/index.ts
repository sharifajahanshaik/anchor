/**
 * Logger Module
 *
 * Exports logger service and types.
 */

import { createLogger as createLoggerFn } from './logger.service';

export { Logger, createLogger, getLogger } from './logger.service';
export { LogLevel } from './logger.types';
export type { LogEntry, LogContext, LoggerConfig, ILogger } from './logger.types';

// Export a default logger instance for convenience
export const logger = createLoggerFn('app');
