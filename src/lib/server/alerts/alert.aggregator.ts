/**
 * Alert Aggregator
 *
 * Implements alert deduplication logic to prevent alert spam.
 * Tracks alerts within a time window and suppresses duplicates.
 *
 * @module alerts/alert.aggregator
 */

import { getLogger } from '../logger';
import type {
	Alert,
	AlertKey,
	DeduplicationConfig,
	DuplicateAlertEntry,
	IAlertAggregator
} from './alert.types';

// Logger for alert aggregator
const logger = getLogger('alert-aggregator');

/**
 * Alert aggregator implementation
 */
export class AlertAggregator implements IAlertAggregator {
	private config: DeduplicationConfig;
	private alertCache: Map<string, DuplicateAlertEntry> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(config: DeduplicationConfig) {
		this.config = config;

		// Start periodic cleanup of expired entries
		this.startCleanup();

		logger.debug('Alert aggregator initialized', {
			windowMs: config.windowMs,
			maxAlertsPerWindow: config.maxAlertsPerWindow
		});
	}

	/**
	 * Generate a unique key for an alert based on deduplication criteria
	 */
	private generateAlertKey(alert: Alert): string {
		const key: AlertKey = {
			type: alert.type,
			severity: alert.severity,
			shop: alert.context?.shop,
			endpoint: alert.context?.endpoint,
			errorType: alert.context?.errorType
		};

		// Create a stable string representation
		return JSON.stringify({
			type: key.type,
			severity: key.severity,
			shop: key.shop || '',
			endpoint: key.endpoint || '',
			errorType: key.errorType || ''
		});
	}

	/**
	 * Check if an alert should be sent (not a duplicate)
	 */
	shouldSendAlert(alert: Alert): boolean {
		const key = this.generateAlertKey(alert);
		const now = new Date();
		const entry = this.alertCache.get(key);

		if (!entry) {
			// First time seeing this alert
			logger.debug('Alert is new, should send', { key });
			return true;
		}

		// Check if the alert is within the deduplication window
		const timeSinceFirst = now.getTime() - entry.firstSeen.getTime();
		if (timeSinceFirst > this.config.windowMs) {
			// Window has expired, allow the alert
			logger.debug('Alert deduplication window expired, should send', {
				key,
				timeSinceFirst,
				windowMs: this.config.windowMs
			});
			return true;
		}

		// Check if we've hit the max alerts per window
		if (entry.count >= this.config.maxAlertsPerWindow) {
			logger.debug('Alert suppressed due to deduplication', {
				key,
				count: entry.count,
				maxAlertsPerWindow: this.config.maxAlertsPerWindow,
				timeSinceFirst
			});
			return false;
		}

		// Allow the alert
		logger.debug('Alert within window but under limit, should send', {
			key,
			count: entry.count,
			maxAlertsPerWindow: this.config.maxAlertsPerWindow
		});
		return true;
	}

	/**
	 * Record an alert for deduplication tracking
	 */
	recordAlert(alert: Alert): void {
		const key = this.generateAlertKey(alert);
		const now = new Date();
		const entry = this.alertCache.get(key);

		if (!entry) {
			// First occurrence
			this.alertCache.set(key, {
				firstSeen: now,
				lastSeen: now,
				count: 1,
				alert
			});
			logger.debug('Alert recorded (first occurrence)', { key });
		} else {
			// Check if we should reset the window
			const timeSinceFirst = now.getTime() - entry.firstSeen.getTime();
			if (timeSinceFirst > this.config.windowMs) {
				// Reset the window
				this.alertCache.set(key, {
					firstSeen: now,
					lastSeen: now,
					count: 1,
					alert
				});
				logger.debug('Alert window reset', { key });
			} else {
				// Increment count within existing window
				entry.lastSeen = now;
				entry.count++;
				logger.debug('Alert count incremented', {
					key,
					count: entry.count
				});
			}
		}
	}

	/**
	 * Get statistics about deduplicated alerts
	 */
	getStats(): Map<string, DuplicateAlertEntry> {
		return new Map(this.alertCache);
	}

	/**
	 * Clear all deduplication state
	 */
	clear(): void {
		this.alertCache.clear();
		logger.debug('Alert cache cleared');
	}

	/**
	 * Start periodic cleanup of expired entries
	 */
	private startCleanup(): void {
		// Run cleanup every minute
		const cleanupIntervalMs = 60 * 1000;

		this.cleanupInterval = setInterval(() => {
			this.cleanup();
		}, cleanupIntervalMs);

		// Ensure the interval doesn't prevent process exit
		if (this.cleanupInterval.unref) {
			this.cleanupInterval.unref();
		}
	}

	/**
	 * Clean up expired entries from the cache
	 */
	private cleanup(): void {
		const now = new Date();
		let removedCount = 0;

		for (const [key, entry] of this.alertCache.entries()) {
			const timeSinceFirst = now.getTime() - entry.firstSeen.getTime();
			if (timeSinceFirst > this.config.windowMs) {
				this.alertCache.delete(key);
				removedCount++;
			}
		}

		if (removedCount > 0) {
			logger.debug('Cleanup completed', {
				removedCount,
				remainingCount: this.alertCache.size
			});
		}
	}

	/**
	 * Stop the cleanup interval
	 */
	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
			logger.debug('Alert aggregator cleanup interval stopped');
		}
	}
}

/**
 * Create a new alert aggregator instance
 */
export function createAlertAggregator(config: DeduplicationConfig): IAlertAggregator {
	return new AlertAggregator(config);
}
