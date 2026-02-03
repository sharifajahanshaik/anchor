/**
 * Monitoring Types
 *
 * Type definitions for API response monitoring system.
 * Tracks HTTP status codes, response times, and error patterns.
 */

/**
 * HTTP status code categories
 */
export enum StatusCodeCategory {
	SUCCESS = 'success', // 2xx
	REDIRECT = 'redirect', // 3xx
	CLIENT_ERROR = 'client_error', // 4xx
	SERVER_ERROR = 'server_error', // 5xx
	NETWORK_ERROR = 'network_error', // No response received
	UNKNOWN = 'unknown' // Other errors
}

/**
 * API endpoint identifiers
 */
export enum ApiEndpoint {
	CART_PAGE = 'cart_page', // GET /cart/{variantId}:{quantity}
	COLLECT = 'collect', // POST /api/collect
	PROPOSAL = 'proposal', // POST /checkouts/internal/graphql/persisted
	ACTIONS_JS = 'actions_js' // GET /actions.js
}

/**
 * Response tracking data
 */
export interface ApiResponseData {
	endpoint: ApiEndpoint;
	shop: string;
	statusCode: number;
	statusCategory: StatusCodeCategory;
	durationMs: number;
	requestId?: string;
	timestamp: Date;
	errorMessage?: string;
	responseBody?: string;
	retryAttempt?: number;
}

/**
 * Status code tracking statistics
 */
export interface StatusCodeStats {
	endpoint: ApiEndpoint;
	statusCode: number;
	count: number;
	lastSeen: Date;
	shops: Set<string>; // Track which shops are affected
}

/**
 * API response monitor configuration
 */
export interface ApiResponseMonitorConfig {
	/** Whether to alert on non-200 responses */
	alertOnNon200: boolean;
	/** Whether to track status codes in metrics */
	trackInMetrics: boolean;
	/** Maximum response body size to include in alerts (bytes) */
	maxResponseBodySize: number;
	/** Whether monitoring is enabled */
	enabled: boolean;
}

/**
 * Non-200 alert configuration
 */
export interface Non200AlertConfig {
	/** Whether alerts are enabled */
	enabled: boolean;
	/** Alert deduplication window (ms) */
	deduplicationWindowMs: number;
	/** Whether to include response body in alerts */
	includeResponseBody: boolean;
	/** Maximum response body size to include (bytes) */
	maxResponseBodySize: number;
	/** Status codes to ignore (e.g., 404 for expected missing resources) */
	ignoredStatusCodes: number[];
}

/**
 * API response monitor interface
 */
export interface IApiResponseMonitor {
	/**
	 * Track an API response
	 */
	trackResponse(data: ApiResponseData): void;

	/**
	 * Get statistics for a specific status code
	 */
	getStats(endpoint: ApiEndpoint, statusCode: number): StatusCodeStats | undefined;

	/**
	 * Get all non-200 responses in a time window
	 */
	getNon200Responses(sinceMs: number): ApiResponseData[];

	/**
	 * Clear old response data
	 */
	cleanup(olderThanMs: number): void;
}

/**
 * Status code tracker interface
 */
export interface IStatusCodeTracker {
	/**
	 * Track a status code occurrence
	 */
	track(endpoint: ApiEndpoint, statusCode: number, shop: string): void;

	/**
	 * Get stats for a specific status code
	 */
	getStats(endpoint: ApiEndpoint, statusCode: number): StatusCodeStats | undefined;

	/**
	 * Get all stats for an endpoint
	 */
	getEndpointStats(endpoint: ApiEndpoint): StatusCodeStats[];

	/**
	 * Reset all statistics
	 */
	reset(): void;
}

/**
 * Non-200 alerter interface
 */
export interface INon200Alerter {
	/**
	 * Process a response and alert if non-200
	 */
	processResponse(data: ApiResponseData): Promise<void>;
}

/**
 * Determine status code category from HTTP status code
 */
export function getStatusCodeCategory(statusCode: number): StatusCodeCategory {
	if (statusCode >= 200 && statusCode < 300) {
		return StatusCodeCategory.SUCCESS;
	}
	if (statusCode >= 300 && statusCode < 400) {
		return StatusCodeCategory.REDIRECT;
	}
	if (statusCode >= 400 && statusCode < 500) {
		return StatusCodeCategory.CLIENT_ERROR;
	}
	if (statusCode >= 500 && statusCode < 600) {
		return StatusCodeCategory.SERVER_ERROR;
	}
	if (statusCode === 0) {
		return StatusCodeCategory.NETWORK_ERROR;
	}
	return StatusCodeCategory.UNKNOWN;
}

/**
 * Format endpoint for display
 */
export function formatEndpoint(endpoint: ApiEndpoint): string {
	const endpointNames: Record<ApiEndpoint, string> = {
		[ApiEndpoint.CART_PAGE]: 'Cart Page',
		[ApiEndpoint.COLLECT]: 'Collect API',
		[ApiEndpoint.PROPOSAL]: 'Proposal GraphQL',
		[ApiEndpoint.ACTIONS_JS]: 'Actions.js'
	};
	return endpointNames[endpoint];
}

/**
 * Check if status code is non-2xx
 */
export function isNon200(statusCode: number): boolean {
	return statusCode < 200 || statusCode >= 300;
}
