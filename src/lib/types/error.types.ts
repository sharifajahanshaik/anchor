/**
 * Error type definitions and classifications
 *
 * This module contains custom error classes and error-related types
 * to provide structured error handling across the application.
 */

/**
 * Base error class for all application errors
 */
export class BaseError extends Error {
	public readonly code: string;
	public readonly statusCode: number;
	public readonly context?: Record<string, any>;
	public readonly timestamp: Date;

	constructor(
		message: string,
		code: string,
		statusCode: number = 500,
		context?: Record<string, any>
	) {
		super(message);
		this.name = this.constructor.name;
		this.code = code;
		this.statusCode = statusCode;
		this.context = context;
		this.timestamp = new Date();

		// Maintains proper stack trace for where error was thrown
		Error.captureStackTrace(this, this.constructor);
	}

	/**
	 * Determines if this error is retryable
	 */
	isRetryable(): boolean {
		return false; // Override in subclasses
	}

	/**
	 * Serializes error for logging
	 */
	toJSON(): Record<string, any> {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			statusCode: this.statusCode,
			context: this.context,
			timestamp: this.timestamp.toISOString(),
			stack: this.stack
		};
	}
}

/**
 * Validation error for invalid input
 */
export class ValidationError extends BaseError {
	constructor(message: string, context?: Record<string, any>) {
		super(message, 'VALIDATION_ERROR', 400, context);
	}

	isRetryable(): boolean {
		return false; // Validation errors are not retryable
	}
}

/**
 * Configuration error for missing or invalid configuration
 */
export class ConfigurationError extends BaseError {
	constructor(message: string, context?: Record<string, any>) {
		super(message, 'CONFIGURATION_ERROR', 500, context);
	}

	isRetryable(): boolean {
		return false; // Configuration errors are not retryable
	}
}

/**
 * Network error for HTTP request failures
 */
export class NetworkError extends BaseError {
	public readonly url?: string;
	public readonly method?: string;
	public readonly responseStatus?: number;

	constructor(
		message: string,
		context?: Record<string, any>,
		url?: string,
		method?: string,
		responseStatus?: number
	) {
		super(message, 'NETWORK_ERROR', responseStatus || 500, context);
		this.url = url;
		this.method = method;
		this.responseStatus = responseStatus;
	}

	isRetryable(): boolean {
		// Retry on 5xx errors and network failures, but not on 4xx client errors
		if (!this.responseStatus) return true; // Network timeout/failure
		return this.responseStatus >= 500 && this.responseStatus < 600;
	}

	toJSON(): Record<string, any> {
		return {
			...super.toJSON(),
			url: this.url,
			method: this.method,
			responseStatus: this.responseStatus
		};
	}
}

/**
 * Shopify-specific error
 */
export class ShopifyError extends BaseError {
	public readonly shopUrl?: string;
	public readonly errorType?: string;

	constructor(
		message: string,
		code: string,
		statusCode: number = 500,
		context?: Record<string, any>,
		shopUrl?: string,
		errorType?: string
	) {
		super(message, code, statusCode, context);
		this.shopUrl = shopUrl;
		this.errorType = errorType;
	}

	isRetryable(): boolean {
		// Certain Shopify errors are retryable
		const retryableErrorTypes = [
			'NETWORK_ERROR',
			'TIMEOUT_ERROR',
			'RATE_LIMIT_ERROR'
		];
		return this.errorType ? retryableErrorTypes.includes(this.errorType) : false;
	}

	toJSON(): Record<string, any> {
		return {
			...super.toJSON(),
			shopUrl: this.shopUrl,
			errorType: this.errorType
		};
	}
}

/**
 * GraphQL error from Shopify
 */
export class ShopifyGraphQLError extends ShopifyError {
	public readonly graphqlErrors: Array<{ code: string; message: string }>;

	constructor(
		message: string,
		graphqlErrors: Array<{ code: string; message: string }>,
		context?: Record<string, any>,
		shopUrl?: string
	) {
		super(message, 'SHOPIFY_GRAPHQL_ERROR', 400, context, shopUrl, 'GRAPHQL_ERROR');
		this.graphqlErrors = graphqlErrors;
	}

	isRetryable(): boolean {
		// Some GraphQL errors are retryable
		const retryableGraphQLCodes = ['INTERNAL_ERROR', 'THROTTLED'];
		return this.graphqlErrors.some(err =>
			retryableGraphQLCodes.includes(err.code)
		);
	}

	toJSON(): Record<string, any> {
		return {
			...super.toJSON(),
			graphqlErrors: this.graphqlErrors
		};
	}
}

/**
 * Parser error for HTML/JavaScript/GraphQL parsing failures
 */
export class ParserError extends BaseError {
	public readonly parserType: 'HTML' | 'JAVASCRIPT' | 'GRAPHQL';
	public readonly rawContent?: string;

	constructor(
		message: string,
		parserType: 'HTML' | 'JAVASCRIPT' | 'GRAPHQL',
		context?: Record<string, any>,
		rawContent?: string
	) {
		super(message, 'PARSER_ERROR', 500, context);
		this.parserType = parserType;
		this.rawContent = rawContent;
	}

	isRetryable(): boolean {
		return false; // Parser errors are typically not retryable
	}

	toJSON(): Record<string, any> {
		return {
			...super.toJSON(),
			parserType: this.parserType,
			rawContentLength: this.rawContent?.length
		};
	}
}

/**
 * Abandonment processing error - for checkout creation failures
 * Can be either retryable or non-retryable based on error type
 */
export class AbandonmentProcessingError extends BaseError {
	public readonly errorDetails?: any;
	public readonly retryable: boolean;

	constructor(
		message: string,
		retryable: boolean,
		code: string = 'ABANDONMENT_PROCESSING_ERROR',
		context?: Record<string, any>,
		errorDetails?: any
	) {
		super(message, code, retryable ? 500 : 400, context);
		this.errorDetails = errorDetails;
		this.retryable = retryable;
	}

	isRetryable(): boolean {
		return this.retryable;
	}

	toJSON(): Record<string, any> {
		return {
			...super.toJSON(),
			retryable: this.retryable,
			errorDetails: this.errorDetails
		};
	}
}

/**
 * Error classification enum
 */
export enum ErrorClassification {
	RETRYABLE = 'RETRYABLE',
	PERMANENT = 'PERMANENT',
	UNKNOWN = 'UNKNOWN'
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
	LOW = 'LOW',
	MEDIUM = 'MEDIUM',
	HIGH = 'HIGH',
	CRITICAL = 'CRITICAL'
}

/**
 * Structured error context
 */
export interface ErrorContext {
	shopUrl?: string;
	abandonmentId?: string;
	userInfo?: any;
	requestId?: string;
	retryCount?: number;
	[key: string]: any;
}

/**
 * Error handler result
 */
export interface ErrorHandlerResult {
	shouldRetry: boolean;
	classification: ErrorClassification;
	severity: ErrorSeverity;
	message: string;
	context?: ErrorContext;
}
