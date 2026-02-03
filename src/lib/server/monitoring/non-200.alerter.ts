/**
 * Non-200 Response Alerter
 *
 * Monitors API responses and triggers alerts when non-200 status codes
 * are received. Integrates with the alert service for deduplication.
 */

import type { INon200Alerter, ApiResponseData, Non200AlertConfig } from './monitoring.types';
import { isNon200, formatEndpoint } from './monitoring.types';
import type { IAlertService } from '../alerts/index';
import { AlertType, AlertSeverity } from '../alerts/alert.types';
import { logger } from '../logger/index';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Non200AlertConfig = {
	enabled: true,
	deduplicationWindowMs: 5 * 60 * 1000, // 5 minutes
	includeResponseBody: true,
	maxResponseBodySize: 500, // 500 bytes
	ignoredStatusCodes: [] // Don't ignore any by default
};

/**
 * Non-200 alerter implementation
 */
export class Non200Alerter implements INon200Alerter {
	private config: Non200AlertConfig;
	private alertService: IAlertService;

	constructor(alertService: IAlertService, config: Partial<Non200AlertConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.alertService = alertService;

		logger.info('Non200Alerter initialized', {
			config: this.config
		});
	}

	/**
	 * Process a response and alert if non-200
	 */
	async processResponse(data: ApiResponseData): Promise<void> {
		// Skip if alerting is disabled
		if (!this.config.enabled) {
			return;
		}

		// Skip if status code is 2xx (success)
		if (!isNon200(data.statusCode)) {
			return;
		}

		// Skip if status code is in ignore list
		if (this.config.ignoredStatusCodes.includes(data.statusCode)) {
			logger.debug('Ignored non-200 status code', {
				statusCode: data.statusCode,
				endpoint: data.endpoint,
				shop: data.shop
			});
			return;
		}

		// Determine severity based on status code
		const severity = this.determineSeverity(data.statusCode);

		// Prepare response body for alert
		let responseBody: string | undefined;
		if (this.config.includeResponseBody && data.responseBody) {
			responseBody =
				data.responseBody.length > this.config.maxResponseBodySize
					? data.responseBody.substring(0, this.config.maxResponseBodySize) + '...'
					: data.responseBody;
		}

		// Send alert
		await this.alertService.sendAlert({
			type: AlertType.API_ERROR,
			severity,
			title: `API Error: ${data.statusCode}`,
			message: `API returned ${data.statusCode} for ${formatEndpoint(data.endpoint)}`,
			context: {
				endpoint: data.endpoint,
				shop: data.shop,
				statusCode: data.statusCode,
				statusCategory: data.statusCategory,
				durationMs: data.durationMs,
				requestId: data.requestId,
				errorMessage: data.errorMessage,
				responseBody,
				retryAttempt: data.retryAttempt,
				timestamp: data.timestamp.toISOString()
			}
		});

		logger.info('Non-200 alert sent', {
			endpoint: data.endpoint,
			shop: data.shop,
			statusCode: data.statusCode,
			severity,
			requestId: data.requestId
		});
	}

	/**
	 * Determine alert severity based on status code
	 */
	private determineSeverity(statusCode: number): AlertSeverity {
		// 5xx errors are critical (server errors)
		if (statusCode >= 500 && statusCode < 600) {
			return AlertSeverity.CRITICAL;
		}

		// 429 (rate limit) and 503 (service unavailable) are errors
		if (statusCode === 429 || statusCode === 503) {
			return AlertSeverity.ERROR;
		}

		// 4xx errors are warnings (client errors)
		if (statusCode >= 400 && statusCode < 500) {
			// 404 might be less severe in some cases
			if (statusCode === 404) {
				return AlertSeverity.WARN;
			}
			return AlertSeverity.ERROR;
		}

		// 3xx redirects are warnings
		if (statusCode >= 300 && statusCode < 400) {
			return AlertSeverity.WARN;
		}

		// Network errors (0) are critical
		if (statusCode === 0) {
			return AlertSeverity.CRITICAL;
		}

		// Unknown errors are warnings
		return AlertSeverity.WARN;
	}

	/**
	 * Update configuration at runtime
	 */
	updateConfig(config: Partial<Non200AlertConfig>): void {
		this.config = { ...this.config, ...config };
		logger.info('Non200Alerter configuration updated', {
			config: this.config
		});
	}

	/**
	 * Get current configuration
	 */
	getConfig(): Non200AlertConfig {
		return { ...this.config };
	}

	/**
	 * Enable or disable alerting
	 */
	setEnabled(enabled: boolean): void {
		this.config.enabled = enabled;
		logger.info(`Non200Alerter ${enabled ? 'enabled' : 'disabled'}`);
	}

	/**
	 * Add a status code to the ignore list
	 */
	addIgnoredStatusCode(statusCode: number): void {
		if (!this.config.ignoredStatusCodes.includes(statusCode)) {
			this.config.ignoredStatusCodes.push(statusCode);
			logger.info('Added status code to ignore list', { statusCode });
		}
	}

	/**
	 * Remove a status code from the ignore list
	 */
	removeIgnoredStatusCode(statusCode: number): void {
		const index = this.config.ignoredStatusCodes.indexOf(statusCode);
		if (index !== -1) {
			this.config.ignoredStatusCodes.splice(index, 1);
			logger.info('Removed status code from ignore list', { statusCode });
		}
	}
}
