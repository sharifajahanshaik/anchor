/**
 * API Response Monitor
 *
 * Monitors all API responses, tracks status codes, and maintains
 * a time-windowed history of non-200 responses for alerting.
 */

import type {
	IApiResponseMonitor,
	ApiResponseData,
	StatusCodeStats,
	ApiEndpoint,
	ApiResponseMonitorConfig
} from './monitoring.types';
import { getStatusCodeCategory } from './monitoring.types';
import { StatusCodeTracker } from './status-code.tracker';
import { logger } from '../logger/index';
import type { MetricsService } from '../metrics/index';
import { StandardMetricName, StandardLabelName } from '../metrics/index';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ApiResponseMonitorConfig = {
	alertOnNon200: true,
	trackInMetrics: true,
	maxResponseBodySize: 1000, // 1KB
	enabled: true
};

/**
 * API response monitor implementation
 */
export class ApiResponseMonitor implements IApiResponseMonitor {
	private config: ApiResponseMonitorConfig;
	private statusCodeTracker: StatusCodeTracker;
	private metricsService: MetricsService;
	private responseHistory: ApiResponseData[];
	private readonly maxHistorySize: number = 1000; // Keep last 1000 responses

	constructor(
		metricsService: MetricsService,
		statusCodeTracker: StatusCodeTracker,
		config: Partial<ApiResponseMonitorConfig> = {}
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.statusCodeTracker = statusCodeTracker;
		this.metricsService = metricsService;
		this.responseHistory = [];

		logger.info('ApiResponseMonitor initialized', {
			config: this.config
		});
	}

	/**
	 * Track an API response
	 */
	trackResponse(data: ApiResponseData): void {
		if (!this.config.enabled) {
			return;
		}

		// Ensure status category is set
		if (!data.statusCategory) {
			data.statusCategory = getStatusCodeCategory(data.statusCode);
		}

		// Track in status code tracker
		this.statusCodeTracker.track(data.endpoint, data.statusCode, data.shop);

		// Add to response history
		this.responseHistory.push(data);

		// Trim history if too large
		if (this.responseHistory.length > this.maxHistorySize) {
			this.responseHistory = this.responseHistory.slice(-this.maxHistorySize);
		}

		// Track latency in metrics
		if (this.config.trackInMetrics) {
			const durationHistogram = this.metricsService.histogram({
				name: StandardMetricName.API_REQUEST_DURATION,
				description: 'API request duration in seconds',
				unit: 'seconds'
			});
			durationHistogram.record(data.durationMs / 1000, {
				[StandardLabelName.ENDPOINT]: data.endpoint,
				[StandardLabelName.SHOP]: data.shop,
				[StandardLabelName.STATUS_CODE]: data.statusCode.toString()
			});

			// Note: Last API response status is not implemented as it's not in the metric names
			// If needed, add LAST_API_RESPONSE_STATUS to MetricNames constant
		}

		// Log the response
		const logLevel = data.statusCode >= 200 && data.statusCode < 300 ? 'debug' : 'warn';
		logger[logLevel]('API response tracked', {
			endpoint: data.endpoint,
			shop: data.shop,
			statusCode: data.statusCode,
			statusCategory: data.statusCategory,
			durationMs: data.durationMs,
			requestId: data.requestId,
			retryAttempt: data.retryAttempt,
			errorMessage: data.errorMessage
		});
	}

	/**
	 * Get statistics for a specific status code
	 */
	getStats(endpoint: ApiEndpoint, statusCode: number): StatusCodeStats | undefined {
		return this.statusCodeTracker.getStats(endpoint, statusCode);
	}

	/**
	 * Get all non-200 responses in a time window
	 */
	getNon200Responses(sinceMs: number): ApiResponseData[] {
		const cutoffTime = Date.now() - sinceMs;

		return this.responseHistory.filter((response) => {
			const isNon200 = response.statusCode < 200 || response.statusCode >= 300;
			const isRecent = response.timestamp.getTime() >= cutoffTime;
			return isNon200 && isRecent;
		});
	}

	/**
	 * Get all responses in a time window
	 */
	getRecentResponses(sinceMs: number): ApiResponseData[] {
		const cutoffTime = Date.now() - sinceMs;

		return this.responseHistory.filter((response) => {
			return response.timestamp.getTime() >= cutoffTime;
		});
	}

	/**
	 * Clear old response data
	 */
	cleanup(olderThanMs: number): void {
		const cutoffTime = Date.now() - olderThanMs;
		const beforeCount = this.responseHistory.length;

		this.responseHistory = this.responseHistory.filter((response) => {
			return response.timestamp.getTime() >= cutoffTime;
		});

		const removedCount = beforeCount - this.responseHistory.length;

		if (removedCount > 0) {
			logger.debug('Cleaned up old response data', {
				removedCount,
				remainingCount: this.responseHistory.length,
				olderThanMs
			});
		}
	}

	/**
	 * Get response statistics by endpoint
	 */
	getEndpointStats(endpoint: ApiEndpoint): StatusCodeStats[] {
		return this.statusCodeTracker.getEndpointStats(endpoint);
	}

	/**
	 * Get total number of tracked responses
	 */
	getHistorySize(): number {
		return this.responseHistory.length;
	}

	/**
	 * Reset all tracking data
	 */
	reset(): void {
		this.responseHistory = [];
		this.statusCodeTracker.reset();
		logger.info('API response monitor reset');
	}

	/**
	 * Get summary statistics
	 */
	getSummary(sinceMs?: number): {
		totalResponses: number;
		successResponses: number;
		errorResponses: number;
		averageDurationMs: number;
		endpointBreakdown: Record<string, number>;
	} {
		const responses = sinceMs ? this.getRecentResponses(sinceMs) : this.responseHistory;

		const successResponses = responses.filter(
			(r) => r.statusCode >= 200 && r.statusCode < 300
		).length;
		const errorResponses = responses.length - successResponses;

		const totalDuration = responses.reduce((sum, r) => sum + r.durationMs, 0);
		const averageDurationMs = responses.length > 0 ? totalDuration / responses.length : 0;

		const endpointBreakdown: Record<string, number> = {};
		for (const response of responses) {
			endpointBreakdown[response.endpoint] = (endpointBreakdown[response.endpoint] || 0) + 1;
		}

		return {
			totalResponses: responses.length,
			successResponses,
			errorResponses,
			averageDurationMs,
			endpointBreakdown
		};
	}
}
