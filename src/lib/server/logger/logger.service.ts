/**
 * Structured logger service
 * Provides consistent, queryable logging with support for log levels and structured fields
 */

import { SeverityNumber } from '@opentelemetry/api-logs';
import { logData } from '../telemetry';
import { getConfig } from '../config';
import type {
	ILogger,
	LogLevel,
	LogContext,
	LogEntry,
	LoggerConfig
} from './logger.types';
import { LogLevelPriority } from './logger.types';
import { LogLevel as LogLevelEnum } from './logger.types';

/**
 * Maps LogLevel enum to OpenTelemetry SeverityNumber
 */
const severityMap: Record<LogLevel, SeverityNumber> = {
	[LogLevelEnum.DEBUG]: SeverityNumber.DEBUG,
	[LogLevelEnum.INFO]: SeverityNumber.INFO,
	[LogLevelEnum.WARN]: SeverityNumber.WARN,
	[LogLevelEnum.ERROR]: SeverityNumber.ERROR
};

/**
 * Structured logger implementation
 */
export class Logger implements ILogger {
	private config: LoggerConfig;

	constructor(service: string, minLevel?: LogLevel) {
		const appConfig = getConfig();
		const defaultMinLevel = appConfig.telemetry.environment === 'dev' ||
		                        appConfig.telemetry.environment === 'development'
			? LogLevelEnum.DEBUG
			: LogLevelEnum.INFO;

		this.config = {
			service,
			minLevel: minLevel || defaultMinLevel,
			enableConsole: true,
			enableOpenTelemetry: appConfig.telemetry.enabled
		};
	}

	/**
	 * Check if a log level should be logged based on minimum level
	 */
	private shouldLog(level: LogLevel): boolean {
		return LogLevelPriority[level] >= LogLevelPriority[this.config.minLevel];
	}

	/**
	 * Create a structured log entry
	 */
	private createLogEntry(
		level: LogLevel,
		message: string,
		context?: LogContext,
		error?: Error
	): LogEntry {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			service: this.config.service
		};

		if (context) {
			entry.context = context;
		}

		if (error) {
			entry.error = {
				name: error.name,
				message: error.message,
				stack: error.stack
			};
		}

		return entry;
	}

	/**
	 * Format log entry for console output
	 */
	private formatConsoleMessage(entry: LogEntry): string {
		const parts = [
			`[${entry.timestamp}]`,
			`[${entry.level}]`,
			`[${entry.service}]`,
			entry.message
		];

		if (entry.context && Object.keys(entry.context).length > 0) {
			parts.push(JSON.stringify(entry.context));
		}

		if (entry.error) {
			parts.push(`Error: ${entry.error.name}: ${entry.error.message}`);
			if (entry.error.stack) {
				parts.push(`\n${entry.error.stack}`);
			}
		}

		return parts.join(' ');
	}

	/**
	 * Send log to console
	 */
	private logToConsole(entry: LogEntry): void {
		if (!this.config.enableConsole) return;

		const message = this.formatConsoleMessage(entry);

		switch (entry.level) {
			case LogLevelEnum.DEBUG:
				console.debug(message);
				break;
			case LogLevelEnum.INFO:
				console.info(message);
				break;
			case LogLevelEnum.WARN:
				console.warn(message);
				break;
			case LogLevelEnum.ERROR:
				console.error(message);
				break;
		}
	}

	/**
	 * Send log to OpenTelemetry
	 */
	private logToOpenTelemetry(entry: LogEntry): void {
		if (!this.config.enableOpenTelemetry) return;

		const attributes: Record<string, unknown> = {
			service: entry.service,
			level: entry.level,
			...(entry.context || {})
		};

		if (entry.error) {
			attributes.error_name = entry.error.name;
			attributes.error_message = entry.error.message;
			attributes.error_stack = entry.error.stack;
		}

		logData(
			entry.service,
			entry.message,
			severityMap[entry.level],
			attributes
		);
	}

	/**
	 * Internal log method
	 */
	private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
		if (!this.shouldLog(level)) return;

		const entry = this.createLogEntry(level, message, context, error);
		this.logToConsole(entry);
		this.logToOpenTelemetry(entry);
	}

	/**
	 * Log debug message
	 */
	debug(message: string, context?: LogContext): void {
		this.log(LogLevelEnum.DEBUG, message, context);
	}

	/**
	 * Log info message
	 */
	info(message: string, context?: LogContext): void {
		this.log(LogLevelEnum.INFO, message, context);
	}

	/**
	 * Log warning message
	 */
	warn(message: string, context?: LogContext): void {
		this.log(LogLevelEnum.WARN, message, context);
	}

	/**
	 * Log error message
	 */
	error(message: string, error?: Error, context?: LogContext): void {
		this.log(LogLevelEnum.ERROR, message, context, error);
	}
}

/**
 * Create a logger instance for a service
 */
export function createLogger(service: string, minLevel?: LogLevel): ILogger {
	return new Logger(service, minLevel);
}

/**
 * Global logger instances cache
 */
const loggers = new Map<string, ILogger>();

/**
 * Get or create a logger for a service
 */
export function getLogger(service: string, minLevel?: LogLevel): ILogger {
	if (!loggers.has(service)) {
		loggers.set(service, createLogger(service, minLevel));
	}
	return loggers.get(service)!;
}
