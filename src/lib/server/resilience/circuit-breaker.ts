/**
 * Circuit Breaker Pattern Implementation (Per-Shop)
 *
 * Prevents cascading failures by stopping requests to failing shops.
 * Automatically opens after consecutive failures, and recovers after a cooldown period.
 *
 * Circuit States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Circuit is broken, requests fail fast without attempting
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */

import { logger } from '$lib/server/logger';
import { getMetricsService } from '$lib/server/metrics';
import { shouldCountForCircuitBreaker } from './error-classifier';

const metricsService = getMetricsService();

// Circuit breaker metrics
const circuitBreakerSuccessCounter = metricsService.counter({
	name: 'circuit_breaker_success_total',
	description: 'Total successful requests through circuit breaker'
});

const circuitBreakerFailureCounter = metricsService.counter({
	name: 'circuit_breaker_failure_total',
	description: 'Total failed requests through circuit breaker'
});

const circuitBreakerOpenedCounter = metricsService.counter({
	name: 'circuit_breaker_opened_total',
	description: 'Total number of times circuit breaker opened'
});

const circuitBreakerBlockedCounter = metricsService.counter({
	name: 'circuit_breaker_blocked_total',
	description: 'Total number of blocked requests'
});

const circuitBreakerStateGauge = metricsService.gauge({
	name: 'circuit_breaker_state',
	description: 'Circuit breaker state (0=CLOSED, 0.5=HALF_OPEN, 1=OPEN)'
});

/**
 * Circuit breaker states
 */
export enum CircuitState {
	CLOSED = 'CLOSED',
	OPEN = 'OPEN',
	HALF_OPEN = 'HALF_OPEN'
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
	failureThreshold: number; // Number of consecutive failures before opening
	recoveryTimeout: number; // Milliseconds before attempting recovery
	halfOpenMaxAttempts: number; // Max requests in half-open state
	monitoringPeriod: number; // Time window for tracking failures (ms)
}

/**
 * Circuit breaker metrics
 */
interface CircuitMetrics {
	consecutiveFailures: number;
	lastFailureTime: number;
	successCount: number;
	failureCount: number;
	halfOpenAttempts: number;
}

/**
 * Circuit breaker instance for a single shop
 */
class ShopCircuitBreaker {
	private state: CircuitState = CircuitState.CLOSED;
	private metrics: CircuitMetrics = {
		consecutiveFailures: 0,
		lastFailureTime: 0,
		successCount: 0,
		failureCount: 0,
		halfOpenAttempts: 0
	};

	constructor(
		private readonly shopUrl: string,
		private readonly config: CircuitBreakerConfig
	) {}

	/**
	 * Checks if a request should be allowed
	 */
	async allowRequest(): Promise<boolean> {
		if (this.state === CircuitState.CLOSED) {
			return true;
		}

		if (this.state === CircuitState.OPEN) {
			// Check if recovery timeout has passed
			const timeSinceLastFailure = Date.now() - this.metrics.lastFailureTime;
			if (timeSinceLastFailure >= this.config.recoveryTimeout) {
				logger.info('Circuit breaker entering half-open state', {
					shopUrl: this.shopUrl,
					timeSinceLastFailure
				});
				this.transitionToHalfOpen();
				return true;
			}
			return false; // Still in open state, fail fast
		}

		// HALF_OPEN state - allow limited requests
		if (this.metrics.halfOpenAttempts < this.config.halfOpenMaxAttempts) {
			this.metrics.halfOpenAttempts++;
			return true;
		}

		return false;
	}

	/**
	 * Records a successful request
	 */
	onSuccess(): void {
		this.metrics.successCount++;
		this.metrics.consecutiveFailures = 0;

		if (this.state === CircuitState.HALF_OPEN) {
			logger.info('Circuit breaker closing - recovery successful', {
				shopUrl: this.shopUrl,
				halfOpenAttempts: this.metrics.halfOpenAttempts
			});
			this.transitionToClosed();
		}

		// Update metrics
		circuitBreakerSuccessCounter.inc({
			shop: this.shopUrl,
			state: this.state
		});
	}

	/**
	 * Records a failed request
	 */
	onFailure(error: unknown): void {
		// Only count certain errors for circuit breaking
		if (!shouldCountForCircuitBreaker(error)) {
			logger.debug('Error not counted for circuit breaker', {
				shopUrl: this.shopUrl,
				error: error instanceof Error ? error.message : String(error)
			});
			return;
		}

		this.metrics.failureCount++;
		this.metrics.consecutiveFailures++;
		this.metrics.lastFailureTime = Date.now();

		// Update metrics
		circuitBreakerFailureCounter.inc({
			shop: this.shopUrl,
			state: this.state
		});

		// Check if we should open the circuit
		if (this.state === CircuitState.CLOSED) {
			if (this.metrics.consecutiveFailures >= this.config.failureThreshold) {
				this.transitionToOpen();
			}
		} else if (this.state === CircuitState.HALF_OPEN) {
			// Any failure in half-open immediately reopens the circuit
			logger.warn('Circuit breaker reopening - recovery failed', {
				shopUrl: this.shopUrl,
				error: error instanceof Error ? error.message : String(error)
			});
			this.transitionToOpen();
		}
	}

	/**
	 * Get current state
	 */
	getState(): CircuitState {
		return this.state;
	}

	/**
	 * Get metrics
	 */
	getMetrics(): CircuitMetrics {
		return { ...this.metrics };
	}

	/**
	 * Reset the circuit breaker (for testing or manual intervention)
	 */
	reset(): void {
		logger.info('Circuit breaker manually reset', { shopUrl: this.shopUrl });
		this.transitionToClosed();
		this.metrics = {
			consecutiveFailures: 0,
			lastFailureTime: 0,
			successCount: 0,
			failureCount: 0,
			halfOpenAttempts: 0
		};
	}

	/**
	 * Transition to CLOSED state
	 */
	private transitionToClosed(): void {
		this.state = CircuitState.CLOSED;
		this.metrics.halfOpenAttempts = 0;
		circuitBreakerStateGauge.set(0, { shop: this.shopUrl }); // 0 = CLOSED
	}

	/**
	 * Transition to OPEN state
	 */
	private transitionToOpen(): void {
		logger.error('Circuit breaker opening', undefined, {
			shopUrl: this.shopUrl,
			consecutiveFailures: this.metrics.consecutiveFailures,
			threshold: this.config.failureThreshold
		});

		this.state = CircuitState.OPEN;
		circuitBreakerStateGauge.set(1, { shop: this.shopUrl }); // 1 = OPEN
		circuitBreakerOpenedCounter.inc({ shop: this.shopUrl });
	}

	/**
	 * Transition to HALF_OPEN state
	 */
	private transitionToHalfOpen(): void {
		this.state = CircuitState.HALF_OPEN;
		this.metrics.halfOpenAttempts = 0;
		circuitBreakerStateGauge.set(0.5, { shop: this.shopUrl }); // 0.5 = HALF_OPEN
	}
}

/**
 * Circuit Breaker Manager
 * Manages per-shop circuit breakers
 */
export class CircuitBreakerManager {
	private breakers: Map<string, ShopCircuitBreaker> = new Map();
	private config: CircuitBreakerConfig;

	constructor(config?: Partial<CircuitBreakerConfig>) {
		this.config = {
			failureThreshold: config?.failureThreshold ?? 5,
			recoveryTimeout: config?.recoveryTimeout ?? 60000, // 1 minute
			halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 3,
			monitoringPeriod: config?.monitoringPeriod ?? 300000 // 5 minutes
		};

		logger.info('Circuit breaker manager initialized', { config: this.config });
	}

	/**
	 * Gets or creates a circuit breaker for a shop
	 */
	private getBreaker(shopUrl: string): ShopCircuitBreaker {
		if (!this.breakers.has(shopUrl)) {
			this.breakers.set(shopUrl, new ShopCircuitBreaker(shopUrl, this.config));
			logger.debug('Created new circuit breaker', { shopUrl });
		}
		return this.breakers.get(shopUrl)!;
	}

	/**
	 * Executes a function with circuit breaker protection
	 */
	async execute<T>(
		shopUrl: string,
		fn: () => Promise<T>
	): Promise<T> {
		const breaker = this.getBreaker(shopUrl);

		// Check if request is allowed
		const allowed = await breaker.allowRequest();
		if (!allowed) {
			const error = new Error(
				`Circuit breaker is OPEN for shop: ${shopUrl}. Failing fast to prevent cascading failures.`
			);
			logger.warn('Request blocked by circuit breaker', { shopUrl });
			circuitBreakerBlockedCounter.inc({ shop: shopUrl });
			throw error;
		}

		// Execute the function
		try {
			const result = await fn();
			breaker.onSuccess();
			return result;
		} catch (error) {
			breaker.onFailure(error);
			throw error;
		}
	}

	/**
	 * Checks if a shop's circuit is open
	 */
	isOpen(shopUrl: string): boolean {
		const breaker = this.breakers.get(shopUrl);
		return breaker?.getState() === CircuitState.OPEN;
	}

	/**
	 * Gets the state of a shop's circuit breaker
	 */
	getState(shopUrl: string): CircuitState {
		const breaker = this.breakers.get(shopUrl);
		return breaker?.getState() ?? CircuitState.CLOSED;
	}

	/**
	 * Gets metrics for a shop's circuit breaker
	 */
	getMetrics(shopUrl: string): CircuitMetrics | null {
		const breaker = this.breakers.get(shopUrl);
		return breaker?.getMetrics() ?? null;
	}

	/**
	 * Manually resets a circuit breaker
	 */
	reset(shopUrl: string): void {
		const breaker = this.breakers.get(shopUrl);
		breaker?.reset();
	}

	/**
	 * Resets all circuit breakers
	 */
	resetAll(): void {
		logger.info('Resetting all circuit breakers', { count: this.breakers.size });
		this.breakers.forEach((breaker) => breaker.reset());
	}

	/**
	 * Gets all circuit breaker states
	 */
	getAllStates(): Map<string, CircuitState> {
		const states = new Map<string, CircuitState>();
		this.breakers.forEach((breaker, shopUrl) => {
			states.set(shopUrl, breaker.getState());
		});
		return states;
	}

	/**
	 * Cleanup old circuit breakers to prevent memory leaks
	 */
	cleanup(): void {
		const now = Date.now();
		let removed = 0;

		this.breakers.forEach((breaker, shopUrl) => {
			const metrics = breaker.getMetrics();
			const timeSinceActivity = now - metrics.lastFailureTime;

			// Remove breakers that have been inactive for longer than monitoring period
			if (
				breaker.getState() === CircuitState.CLOSED &&
				metrics.consecutiveFailures === 0 &&
				timeSinceActivity > this.config.monitoringPeriod
			) {
				this.breakers.delete(shopUrl);
				removed++;
			}
		});

		if (removed > 0) {
			logger.debug('Cleaned up inactive circuit breakers', { removed });
		}
	}
}

// Global circuit breaker manager instance
export const circuitBreaker = new CircuitBreakerManager();
