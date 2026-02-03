/**
 * Alert Service
 *
 * Main orchestration service for the alerting system.
 * Coordinates alert aggregation, deduplication, and notification delivery.
 *
 * @module alerts/alert.service
 */

import { getConfig } from '../config';
import { getLogger } from '../logger';
import { getMetricsService } from '../metrics';
import { MetricNames, LabelNames } from '../metrics/metrics.types';
import { createAlertAggregator } from './alert.aggregator';
import { createSlackNotifier } from './slack.notifier';
import type {
	Alert,
	AlertContext,
	AlertServiceConfig,
	DuplicateAlertEntry,
	IAlertAggregator,
	IAlertService,
	ISlackNotifier
} from './alert.types';
import { AlertSeverity, AlertType } from './alert.types';

// Logger for alert service
const logger = getLogger('alert-service');

// Metrics
const metrics = getMetricsService();
const alertsSentCounter = metrics.counter({
	name: MetricNames.ALERTS_SENT,
	description: 'Total alerts sent',
	unit: 'alerts'
});
const alertsSuppressedCounter = metrics.counter({
	name: 'alerts_suppressed_total',
	description: 'Total alerts suppressed due to deduplication',
	unit: 'alerts'
});

/**
 * Alert service implementation
 */
export class AlertService implements IAlertService {
	private config: AlertServiceConfig;
	private aggregator: IAlertAggregator;
	private slackNotifier: ISlackNotifier;

	constructor(config: AlertServiceConfig) {
		this.config = config;
		this.aggregator = createAlertAggregator(config.deduplication);
		this.slackNotifier = createSlackNotifier(config.slack);

		logger.info('Alert service initialized', {
			enabled: config.enabled,
			slackEnabled: config.slack.enabled,
			deduplicationWindowMs: config.deduplication.windowMs,
			maxAlertsPerWindow: config.deduplication.maxAlertsPerWindow
		});
	}

	/**
	 * Send an alert
	 */
	async sendAlert(alert: Alert): Promise<boolean> {
		if (!this.config.enabled) {
			logger.debug('Alert service disabled, skipping alert', {
				type: alert.type,
				severity: alert.severity
			});
			return false;
		}

		// Add timestamp if not present
		if (!alert.timestamp) {
			alert.timestamp = new Date();
		}

		logger.debug('Processing alert', {
			type: alert.type,
			severity: alert.severity,
			shop: alert.context?.shop
		});

		// Check if alert should be sent (not a duplicate)
		const shouldSend = this.aggregator.shouldSendAlert(alert);

		if (!shouldSend) {
			logger.info('Alert suppressed due to deduplication', {
				type: alert.type,
				severity: alert.severity,
				shop: alert.context?.shop
			});

			alertsSuppressedCounter.inc({
				[LabelNames.ALERT_TYPE]: alert.type,
				[LabelNames.SEVERITY]: alert.severity
			});

			// Still record it for deduplication tracking
			this.aggregator.recordAlert(alert);
			return false;
		}

		// Record the alert
		this.aggregator.recordAlert(alert);

		// Log the alert
		logger.warn('Sending alert', {
			type: alert.type,
			severity: alert.severity,
			title: alert.title,
			message: alert.message,
			...alert.context
		});

		// Send to Slack if enabled
		if (this.slackNotifier.isEnabled()) {
			try {
				await this.slackNotifier.sendAlert(alert);
				logger.info('Alert sent successfully', {
					type: alert.type,
					severity: alert.severity
				});

				alertsSentCounter.inc({
					[LabelNames.ALERT_TYPE]: alert.type,
					[LabelNames.SEVERITY]: alert.severity,
					[LabelNames.STATUS]: 'success'
				});

				return true;
			} catch (error) {
				logger.error('Failed to send alert', error as Error, {
					type: alert.type,
					severity: alert.severity
				});

				alertsSentCounter.inc({
					[LabelNames.ALERT_TYPE]: alert.type,
					[LabelNames.SEVERITY]: alert.severity,
					[LabelNames.STATUS]: 'failed'
				});

				return false;
			}
		} else {
			logger.debug('Slack notifier disabled, alert logged only');
			return true;
		}
	}

	/**
	 * Create and send an API error alert
	 */
	async sendApiErrorAlert(
		endpoint: string,
		statusCode: number,
		shop: string,
		context?: AlertContext
	): Promise<boolean> {
		const alert: Alert = {
			type: AlertType.API_ERROR,
			severity: this.getApiErrorSeverity(statusCode),
			title: 'API Request Failed',
			message: `API request to ${endpoint} failed with status ${statusCode}`,
			context: {
				endpoint,
				statusCode,
				shop,
				...context
			}
		};

		return this.sendAlert(alert);
	}

	/**
	 * Create and send an abandonment failure alert
	 */
	async sendAbandonmentFailedAlert(
		shop: string,
		errorReason: string,
		context?: AlertContext
	): Promise<boolean> {
		const alert: Alert = {
			type: AlertType.ABANDONMENT_FAILED,
			severity: AlertSeverity.ERROR,
			title: 'Abandoned Checkout Creation Failed',
			message: errorReason,
			context: {
				shop,
				...context
			}
		};

		return this.sendAlert(alert);
	}

	/**
	 * Check if alert service is enabled
	 */
	isEnabled(): boolean {
		return this.config.enabled;
	}

	/**
	 * Get deduplication statistics
	 */
	getDeduplicationStats(): Map<string, DuplicateAlertEntry> {
		return this.aggregator.getStats();
	}

	/**
	 * Determine severity level for API errors based on status code
	 */
	private getApiErrorSeverity(statusCode: number): AlertSeverity {
		if (statusCode >= 500) {
			return AlertSeverity.CRITICAL;
		} else if (statusCode >= 400) {
			return AlertSeverity.ERROR;
		} else {
			return AlertSeverity.WARN;
		}
	}
}

/**
 * Create alert service configuration from app config
 */
function createAlertServiceConfig(): AlertServiceConfig {
	const config = getConfig();

	return {
		enabled: config.telemetry.enabled,
		deduplication: {
			// 5 minutes deduplication window
			windowMs: 5 * 60 * 1000,
			// Maximum 1 alert per shop/endpoint/error within the window
			maxAlertsPerWindow: 1
		},
		slack: {
			webhookUrl: config.externalServices.slackWebhookUrl || '',
			defaultMentionUsers: ['U06BPLC172N', 'U0403DP9FJ6'],
			enabled: !!config.externalServices.slackWebhookUrl
		}
	};
}

// Singleton instance
let alertServiceInstance: IAlertService | null = null;

/**
 * Get the alert service singleton instance
 *
 * @returns IAlertService instance
 *
 * @example
 * ```typescript
 * import { getAlertService } from '$lib/server/alerts';
 *
 * const alertService = getAlertService();
 *
 * // Send an API error alert
 * await alertService.sendApiErrorAlert(
 *   'https://shop.example.com/cart/add',
 *   500,
 *   'shop.example.com',
 *   { requestId: '123', responseBody: '...' }
 * );
 *
 * // Send an abandonment failure alert
 * await alertService.sendAbandonmentFailedAlert(
 *   'shop.example.com',
 *   'Failed to extract session token',
 *   { batchId: 'batch-123' }
 * );
 *
 * // Send a custom alert
 * await alertService.sendAlert({
 *   type: AlertType.QUEUE_ISSUE,
 *   severity: AlertSeverity.WARN,
 *   title: 'Queue Backing Up',
 *   message: 'Main queue depth exceeds 1000 items',
 *   context: { queueDepth: 1234, queueType: 'main' }
 * });
 * ```
 */
export function getAlertService(): IAlertService {
	if (!alertServiceInstance) {
		const config = createAlertServiceConfig();
		alertServiceInstance = new AlertService(config);
	}
	return alertServiceInstance;
}

/**
 * Reset the alert service instance (for testing)
 * @internal
 */
export function resetAlertService(): void {
	alertServiceInstance = null;
}
