/**
 * Slack Notifier
 *
 * Sends alerts to Slack via webhook.
 * Formats alerts using templates and handles Slack API communication.
 *
 * @module alerts/slack.notifier
 */

import { getLogger } from '../logger';
import { getMetricsService } from '../metrics';
import { MetricNames, LabelNames } from '../metrics/metrics.types';
import type { Alert, ISlackNotifier, SlackConfig, SlackPayload } from './alert.types';
import { getAlertTemplate } from './alert.templates';

// Logger for Slack notifier
const logger = getLogger('slack-notifier');

// Metrics
const metrics = getMetricsService();
const slackAlertCounter = metrics.counter({
	name: MetricNames.ALERTS_SENT,
	description: 'Total alerts sent to Slack',
	unit: 'alerts'
});

/**
 * Slack notifier implementation
 */
export class SlackNotifier implements ISlackNotifier {
	private config: SlackConfig;

	constructor(config: SlackConfig) {
		this.config = config;

		if (this.config.enabled && !this.config.webhookUrl) {
			logger.warn('Slack notifier enabled but webhook URL not configured');
		}

		logger.debug('Slack notifier initialized', {
			enabled: config.enabled,
			hasWebhookUrl: !!config.webhookUrl,
			defaultMentionUsers: config.defaultMentionUsers?.length || 0
		});
	}

	/**
	 * Send an alert to Slack
	 */
	async sendAlert(alert: Alert): Promise<Response> {
		if (!this.config.enabled) {
			logger.debug('Slack notifier disabled, skipping alert');
			throw new Error('Slack notifier is disabled');
		}

		if (!this.config.webhookUrl) {
			logger.error('Slack webhook URL not configured');
			throw new Error('Slack webhook URL is not configured');
		}

		try {
			// Get template for this alert
			const template = getAlertTemplate(alert.type);
			const formatted = template(alert);

			// Build Slack payload
			const payload = this.buildPayload(alert, formatted.title, formatted.blocks);

			// Send to Slack
			logger.debug('Sending alert to Slack', {
				type: alert.type,
				severity: alert.severity,
				shop: alert.context?.shop
			});

			const response = await fetch(this.config.webhookUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload)
			});

			if (!response.ok) {
				logger.error('Slack webhook request failed', undefined, {
					status: response.status,
					statusText: response.statusText,
					type: alert.type,
					severity: alert.severity
				});

				slackAlertCounter.inc({
					[LabelNames.ALERT_TYPE]: alert.type,
					[LabelNames.SEVERITY]: alert.severity,
					[LabelNames.STATUS]: 'failed'
				});

				return response;
			}

			logger.info('Alert sent to Slack successfully', {
				type: alert.type,
				severity: alert.severity,
				shop: alert.context?.shop
			});

			slackAlertCounter.inc({
				[LabelNames.ALERT_TYPE]: alert.type,
				[LabelNames.SEVERITY]: alert.severity,
				[LabelNames.STATUS]: 'success'
			});

			return response;
		} catch (error) {
			logger.error('Failed to send Slack alert', error as Error, {
				type: alert.type,
				severity: alert.severity,
				shop: alert.context?.shop
			});

			slackAlertCounter.inc({
				[LabelNames.ALERT_TYPE]: alert.type,
				[LabelNames.SEVERITY]: alert.severity,
				[LabelNames.STATUS]: 'error'
			});

			throw error;
		}
	}

	/**
	 * Check if Slack notifications are enabled
	 */
	isEnabled(): boolean {
		return this.config.enabled && !!this.config.webhookUrl;
	}

	/**
	 * Build Slack payload from alert
	 */
	private buildPayload(alert: Alert, title: string, blocks?: any[]): SlackPayload {
		const testIndicator = alert.isTest ? ' | TEST' : '';
		const fullTitle = `${title}${testIndicator}`;

		// Get users to mention
		const mentionUsers =
			alert.mentionUsers || this.config.defaultMentionUsers || [];
		const userMentions = mentionUsers.map((id) => `<@${id}>`).join(' ');

		// Use provided blocks if available, otherwise create default blocks
		const messageBlocks = blocks || this.createDefaultBlocks(alert);

		// Add user mentions at the end if we have any
		if (userMentions) {
			messageBlocks.push({
				type: 'divider'
			});
			messageBlocks.push({
				type: 'context',
				elements: [
					{
						type: 'mrkdwn',
						text: `Please investigate the issue. ${userMentions}`
					}
				]
			});
		}

		return {
			text: fullTitle,
			blocks: messageBlocks
		};
	}

	/**
	 * Create default Slack blocks for an alert
	 */
	private createDefaultBlocks(alert: Alert): any[] {
		const severityEmoji = this.getSeverityEmoji(alert.severity);
		const testIndicator = alert.isTest ? ' | TEST' : '';

		const blocks: any[] = [
			{
				type: 'header',
				text: {
					type: 'plain_text',
					text: `${severityEmoji} ${alert.title}${testIndicator}`
				}
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `*Message:*\n${alert.message}`
				}
			}
		];

		// Add context fields if present
		if (alert.context && Object.keys(alert.context).length > 0) {
			const contextFields: string[] = [];

			if (alert.context.shop) {
				contextFields.push(`*Shop:*\n${alert.context.shop}`);
			}
			if (alert.context.endpoint) {
				contextFields.push(`*Endpoint:*\n${alert.context.endpoint}`);
			}
			if (alert.context.statusCode) {
				contextFields.push(`*Status Code:*\n${alert.context.statusCode}`);
			}
			if (alert.context.errorType) {
				contextFields.push(`*Error Type:*\n${alert.context.errorType}`);
			}
			if (alert.context.requestId) {
				contextFields.push(`*Request ID:*\n${alert.context.requestId}`);
			}

			// Add other context as a code block
			const otherContext = Object.entries(alert.context)
				.filter(
					([key]) =>
						!['shop', 'endpoint', 'statusCode', 'errorType', 'requestId'].includes(
							key
						)
				)
				.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
				.join('\n');

			if (contextFields.length > 0) {
				blocks.push({
					type: 'section',
					fields: contextFields.map((text) => ({
						type: 'mrkdwn',
						text
					}))
				});
			}

			if (otherContext) {
				blocks.push({
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: `*Additional Context:*\n\`\`\`${otherContext}\`\`\``
					}
				});
			}
		}

		return blocks;
	}

	/**
	 * Get emoji for alert severity
	 */
	private getSeverityEmoji(severity: string): string {
		switch (severity) {
			case 'CRITICAL':
				return '🚨';
			case 'ERROR':
				return '❌';
			case 'WARN':
				return '⚠️';
			case 'INFO':
				return 'ℹ️';
			default:
				return '📢';
		}
	}
}

/**
 * Create a new Slack notifier instance
 */
export function createSlackNotifier(config: SlackConfig): ISlackNotifier {
	return new SlackNotifier(config);
}
