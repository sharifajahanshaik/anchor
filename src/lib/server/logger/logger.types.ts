/**
 * Logger types and interfaces for structured logging
 */

/**
 * Log levels following standard severity levels
 */
export enum LogLevel {
	DEBUG = 'DEBUG',
	INFO = 'INFO',
	WARN = 'WARN',
	ERROR = 'ERROR'
}

/**
 * Log level priority mapping for filtering
 */
export const LogLevelPriority: Record<LogLevel, number> = {
	[LogLevel.DEBUG]: 0,
	[LogLevel.INFO]: 1,
	[LogLevel.WARN]: 2,
	[LogLevel.ERROR]: 3
};

/**
 * Structured log context - additional fields to include in log entries
 */
export interface LogContext {
	[key: string]: string | number | boolean | null | undefined | object;
}

/**
 * Complete log entry structure
 */
export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	context?: LogContext;
	service: string;
	error?: {
		name: string;
		message: string;
		stack?: string;
	};
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
	minLevel: LogLevel;
	service: string;
	enableConsole: boolean;
	enableOpenTelemetry: boolean;
}

/**
 * Logger interface
 */
export interface ILogger {
	debug(message: string, context?: LogContext): void;
	info(message: string, context?: LogContext): void;
	warn(message: string, context?: LogContext): void;
	error(message: string, error?: Error, context?: LogContext): void;
}
