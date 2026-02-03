/**
 * Status Code Tracker
 *
 * Tracks HTTP status code occurrences per endpoint and shop.
 * Maintains statistics for monitoring and alerting.
 */

import type {
	IStatusCodeTracker,
	StatusCodeStats,
	ApiEndpoint
} from './monitoring.types';
import { logger } from '../logger/index';
import type { MetricsService } from '../metrics/index';
import { StandardMetricName, StandardLabelName } from '../metrics/index';

/**
 * Status code tracker implementation
 */
export class StatusCodeTracker implements IStatusCodeTracker {
	private stats: Map<string, StatusCodeStats>;
	private metricsService: MetricsService;

	constructor(metricsService: MetricsService) {
		this.stats = new Map();
		this.metricsService = metricsService;
		logger.debug('StatusCodeTracker initialized');
	}

	/**
	 * Track a status code occurrence
	 */
	track(endpoint: ApiEndpoint, statusCode: number, shop: string): void {
		const key = this.getKey(endpoint, statusCode);

		let stat = this.stats.get(key);
		if (!stat) {
			stat = {
				endpoint,
				statusCode,
				count: 0,
				lastSeen: new Date(),
				shops: new Set()
			};
			this.stats.set(key, stat);
		}

		// Update statistics
		stat.count++;
		stat.lastSeen = new Date();
		stat.shops.add(shop);

		// Track in metrics
		const apiRequestsCounter = this.metricsService.counter({
			name: StandardMetricName.API_REQUESTS,
			description: 'Total API requests by endpoint and status code'
		});
		apiRequestsCounter.inc({
			[StandardLabelName.ENDPOINT]: endpoint,
			[StandardLabelName.STATUS_CODE]: statusCode.toString(),
			[StandardLabelName.SHOP]: shop
		});

		// Track non-200 responses separately
		if (statusCode < 200 || statusCode >= 300) {
			const non200Counter = this.metricsService.counter({
				name: StandardMetricName.API_REQUESTS_NON_200,
				description: 'Non-200 API responses by endpoint'
			});
			non200Counter.inc({
				[StandardLabelName.ENDPOINT]: endpoint,
				[StandardLabelName.STATUS_CODE]: statusCode.toString(),
				[StandardLabelName.SHOP]: shop
			});
		}

		logger.debug('Status code tracked', {
			endpoint,
			statusCode,
			shop,
			totalCount: stat.count,
			affectedShops: stat.shops.size
		});
	}

	/**
	 * Get stats for a specific status code
	 */
	getStats(endpoint: ApiEndpoint, statusCode: number): StatusCodeStats | undefined {
		const key = this.getKey(endpoint, statusCode);
		return this.stats.get(key);
	}

	/**
	 * Get all stats for an endpoint
	 */
	getEndpointStats(endpoint: ApiEndpoint): StatusCodeStats[] {
		const endpointStats: StatusCodeStats[] = [];

		for (const [key, stat] of this.stats.entries()) {
			if (key.startsWith(`${endpoint}:`)) {
				endpointStats.push(stat);
			}
		}

		return endpointStats.sort((a, b) => b.count - a.count);
	}

	/**
	 * Reset all statistics
	 */
	reset(): void {
		const previousSize = this.stats.size;
		this.stats.clear();
		logger.info('Status code tracker reset', {
			previousEntries: previousSize
		});
	}

	/**
	 * Generate key for stats map
	 */
	private getKey(endpoint: ApiEndpoint, statusCode: number): string {
		return `${endpoint}:${statusCode}`;
	}

	/**
	 * Get total number of tracked status codes
	 */
	getTrackedCount(): number {
		return this.stats.size;
	}

	/**
	 * Get all unique endpoints being tracked
	 */
	getTrackedEndpoints(): ApiEndpoint[] {
		const endpoints = new Set<ApiEndpoint>();
		for (const stat of this.stats.values()) {
			endpoints.add(stat.endpoint);
		}
		return Array.from(endpoints);
	}

	/**
	 * Get summary statistics
	 */
	getSummary(): {
		totalEndpoints: number;
		totalStatusCodes: number;
		totalRequests: number;
	} {
		const endpoints = new Set<ApiEndpoint>();
		let totalRequests = 0;

		for (const stat of this.stats.values()) {
			endpoints.add(stat.endpoint);
			totalRequests += stat.count;
		}

		return {
			totalEndpoints: endpoints.size,
			totalStatusCodes: this.stats.size,
			totalRequests
		};
	}
}
