/**
 * Exponential Backoff with Jitter
 *
 * Implements retry logic with exponential backoff and jitter to prevent thundering herd.
 * Works in conjunction with error classification and circuit breakers.
 */

import { logger } from '$lib/server/logger';
import { getMetricsService } from '$lib/server/metrics';
import { classifyError, calculateRetryDelay, getMaxRetries } from './error-classifier';
import { circuitBreaker } from './circuit-breaker';

const metricsService = getMetricsService();

// Retry metrics
const retryAttemptCounter = metricsService.counter({
	name: 'retry_attempt_total',
	description: 'Total number of retry attempts'
});

const retrySuccessCounter = metricsService.counter({
	name: 'retry_success_total',
	description: 'Total number of successful retries'
});

const retryExhaustedCounter = metricsService.counter({
	name: 'retry_exhausted_total',
	description: 'Total number of times retries were exhausted'
});

const retryBackoffDelayHistogram = metricsService.histogram({
	name: 'retry_backoff_delay_ms',
	description: 'Retry backoff delay in milliseconds',
	unit: 'milliseconds'
});

/**
 * Backoff configuration
 */
export interface BackoffConfig {
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
	jitterFactor: number; // 0-1, controls randomness (0 = no jitter, 1 = full jitter)
	retryableStatusCodes?: number[];
}

/**
 * Retry context
 */
export interface RetryContext {
	attemptNumber: number;
	lastError?: unknown;
	totalElapsedMs: number;
	shopUrl?: string;
	operationName?: string;
}

/**
 * Default backoff configuration
 */
const DEFAULT_CONFIG: BackoffConfig = {
	maxRetries: 3,
	baseDelayMs: 1000, // 1 second
	maxDelayMs: 30000, // 30 seconds
	jitterFactor: 0.2, // 20% jitter
	retryableStatusCodes: [408, 429, 500, 502, 503, 504]
};

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a function with exponential backoff retry logic
 */
export async function withExponentialBackoff<T>(
	fn: () => Promise<T>,
	config: Partial<BackoffConfig> = {},
	context?: Partial<RetryContext>
): Promise<T> {
	const mergedConfig = { ...DEFAULT_CONFIG, ...config };
	const retryContext: RetryContext = {
		attemptNumber: 0,
		totalElapsedMs: 0,
		shopUrl: context?.shopUrl,
		operationName: context?.operationName ?? 'unknown_operation'
	};

	const startTime = Date.now();

	while (retryContext.attemptNumber < mergedConfig.maxRetries) {
		retryContext.attemptNumber++;

		try {
			// If circuit breaker exists for this shop, check it
			if (retryContext.shopUrl && circuitBreaker.isOpen(retryContext.shopUrl)) {
				logger.warn('Circuit breaker is open, aborting retry', {
					shopUrl: retryContext.shopUrl,
					attemptNumber: retryContext.attemptNumber
				});
				throw new Error(
					`Circuit breaker is OPEN for shop: ${retryContext.shopUrl}`
				);
			}

			// Execute the function
			const result = await fn();

			// Success - log if this was a retry
			if (retryContext.attemptNumber > 1) {
				logger.info('Operation succeeded after retry', {
					attemptNumber: retryContext.attemptNumber,
					totalElapsedMs: Date.now() - startTime,
					shopUrl: retryContext.shopUrl,
					operationName: retryContext.operationName
				});

				retrySuccessCounter.inc({
					operation: retryContext.operationName || 'unknown',
					attempt: retryContext.attemptNumber.toString()
				});
			}

			return result;
		} catch (error) {
			retryContext.lastError = error;
			retryContext.totalElapsedMs = Date.now() - startTime;

			// Classify the error
			const classification = classifyError(error, {
				shopUrl: retryContext.shopUrl,
				retryCount: retryContext.attemptNumber
			});

			// Log the failure
			logger.warn('Operation failed, evaluating retry', {
				attemptNumber: retryContext.attemptNumber,
				maxRetries: mergedConfig.maxRetries,
				shouldRetry: classification.shouldRetry,
				classification: classification.classification,
				severity: classification.severity,
				error: error instanceof Error ? error.message : String(error),
				shopUrl: retryContext.shopUrl,
				operationName: retryContext.operationName
			});

			// Track retry metrics
			retryAttemptCounter.inc({
				operation: retryContext.operationName || 'unknown',
				attempt: retryContext.attemptNumber.toString(),
				classification: classification.classification
			});

			// Check if we should retry
			if (!classification.shouldRetry) {
				logger.error('Error is not retryable, aborting', error instanceof Error ? error : undefined, {
					errorMessage: error instanceof Error ? error.message : String(error),
					classification: classification.classification
				});
				throw error;
			}

			// Check if we've exhausted retries
			const effectiveMaxRetries = Math.min(
				mergedConfig.maxRetries,
				getMaxRetries(error)
			);

			if (retryContext.attemptNumber >= effectiveMaxRetries) {
				logger.error('Max retries exhausted', error instanceof Error ? error : undefined, {
					attemptNumber: retryContext.attemptNumber,
					maxRetries: effectiveMaxRetries,
					totalElapsedMs: retryContext.totalElapsedMs,
					shopUrl: retryContext.shopUrl,
					operationName: retryContext.operationName
				});

				retryExhaustedCounter.inc({
					operation: retryContext.operationName || 'unknown',
					attempts: retryContext.attemptNumber.toString()
				});

				throw error;
			}

			// Calculate backoff delay
			const delay = calculateRetryDelay(
				retryContext.attemptNumber,
				error,
				mergedConfig.baseDelayMs,
				mergedConfig.maxDelayMs
			);

			logger.info('Retrying after backoff delay', {
				attemptNumber: retryContext.attemptNumber,
				delayMs: delay,
				nextAttempt: retryContext.attemptNumber + 1,
				shopUrl: retryContext.shopUrl,
				operationName: retryContext.operationName
			});

			// Track backoff delay
			retryBackoffDelayHistogram.record(delay, {
				operation: retryContext.operationName || 'unknown',
				attempt: retryContext.attemptNumber.toString()
			});

			// Wait before retrying
			await sleep(delay);
		}
	}

	// This should never be reached, but TypeScript needs it
	throw retryContext.lastError ?? new Error('Max retries exhausted');
}

/**
 * Calculates exponential backoff delay with jitter
 */
export function calculateBackoffDelay(
	attemptNumber: number,
	baseDelayMs: number,
	maxDelayMs: number,
	jitterFactor: number = 0.2
): number {
	// Exponential backoff: delay = baseDelay * 2^(attemptNumber - 1)
	const exponentialDelay = baseDelayMs * Math.pow(2, attemptNumber - 1);

	// Cap at max delay
	const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

	// Add jitter to prevent thundering herd
	// Jitter range: [delay * (1 - jitterFactor), delay * (1 + jitterFactor)]
	const jitterRange = cappedDelay * jitterFactor;
	const jitter = jitterRange * (Math.random() * 2 - 1); // ±jitterRange

	const finalDelay = Math.max(0, cappedDelay + jitter);

	return Math.round(finalDelay);
}

/**
 * Creates a retry policy for a specific operation
 */
export function createRetryPolicy(
	operationName: string,
	config: Partial<BackoffConfig> = {}
) {
	return {
		/**
		 * Executes a function with this retry policy
		 */
		async execute<T>(
			fn: () => Promise<T>,
			shopUrl?: string
		): Promise<T> {
			return withExponentialBackoff(fn, config, { operationName, shopUrl });
		}
	};
}

/**
 * Pre-configured retry policies for common operations
 */
export const RetryPolicies = {
	/**
	 * Fast retry - for lightweight operations
	 */
	FAST: createRetryPolicy('fast_operation', {
		maxRetries: 2,
		baseDelayMs: 500,
		maxDelayMs: 5000
	}),

	/**
	 * Standard retry - for normal operations
	 */
	STANDARD: createRetryPolicy('standard_operation', {
		maxRetries: 3,
		baseDelayMs: 1000,
		maxDelayMs: 30000
	}),

	/**
	 * Aggressive retry - for critical operations
	 */
	AGGRESSIVE: createRetryPolicy('aggressive_operation', {
		maxRetries: 5,
		baseDelayMs: 2000,
		maxDelayMs: 60000
	}),

	/**
	 * Rate limit retry - for rate-limited APIs
	 */
	RATE_LIMIT: createRetryPolicy('rate_limit_operation', {
		maxRetries: 5,
		baseDelayMs: 5000,
		maxDelayMs: 120000 // 2 minutes max
	}),

	/**
	 * Network retry - for network operations
	 */
	NETWORK: createRetryPolicy('network_operation', {
		maxRetries: 3,
		baseDelayMs: 1000,
		maxDelayMs: 30000
	})
};
