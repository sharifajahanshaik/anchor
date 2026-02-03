/**
 * Alert Templates
 *
 * Defines formatting templates for different alert types.
 * Each template takes an Alert and returns formatted title, message, and Slack blocks.
 *
 * @module alerts/alert.templates
 */

import type { Alert, AlertTemplate, AlertType, SlackBlock } from './alert.types';
import { AlertType as AlertTypeEnum } from './alert.types';

/**
 * Default alert template
 */
const defaultTemplate: AlertTemplate = (alert: Alert) => {
	return {
		title: alert.title,
		message: alert.message,
		blocks: []
	};
};

/**
 * API error alert template
 */
const apiErrorTemplate: AlertTemplate = (alert: Alert) => {
	const { context } = alert;
	const endpoint = context?.endpoint || 'Unknown endpoint';
	const statusCode = context?.statusCode || 'Unknown';
	const shop = context?.shop || 'Unknown shop';

	const blocks: SlackBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '❌ API Request Failed'
			}
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Endpoint:* ${endpoint}\n*Status Code:* ${statusCode}\n*Shop:* ${shop}`
			}
		}
	];

	// Add error message if present
	if (alert.message) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Error:*\n${alert.message}`
			}
		});
	}

	// Add request ID if present
	if (context?.requestId) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Request ID:* \`${context.requestId}\``
			}
		});
	}

	// Add response body if present
	if (context?.responseBody) {
		const responsePreview =
			typeof context.responseBody === 'string'
				? context.responseBody.substring(0, 500)
				: JSON.stringify(context.responseBody, null, 2).substring(0, 500);

		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Response (preview):*\n\`\`\`${responsePreview}${responsePreview.length >= 500 ? '...' : ''}\`\`\``
			}
		});
	}

	return {
		title: 'API Request Failed',
		message: `API request to ${endpoint} failed with status ${statusCode}`,
		blocks
	};
};

/**
 * Abandonment failed alert template
 */
const abandonmentFailedTemplate: AlertTemplate = (alert: Alert) => {
	const { context } = alert;
	const shop = context?.shop || 'Unknown shop';
	const errorType = context?.errorType || 'Unknown error';

	const blocks: SlackBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '🚨 Abandoned Checkout Failed'
			}
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Shop URL:*\n${shop}`
			}
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Error Reason:*\n${alert.message}`
			}
		}
	];

	// Add error type
	if (errorType !== 'Unknown error') {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Error Type:*\n${errorType}`
			}
		});
	}

	// Add additional context
	const additionalData = Object.entries(context || {})
		.filter(([key]) => !['shop', 'errorType'].includes(key))
		.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
		.join('\n');

	if (additionalData) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Additional Data:*\n\`\`\`${additionalData}\`\`\``
			}
		});
	}

	return {
		title: 'Abandoned Checkout Creation Failed',
		message: `Failed to create abandoned checkout for ${shop}: ${alert.message}`,
		blocks
	};
};

/**
 * Queue issue alert template
 */
const queueIssueTemplate: AlertTemplate = (alert: Alert) => {
	const { context } = alert;
	const queueType = context?.queueType || 'main';
	const queueDepth = context?.queueDepth || 'Unknown';

	const blocks: SlackBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '⚠️ Queue Issue Detected'
			}
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Queue Type:* ${queueType}\n*Queue Depth:* ${queueDepth}`
			}
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Issue:*\n${alert.message}`
			}
		}
	];

	return {
		title: 'Queue Issue',
		message: `Queue ${queueType} issue: ${alert.message}`,
		blocks
	};
};

/**
 * System health alert template
 */
const systemHealthTemplate: AlertTemplate = (alert: Alert) => {
	const { context } = alert;

	const blocks: SlackBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '🏥 System Health Alert'
			}
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Issue:*\n${alert.message}`
			}
		}
	];

	// Add dependency info if present
	if (context?.dependency) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Affected Dependency:* ${context.dependency}`
			}
		});
	}

	return {
		title: 'System Health Issue',
		message: `System health issue: ${alert.message}`,
		blocks
	};
};

/**
 * Configuration error alert template
 */
const configErrorTemplate: AlertTemplate = (alert: Alert) => {
	const { context } = alert;

	const blocks: SlackBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '⚙️ Configuration Error'
			}
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Error:*\n${alert.message}`
			}
		}
	];

	// Add config key if present
	if (context?.configKey) {
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Configuration Key:* \`${context.configKey}\``
			}
		});
	}

	return {
		title: 'Configuration Error',
		message: `Configuration error: ${alert.message}`,
		blocks
	};
};

/**
 * Circuit breaker alert template
 */
const circuitBreakerTemplate: AlertTemplate = (alert: Alert) => {
	// The message is already formatted in circuit-breaker.alerter.ts
	// so we'll use it directly
	const blocks: SlackBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: alert.title
			}
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: alert.message
			}
		}
	];

	return {
		title: alert.title,
		message: alert.message,
		blocks
	};
};

/**
 * Generic error alert template
 */
const genericErrorTemplate: AlertTemplate = (alert: Alert) => {
	const blocks: SlackBlock[] = [
		{
			type: 'header',
			text: {
				type: 'plain_text',
				text: '⚠️ Error Occurred'
			}
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Error:*\n${alert.message}`
			}
		}
	];

	return {
		title: alert.title || 'Error',
		message: alert.message,
		blocks
	};
};

/**
 * Alert template registry
 */
const alertTemplates: Record<AlertType, AlertTemplate> = {
	[AlertTypeEnum.API_ERROR]: apiErrorTemplate,
	[AlertTypeEnum.ABANDONMENT_FAILED]: abandonmentFailedTemplate,
	[AlertTypeEnum.QUEUE_ISSUE]: queueIssueTemplate,
	[AlertTypeEnum.SYSTEM_HEALTH]: systemHealthTemplate,
	[AlertTypeEnum.CONFIG_ERROR]: configErrorTemplate,
	[AlertTypeEnum.CIRCUIT_BREAKER]: circuitBreakerTemplate,
	[AlertTypeEnum.GENERIC_ERROR]: genericErrorTemplate
};

/**
 * Get alert template for a given alert type
 */
export function getAlertTemplate(alertType: AlertType): AlertTemplate {
	return alertTemplates[alertType] || defaultTemplate;
}

/**
 * Register a custom alert template
 */
export function registerAlertTemplate(
	alertType: AlertType,
	template: AlertTemplate
): void {
	alertTemplates[alertType] = template;
}
