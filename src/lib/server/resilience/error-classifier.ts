/**
 * Error Classification Service
 *
 * Classifies errors to determine retry eligibility, severity, and handling strategy.
 * This is the foundation for circuit breakers, exponential backoff, and retry logic.
 */

import {
	BaseError,
	ValidationError,
	ConfigurationError,
	NetworkError,
	ShopifyError,
	ShopifyGraphQLError,
	ParserError,
	ErrorClassification,
	ErrorSeverity,
	type ErrorHandlerResult,
	type ErrorContext
} from '$lib/types/error.types';
import { logger } from '$lib/server/logger';

/**
 * Classifies an error and determines the appropriate handling strategy
 */
export function classifyError(error: unknown, context?: ErrorContext): ErrorHandlerResult {
	// Handle BaseError instances
	if (error instanceof BaseError) {
		return {
			shouldRetry: error.isRetryable(),
			classification: error.isRetryable()
				? ErrorClassification.RETRYABLE
				: ErrorClassification.PERMANENT,
			severity: determineSeverity(error),
			message: error.message,
			context: { ...error.context, ...context }
		};
	}

	// Handle native Error instances
	if (error instanceof Error) {
		// Network-related native errors are typically retryable
		const isNetworkError =
			error.name === 'AbortError' ||
			error.name === 'TimeoutError' ||
			error.message.includes('ECONNREFUSED') ||
			error.message.includes('ETIMEDOUT') ||
			error.message.includes('ENOTFOUND') ||
			error.message.includes('network');

		return {
			shouldRetry: isNetworkError,
			classification: isNetworkError
				? ErrorClassification.RETRYABLE
				: ErrorClassification.PERMANENT,
			severity: isNetworkError ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
			message: error.message,
			context
		};
	}

	// Handle unknown error types
	logger.warn('Unknown error type encountered', {
		error: error instanceof Error ? error.message : String(error),
		context
	});

	return {
		shouldRetry: false,
		classification: ErrorClassification.UNKNOWN,
		severity: ErrorSeverity.MEDIUM,
		message: String(error),
		context
	};
}

/**
 * Determines error severity based on error type and context
 */
function determineSeverity(error: BaseError): ErrorSeverity {
	// Configuration errors are critical - app can't function
	if (error instanceof ConfigurationError) {
		return ErrorSeverity.CRITICAL;
	}

	// Validation errors are low severity - user input issue
	if (error instanceof ValidationError) {
		return ErrorSeverity.LOW;
	}

	// Network errors - severity depends on status code
	if (error instanceof NetworkError) {
		if (!error.responseStatus) {
			// Network failure (timeout, connection refused)
			return ErrorSeverity.HIGH;
		}
		if (error.responseStatus >= 500) {
			// Server errors
			return ErrorSeverity.HIGH;
		}
		if (error.responseStatus === 429) {
			// Rate limiting
			return ErrorSeverity.MEDIUM;
		}
		if (error.responseStatus >= 400) {
			// Client errors
			return ErrorSeverity.LOW;
		}
	}

	// Shopify GraphQL errors
	if (error instanceof ShopifyGraphQLError) {
		const hasCriticalError = error.graphqlErrors.some(
			(err) => err.code === 'INTERNAL_ERROR'
		);
		return hasCriticalError ? ErrorSeverity.CRITICAL : ErrorSeverity.MEDIUM;
	}

	// General Shopify errors
	if (error instanceof ShopifyError) {
		if (error.errorType === 'RATE_LIMIT_ERROR') {
			return ErrorSeverity.MEDIUM;
		}
		if (error.errorType === 'TIMEOUT_ERROR') {
			return ErrorSeverity.HIGH;
		}
		return ErrorSeverity.MEDIUM;
	}

	// Parser errors
	if (error instanceof ParserError) {
		return ErrorSeverity.MEDIUM;
	}

	// Default severity
	return ErrorSeverity.MEDIUM;
}

/**
 * Determines if an error should break the circuit
 * Circuit breakers open on consecutive failures, but not all errors should count
 */
export function shouldCountForCircuitBreaker(error: unknown): boolean {
	if (error instanceof BaseError) {
		// Don't count validation errors - these are user input issues
		if (error instanceof ValidationError) {
			return false;
		}

		// Don't count configuration errors - these affect all requests equally
		if (error instanceof ConfigurationError) {
			return false;
		}

		// Count network errors and Shopify errors
		if (error instanceof NetworkError || error instanceof ShopifyError) {
			return true;
		}

		// Don't count parser errors - these are usually one-off issues
		if (error instanceof ParserError) {
			return false;
		}
	}

	// For unknown errors, be conservative and count them
	return true;
}

/**
 * Determines the retry delay based on attempt number and error type
 * Used by exponential backoff logic
 */
export function calculateRetryDelay(
	attemptNumber: number,
	error: unknown,
	baseDelayMs: number = 1000,
	maxDelayMs: number = 30000
): number {
	const classified = classifyError(error);

	// Don't retry permanent errors
	if (!classified.shouldRetry) {
		return 0;
	}

	// For rate limit errors, use a longer base delay
	if (
		error instanceof ShopifyError &&
		error.errorType === 'RATE_LIMIT_ERROR'
	) {
		baseDelayMs = 5000; // 5 seconds for rate limits
	}

	// Exponential backoff: delay = baseDelay * 2^attemptNumber
	const exponentialDelay = baseDelayMs * Math.pow(2, attemptNumber - 1);

	// Cap at max delay
	const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

	// Add jitter (random ±20%) to prevent thundering herd
	const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1); // ±20%
	const finalDelay = Math.max(0, cappedDelay + jitter);

	return Math.round(finalDelay);
}

/**
 * Determines maximum retry attempts based on error type
 */
export function getMaxRetries(error: unknown): number {
	if (error instanceof BaseError) {
		// No retries for permanent errors
		if (!error.isRetryable()) {
			return 0;
		}

		// More retries for rate limit errors (they often clear up)
		if (
			error instanceof ShopifyError &&
			error.errorType === 'RATE_LIMIT_ERROR'
		) {
			return 5;
		}

		// Fewer retries for timeout errors
		if (
			error instanceof NetworkError &&
			!error.responseStatus
		) {
			return 2; // Network timeouts
		}

		// Default retries for retryable errors
		return 3;
	}

	// Default for unknown errors
	return 2;
}
