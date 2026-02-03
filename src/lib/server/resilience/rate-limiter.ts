/**
 * Rate Limiter (Per-Shop, Token Bucket Algorithm)
 *
 * Implements token bucket algorithm to prevent overwhelming Shopify with requests.
 * Each shop has its own bucket that refills at a steady rate.
 */

import { logger } from '$lib/server/logger';
import { getMetricsService } from '$lib/server/metrics';

const metricsService = getMetricsService();

// Rate limiter metrics
const rateLimitCounter = metricsService.counter({
	name: 'rate_limit_total',
	description: 'Total number of rate limit checks'
});

const rateLimitBlockedCounter = metricsService.counter({
	name: 'rate_limit_blocked_total',
	description: 'Total number of blocked requests due to rate limiting'
});

const rateLimiterRequestsAllowedCounter = metricsService.counter({
	name: 'rate_limiter_requests_allowed_total',
	description: 'Total number of allowed requests'
});

const rateLimiterRequestsRejectedCounter = metricsService.counter({
	name: 'rate_limiter_requests_rejected_total',
	description: 'Total number of rejected requests'
});

const rateLimiterTokensGauge = metricsService.gauge({
	name: 'rate_limiter_tokens_available',
	description: 'Number of tokens available in the bucket'
});

const rateLimiterWaitTimeHistogram = metricsService.histogram({
	name: 'rate_limiter_wait_time_ms',
	description: 'Wait time for rate limiting in milliseconds',
	unit: 'milliseconds'
});

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
	tokensPerInterval: number; // Number of tokens to add per interval
	interval: number; // Interval in milliseconds
	maxTokens: number; // Maximum tokens in bucket (burst capacity)
}

/**
 * Token bucket state
 */
interface TokenBucket {
	tokens: number;
	lastRefillTime: number;
}

/**
 * Token bucket rate limiter for a single shop
 */
class ShopRateLimiter {
	private bucket: TokenBucket;

	constructor(
		private readonly shopUrl: string,
		private readonly config: RateLimiterConfig
	) {
		this.bucket = {
			tokens: config.maxTokens, // Start with full bucket
			lastRefillTime: Date.now()
		};
	}

	/**
	 * Attempts to consume tokens from the bucket
	 * Returns true if tokens were available, false if rate limited
	 */
	async tryConsume(tokensNeeded: number = 1): Promise<boolean> {
		// Refill bucket based on time elapsed
		this.refill();

		// Check if we have enough tokens
		if (this.bucket.tokens >= tokensNeeded) {
			this.bucket.tokens -= tokensNeeded;

			rateLimiterTokensGauge.set(this.bucket.tokens, {
				shop: this.shopUrl
			});

			rateLimiterRequestsAllowedCounter.inc({
				shop: this.shopUrl
			});

			return true;
		}

		// Rate limited
		logger.warn('Rate limit exceeded', {
			shopUrl: this.shopUrl,
			tokensNeeded,
			tokensAvailable: this.bucket.tokens,
			maxTokens: this.config.maxTokens
		});

		rateLimiterRequestsRejectedCounter.inc({
			shop: this.shopUrl
		});

		return false;
	}

	/**
	 * Waits until enough tokens are available, then consumes them
	 */
	async consume(tokensNeeded: number = 1): Promise<void> {
		// Try to consume immediately
		if (await this.tryConsume(tokensNeeded)) {
			return;
		}

		// Calculate how long to wait
		const waitTime = this.calculateWaitTime(tokensNeeded);

		logger.info('Waiting for rate limiter', {
			shopUrl: this.shopUrl,
			tokensNeeded,
			waitTimeMs: waitTime
		});

		rateLimiterWaitTimeHistogram.record(waitTime, {
			shop: this.shopUrl
		});

		// Wait for tokens to refill
		await new Promise((resolve) => setTimeout(resolve, waitTime));

		// Refill and consume
		this.refill();
		this.bucket.tokens -= tokensNeeded;

		rateLimiterRequestsAllowedCounter.inc({
			shop: this.shopUrl
		});
	}

	/**
	 * Refills the token bucket based on elapsed time
	 */
	private refill(): void {
		const now = Date.now();
		const elapsed = now - this.bucket.lastRefillTime;

		// Calculate tokens to add based on elapsed time
		const tokensToAdd = (elapsed / this.config.interval) * this.config.tokensPerInterval;

		if (tokensToAdd > 0) {
			this.bucket.tokens = Math.min(
				this.config.maxTokens,
				this.bucket.tokens + tokensToAdd
			);
			this.bucket.lastRefillTime = now;
		}
	}

	/**
	 * Calculates wait time until enough tokens are available
	 */
	private calculateWaitTime(tokensNeeded: number): number {
		const tokensDeficit = tokensNeeded - this.bucket.tokens;
		if (tokensDeficit <= 0) {
			return 0;
		}

		// Calculate time needed to accumulate the deficit
		const intervalsNeeded = Math.ceil(tokensDeficit / this.config.tokensPerInterval);
		return intervalsNeeded * this.config.interval;
	}

	/**
	 * Gets current bucket state
	 */
	getState(): { tokens: number; maxTokens: number; refillRate: number } {
		this.refill(); // Ensure state is current
		return {
			tokens: this.bucket.tokens,
			maxTokens: this.config.maxTokens,
			refillRate: this.config.tokensPerInterval / this.config.interval
		};
	}

	/**
	 * Resets the bucket to full capacity
	 */
	reset(): void {
		this.bucket.tokens = this.config.maxTokens;
		this.bucket.lastRefillTime = Date.now();
		logger.debug('Rate limiter reset', { shopUrl: this.shopUrl });
	}
}

/**
 * Rate Limiter Manager
 * Manages per-shop rate limiters
 */
export class RateLimiterManager {
	private limiters: Map<string, ShopRateLimiter> = new Map();
	private config: RateLimiterConfig;

	constructor(config?: Partial<RateLimiterConfig>) {
		this.config = {
			tokensPerInterval: config?.tokensPerInterval ?? 10, // 10 requests
			interval: config?.interval ?? 1000, // per second
			maxTokens: config?.maxTokens ?? 20 // burst capacity of 20
		};

		logger.info('Rate limiter manager initialized', { config: this.config });
	}

	/**
	 * Gets or creates a rate limiter for a shop
	 */
	private getLimiter(shopUrl: string): ShopRateLimiter {
		if (!this.limiters.has(shopUrl)) {
			this.limiters.set(shopUrl, new ShopRateLimiter(shopUrl, this.config));
			logger.debug('Created new rate limiter', { shopUrl });
		}
		return this.limiters.get(shopUrl)!;
	}

	/**
	 * Attempts to consume tokens without waiting
	 * Returns true if allowed, false if rate limited
	 */
	async tryConsume(shopUrl: string, tokensNeeded: number = 1): Promise<boolean> {
		const limiter = this.getLimiter(shopUrl);
		return limiter.tryConsume(tokensNeeded);
	}

	/**
	 * Waits until tokens are available, then consumes them
	 */
	async consume(shopUrl: string, tokensNeeded: number = 1): Promise<void> {
		const limiter = this.getLimiter(shopUrl);
		return limiter.consume(tokensNeeded);
	}

	/**
	 * Executes a function with rate limiting
	 */
	async execute<T>(
		shopUrl: string,
		fn: () => Promise<T>,
		tokensNeeded: number = 1
	): Promise<T> {
		await this.consume(shopUrl, tokensNeeded);
		return fn();
	}

	/**
	 * Gets the current state of a shop's rate limiter
	 */
	getState(shopUrl: string): { tokens: number; maxTokens: number; refillRate: number } | null {
		const limiter = this.limiters.get(shopUrl);
		return limiter?.getState() ?? null;
	}

	/**
	 * Resets a shop's rate limiter
	 */
	reset(shopUrl: string): void {
		const limiter = this.limiters.get(shopUrl);
		limiter?.reset();
	}

	/**
	 * Resets all rate limiters
	 */
	resetAll(): void {
		logger.info('Resetting all rate limiters', { count: this.limiters.size });
		this.limiters.forEach((limiter) => limiter.reset());
	}

	/**
	 * Gets all rate limiter states
	 */
	getAllStates(): Map<string, { tokens: number; maxTokens: number; refillRate: number }> {
		const states = new Map();
		this.limiters.forEach((limiter, shopUrl) => {
			states.set(shopUrl, limiter.getState());
		});
		return states;
	}

	/**
	 * Cleanup old rate limiters to prevent memory leaks
	 */
	cleanup(): void {
		// Remove rate limiters that have been idle and are at full capacity
		let removed = 0;
		this.limiters.forEach((limiter, shopUrl) => {
			const state = limiter.getState();
			if (state.tokens === state.maxTokens) {
				// Limiter is full and hasn't been used recently
				this.limiters.delete(shopUrl);
				removed++;
			}
		});

		if (removed > 0) {
			logger.debug('Cleaned up idle rate limiters', { removed });
		}
	}

	/**
	 * Updates the rate limiter configuration
	 * NOTE: Only affects new rate limiters, existing ones keep their config
	 */
	updateConfig(config: Partial<RateLimiterConfig>): void {
		this.config = { ...this.config, ...config };
		logger.info('Rate limiter configuration updated', { config: this.config });
	}

	/**
	 * Creates a custom rate limiter for a specific shop
	 */
	createCustomLimiter(shopUrl: string, config: Partial<RateLimiterConfig>): void {
		const customConfig = { ...this.config, ...config };
		this.limiters.set(shopUrl, new ShopRateLimiter(shopUrl, customConfig));
		logger.info('Created custom rate limiter', { shopUrl, config: customConfig });
	}
}

// Global rate limiter manager instance
export const rateLimiter = new RateLimiterManager();

/**
 * Pre-configured rate limiters for common scenarios
 */
export const RateLimitProfiles = {
	/**
	 * Conservative - for shops with strict rate limits
	 */
	CONSERVATIVE: {
		tokensPerInterval: 5,
		interval: 1000, // 5 requests/second
		maxTokens: 10
	},

	/**
	 * Standard - balanced rate limiting
	 */
	STANDARD: {
		tokensPerInterval: 10,
		interval: 1000, // 10 requests/second
		maxTokens: 20
	},

	/**
	 * Aggressive - for shops that can handle more load
	 */
	AGGRESSIVE: {
		tokensPerInterval: 20,
		interval: 1000, // 20 requests/second
		maxTokens: 40
	},

	/**
	 * Burst - allows high burst but low sustained rate
	 */
	BURST: {
		tokensPerInterval: 5,
		interval: 1000, // 5 requests/second sustained
		maxTokens: 50 // but allows bursts of 50
	}
};
