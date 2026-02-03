/**
 * Alert Types
 *
 * Defines types and interfaces for the alerting system.
 * Supports severity levels, alert deduplication, and multiple notification channels.
 *
 * @module alerts/alert.types
 */

/**
 * Alert severity levels
 */
export enum AlertSeverity {
	/** Informational alerts - no action required */
	INFO = 'INFO',
	/** Warning alerts - attention recommended */
	WARN = 'WARN',
	/** Error alerts - action required */
	ERROR = 'ERROR',
	/** Critical alerts - immediate action required */
	CRITICAL = 'CRITICAL'
}

/**
 * Alert types/categories
 */
export enum AlertType {
	/** API-related alerts (non-200 responses, timeouts, etc.) */
	API_ERROR = 'API_ERROR',
	/** Abandonment processing failures */
	ABANDONMENT_FAILED = 'ABANDONMENT_FAILED',
	/** Queue-related issues (backing up, full, etc.) */
	QUEUE_ISSUE = 'QUEUE_ISSUE',
	/** System health issues (dependencies down, resource limits) */
	SYSTEM_HEALTH = 'SYSTEM_HEALTH',
	/** Configuration issues */
	CONFIG_ERROR = 'CONFIG_ERROR',
	/** Circuit breaker state changes */
	CIRCUIT_BREAKER = 'CIRCUIT_BREAKER',
	/** Generic error catch-all */
	GENERIC_ERROR = 'GENERIC_ERROR'
}

/**
 * Alert context - additional metadata about the alert
 */
export interface AlertContext {
	/** Shop URL associated with the alert */
	shop?: string;
	/** API endpoint involved */
	endpoint?: string;
	/** HTTP status code (for API errors) */
	statusCode?: number;
	/** Request ID for tracing */
	requestId?: string;
	/** Error type/category */
	errorType?: string;
	/** Batch ID (for batch processing alerts) */
	batchId?: string;
	/** Queue type (main, retry) */
	queueType?: string;
	/** Any additional data */
	[key: string]: unknown;
}

/**
 * Alert configuration
 */
export interface Alert {
	/** Alert type/category */
	type: AlertType;
	/** Alert severity */
	severity: AlertSeverity;
	/** Alert title/summary */
	title: string;
	/** Alert message/description */
	message: string;
	/** Additional context/metadata */
	context?: AlertContext;
	/** Timestamp when alert was created */
	timestamp?: Date;
	/** User IDs to mention in Slack */
	mentionUsers?: string[];
	/** Whether this is a test alert */
	isTest?: boolean;
}

/**
 * Alert deduplication configuration
 */
export interface DeduplicationConfig {
	/** Time window for deduplication (in milliseconds) */
	windowMs: number;
	/** Maximum number of similar alerts within the window */
	maxAlertsPerWindow: number;
}

/**
 * Alert key for deduplication
 * Alerts with the same key within the deduplication window are considered duplicates
 */
export interface AlertKey {
	/** Alert type */
	type: AlertType;
	/** Alert severity */
	severity: AlertSeverity;
	/** Shop (if applicable) */
	shop?: string;
	/** Endpoint (if applicable) */
	endpoint?: string;
	/** Error type (if applicable) */
	errorType?: string;
}

/**
 * Deduplicated alert entry
 */
export interface DuplicateAlertEntry {
	/** When the first alert with this key was seen */
	firstSeen: Date;
	/** When the last alert with this key was seen */
	lastSeen: Date;
	/** Number of times this alert has occurred */
	count: number;
	/** The original alert */
	alert: Alert;
}

/**
 * Slack notification configuration
 */
export interface SlackConfig {
	/** Slack webhook URL */
	webhookUrl: string;
	/** Default users to mention */
	defaultMentionUsers?: string[];
	/** Whether to send alerts to Slack */
	enabled: boolean;
}

/**
 * Alert service configuration
 */
export interface AlertServiceConfig {
	/** Deduplication configuration */
	deduplication: DeduplicationConfig;
	/** Slack configuration */
	slack: SlackConfig;
	/** Whether the alert service is enabled */
	enabled: boolean;
}

/**
 * Alert template function
 * Takes an alert and returns formatted title and message
 */
export type AlertTemplate = (alert: Alert) => {
	title: string;
	message: string;
	blocks?: SlackBlock[];
};

/**
 * Slack block (simplified)
 */
export interface SlackBlock {
	type: string;
	text?: {
		type: string;
		text: string;
	};
	elements?: Array<{
		type: string;
		text: string;
	}>;
}

/**
 * Slack payload
 */
export interface SlackPayload {
	text: string;
	blocks: SlackBlock[];
}

/**
 * Alert aggregator interface
 */
export interface IAlertAggregator {
	/**
	 * Check if an alert should be sent (not a duplicate)
	 * @param alert - The alert to check
	 * @returns true if alert should be sent, false if it's a duplicate
	 */
	shouldSendAlert(alert: Alert): boolean;

	/**
	 * Record an alert (for deduplication tracking)
	 * @param alert - The alert to record
	 */
	recordAlert(alert: Alert): void;

	/**
	 * Get statistics about deduplicated alerts
	 * @returns Map of alert keys to duplicate entries
	 */
	getStats(): Map<string, DuplicateAlertEntry>;

	/**
	 * Clear all deduplication state
	 */
	clear(): void;
}

/**
 * Slack notifier interface
 */
export interface ISlackNotifier {
	/**
	 * Send an alert to Slack
	 * @param alert - The alert to send
	 * @returns Promise resolving to the Slack API response
	 */
	sendAlert(alert: Alert): Promise<Response>;

	/**
	 * Check if Slack notifications are enabled
	 * @returns true if enabled, false otherwise
	 */
	isEnabled(): boolean;
}

/**
 * Alert service interface
 */
export interface IAlertService {
	/**
	 * Send an alert
	 * If deduplication is enabled, may suppress duplicate alerts
	 * @param alert - The alert to send
	 * @returns Promise resolving to true if alert was sent, false if suppressed
	 */
	sendAlert(alert: Alert): Promise<boolean>;

	/**
	 * Create and send an API error alert
	 * @param endpoint - API endpoint that failed
	 * @param statusCode - HTTP status code
	 * @param shop - Shop URL
	 * @param context - Additional context
	 * @returns Promise resolving to true if alert was sent
	 */
	sendApiErrorAlert(
		endpoint: string,
		statusCode: number,
		shop: string,
		context?: AlertContext
	): Promise<boolean>;

	/**
	 * Create and send an abandonment failure alert
	 * @param shop - Shop URL
	 * @param errorReason - Reason for failure
	 * @param context - Additional context
	 * @returns Promise resolving to true if alert was sent
	 */
	sendAbandonmentFailedAlert(
		shop: string,
		errorReason: string,
		context?: AlertContext
	): Promise<boolean>;

	/**
	 * Check if alert service is enabled
	 * @returns true if enabled, false otherwise
	 */
	isEnabled(): boolean;

	/**
	 * Get deduplication statistics
	 * @returns Map of alert keys to duplicate entries
	 */
	getDeduplicationStats(): Map<string, DuplicateAlertEntry>;
}
