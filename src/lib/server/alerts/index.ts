/**
 * Alerts Module
 *
 * Comprehensive alerting system with deduplication and Slack integration.
 *
 * @module alerts
 *
 * @example
 * ```typescript
 * import { getAlertService, AlertType, AlertSeverity } from '$lib/server/alerts';
 *
 * const alertService = getAlertService();
 *
 * // Send an API error alert
 * await alertService.sendApiErrorAlert(
 *   'https://shop.example.com/cart/add',
 *   500,
 *   'shop.example.com'
 * );
 *
 * // Send a custom alert
 * await alertService.sendAlert({
 *   type: AlertType.QUEUE_ISSUE,
 *   severity: AlertSeverity.WARN,
 *   title: 'Queue Backing Up',
 *   message: 'Main queue depth exceeds 1000 items'
 * });
 * ```
 */

// Export main service
export { getAlertService, resetAlertService } from './alert.service';

// Export types and enums
export {
	AlertSeverity,
	AlertType,
	type Alert,
	type AlertContext,
	type AlertKey,
	type AlertServiceConfig,
	type AlertTemplate,
	type DeduplicationConfig,
	type DuplicateAlertEntry,
	type IAlertAggregator,
	type IAlertService,
	type ISlackNotifier,
	type SlackBlock,
	type SlackConfig,
	type SlackPayload
} from './alert.types';

// Export template utilities
export { getAlertTemplate, registerAlertTemplate } from './alert.templates';

// Export component factories (for custom configurations)
export { createAlertAggregator } from './alert.aggregator';
export { createSlackNotifier } from './slack.notifier';
