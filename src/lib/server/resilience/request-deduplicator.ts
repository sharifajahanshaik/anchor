/**
 * Request Deduplication Service
 *
 * Prevents duplicate abandonments from being processed multiple times.
 * Uses an in-memory cache with TTL to track recently processed requests.
 */

import { logger } from '$lib/server/logger';
import { getMetricsService } from '$lib/server/metrics';
import { createHash } from 'crypto';

const metricsService = getMetricsService();

// Deduplication metrics
const deduplicationCheckCounter = metricsService.counter({
	name: 'deduplication_check_total',
	description: 'Total number of deduplication checks'
});

const deduplicationHitCounter = metricsService.counter({
	name: 'deduplication_hit_total',
	description: 'Total number of duplicate requests detected'
});

const deduplicationCacheSizeGauge = metricsService.gauge({
	name: 'deduplication_cache_size',
	description: 'Current size of deduplication cache'
});

const deduplicationCacheMissCounter = metricsService.counter({
	name: 'deduplication_cache_miss_total',
	description: 'Total number of cache misses'
});

const deduplicationCacheExpiredCounter = metricsService.counter({
	name: 'deduplication_cache_expired_total',
	description: 'Total number of expired cache entries'
});

const deduplicationDuplicateDetectedCounter = metricsService.counter({
	name: 'deduplication_duplicate_detected_total',
	description: 'Total number of duplicate requests detected'
});

const deduplicationRequestsRecordedCounter = metricsService.counter({
	name: 'deduplication_requests_recorded_total',
	description: 'Total number of requests recorded in cache'
});

/**
 * Deduplication configuration
 */
export interface DeduplicationConfig {
	ttlMs: number; // Time-to-live for cached request IDs
	maxCacheSize: number; // Maximum number of entries to keep in cache
	cleanupIntervalMs: number; // How often to clean up expired entries
}

/**
 * Cached request entry
 */
interface CachedRequest {
	requestId: string;
	timestamp: number;
	expiresAt: number;
	shopUrl?: string;
	metadata?: Record<string, any>;
}

/**
 * Request Deduplicator
 * Tracks recently processed requests to prevent duplicates
 */
export class RequestDeduplicator {
	private cache: Map<string, CachedRequest> = new Map();
	private config: DeduplicationConfig;
	private cleanupTimer?: NodeJS.Timeout;

	constructor(config?: Partial<DeduplicationConfig>) {
		this.config = {
			ttlMs: config?.ttlMs ?? 300000, // 5 minutes default
			maxCacheSize: config?.maxCacheSize ?? 10000,
			cleanupIntervalMs: config?.cleanupIntervalMs ?? 60000 // 1 minute
		};

		// Start periodic cleanup
		this.startCleanupTimer();

		logger.info('Request deduplicator initialized', { config: this.config });
	}

	/**
	 * Checks if a request is a duplicate
	 * Returns true if duplicate, false if new
	 */
	isDuplicate(requestId: string, shopUrl?: string): boolean {
		const key = this.generateKey(requestId, shopUrl);
		const cached = this.cache.get(key);

		if (!cached) {
			deduplicationCacheMissCounter.inc({
				shop: shopUrl ?? 'unknown'
			});
			return false;
		}

		// Check if entry has expired
		if (Date.now() > cached.expiresAt) {
			this.cache.delete(key);
			deduplicationCacheExpiredCounter.inc({
				shop: shopUrl ?? 'unknown'
			});
			return false;
		}

		// Duplicate found
		logger.warn('Duplicate request detected', {
			requestId,
			shopUrl,
			originalTimestamp: cached.timestamp,
			age: Date.now() - cached.timestamp
		});

		deduplicationDuplicateDetectedCounter.inc({
			shop: shopUrl ?? 'unknown'
		});

		return true;
	}

	/**
	 * Records a request to prevent future duplicates
	 */
	recordRequest(
		requestId: string,
		shopUrl?: string,
		metadata?: Record<string, any>
	): void {
		const key = this.generateKey(requestId, shopUrl);
		const now = Date.now();

		const entry: CachedRequest = {
			requestId,
			timestamp: now,
			expiresAt: now + this.config.ttlMs,
			shopUrl,
			metadata
		};

		this.cache.set(key, entry);

		deduplicationRequestsRecordedCounter.inc({
			shop: shopUrl ?? 'unknown'
		});

		deduplicationCacheSizeGauge.set(this.cache.size);

		// Check if we've exceeded max cache size
		if (this.cache.size > this.config.maxCacheSize) {
			logger.warn('Deduplication cache size exceeded, triggering cleanup', {
				size: this.cache.size,
				maxSize: this.config.maxCacheSize
			});
			this.cleanup();
		}
	}

	/**
	 * Checks and records in one operation
	 * Returns true if duplicate, false if new (and records it)
	 */
	checkAndRecord(
		requestId: string,
		shopUrl?: string,
		metadata?: Record<string, any>
	): boolean {
		const isDupe = this.isDuplicate(requestId, shopUrl);

		if (!isDupe) {
			this.recordRequest(requestId, shopUrl, metadata);
		}

		return isDupe;
	}

	/**
	 * Generates a hash-based key for a request
	 */
	private generateKey(requestId: string, shopUrl?: string): string {
		// Include shop URL in key to allow same request ID across different shops
		const combined = shopUrl ? `${shopUrl}:${requestId}` : requestId;
		return createHash('sha256').update(combined).digest('hex');
	}

	/**
	 * Cleans up expired entries from cache
	 */
	cleanup(): void {
		const now = Date.now();
		let removed = 0;

		this.cache.forEach((entry, key) => {
			if (now > entry.expiresAt) {
				this.cache.delete(key);
				removed++;
			}
		});

		// If still over max size, remove oldest entries
		if (this.cache.size > this.config.maxCacheSize) {
			const entries = Array.from(this.cache.entries());
			entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

			const toRemove = this.cache.size - this.config.maxCacheSize;
			for (let i = 0; i < toRemove; i++) {
				this.cache.delete(entries[i][0]);
				removed++;
			}
		}

		if (removed > 0) {
			logger.debug('Cleaned up deduplication cache', { removed, currentSize: this.cache.size });
			deduplicationCacheSizeGauge.set(this.cache.size);
		}
	}

	/**
	 * Starts the periodic cleanup timer
	 */
	private startCleanupTimer(): void {
		this.cleanupTimer = setInterval(() => {
			this.cleanup();
		}, this.config.cleanupIntervalMs);

		// Allow Node.js to exit even if timer is active
		this.cleanupTimer.unref();
	}

	/**
	 * Stops the cleanup timer
	 */
	stopCleanupTimer(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
	}

	/**
	 * Gets cache statistics
	 */
	getStats(): {
		size: number;
		maxSize: number;
		ttlMs: number;
		oldestEntryAge: number | null;
	} {
		let oldestTimestamp = Date.now();
		this.cache.forEach((entry) => {
			if (entry.timestamp < oldestTimestamp) {
				oldestTimestamp = entry.timestamp;
			}
		});

		return {
			size: this.cache.size,
			maxSize: this.config.maxCacheSize,
			ttlMs: this.config.ttlMs,
			oldestEntryAge: this.cache.size > 0 ? Date.now() - oldestTimestamp : null
		};
	}

	/**
	 * Gets entries for a specific shop
	 */
	getEntriesForShop(shopUrl: string): CachedRequest[] {
		const entries: CachedRequest[] = [];
		this.cache.forEach((entry) => {
			if (entry.shopUrl === shopUrl) {
				entries.push(entry);
			}
		});
		return entries;
	}

	/**
	 * Clears all entries (use with caution)
	 */
	clear(): void {
		const size = this.cache.size;
		this.cache.clear();
		logger.info('Deduplication cache cleared', { clearedEntries: size });
		deduplicationCacheSizeGauge.set(0);
	}

	/**
	 * Clears entries for a specific shop
	 */
	clearShop(shopUrl: string): void {
		let removed = 0;
		this.cache.forEach((entry, key) => {
			if (entry.shopUrl === shopUrl) {
				this.cache.delete(key);
				removed++;
			}
		});

		logger.info('Cleared deduplication cache for shop', { shopUrl, removed });
		deduplicationCacheSizeGauge.set(this.cache.size);
	}

	/**
	 * Updates the TTL configuration
	 */
	updateTTL(ttlMs: number): void {
		this.config.ttlMs = ttlMs;
		logger.info('Deduplication TTL updated', { ttlMs });
	}

	/**
	 * Shuts down the deduplicator
	 */
	shutdown(): void {
		this.stopCleanupTimer();
		this.cache.clear();
		logger.info('Request deduplicator shut down');
	}
}

/**
 * Higher-level deduplication utility that generates request IDs
 */
export class AbandonmentDeduplicator {
	private deduplicator: RequestDeduplicator;

	constructor(config?: Partial<DeduplicationConfig>) {
		this.deduplicator = new RequestDeduplicator(config);
	}

	/**
	 * Generates a deterministic request ID from abandonment data
	 */
	private generateRequestId(abandonment: {
		shopUrl: string;
		variantId: string | number;
		quantity: number;
		userInfo?: any;
	}): string {
		// Create a deterministic hash from abandonment properties
		const key = JSON.stringify({
			shop: abandonment.shopUrl,
			variant: abandonment.variantId,
			quantity: abandonment.quantity,
			// Include some user info if available (but don't be too strict)
			userEmail: abandonment.userInfo?.email,
			userPhone: abandonment.userInfo?.phoneNumber
		});

		return createHash('sha256').update(key).digest('hex');
	}

	/**
	 * Checks if an abandonment is a duplicate
	 */
	isDuplicate(abandonment: {
		shopUrl: string;
		variantId: string | number;
		quantity: number;
		userInfo?: any;
	}): boolean {
		const requestId = this.generateRequestId(abandonment);
		return this.deduplicator.isDuplicate(requestId, abandonment.shopUrl);
	}

	/**
	 * Records an abandonment to prevent future duplicates
	 */
	recordAbandonment(abandonment: {
		shopUrl: string;
		variantId: string | number;
		quantity: number;
		userInfo?: any;
	}): void {
		const requestId = this.generateRequestId(abandonment);
		this.deduplicator.recordRequest(requestId, abandonment.shopUrl, {
			variantId: abandonment.variantId,
			quantity: abandonment.quantity
		});
	}

	/**
	 * Checks and records in one operation
	 */
	checkAndRecord(abandonment: {
		shopUrl: string;
		variantId: string | number;
		quantity: number;
		userInfo?: any;
	}): boolean {
		const requestId = this.generateRequestId(abandonment);
		return this.deduplicator.checkAndRecord(requestId, abandonment.shopUrl, {
			variantId: abandonment.variantId,
			quantity: abandonment.quantity
		});
	}

	/**
	 * Gets the underlying deduplicator
	 */
	getDeduplicator(): RequestDeduplicator {
		return this.deduplicator;
	}
}

// Global request deduplicator instance
export const requestDeduplicator = new RequestDeduplicator();

// Global abandonment deduplicator instance
export const abandonmentDeduplicator = new AbandonmentDeduplicator();
