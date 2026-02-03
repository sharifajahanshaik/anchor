/**
 * Application-wide constants
 *
 * This module contains all magic numbers, feature flags, and other
 * constants used throughout the application.
 */

/**
 * Batch processing constants
 */
export const BATCH_CONFIG = {
	/**
	 * Maximum number of abandonments to process in a single batch
	 */
	MAX_BATCH_SIZE: 50,

	/**
	 * Maximum number of retry attempts for failed abandonments
	 */
	MAX_RETRY_ATTEMPTS: 3,

	/**
	 * Delay between batch processing (milliseconds)
	 */
	BATCH_DELAY_MS: 1000,

	/**
	 * Timeout for batch processing (milliseconds)
	 */
	BATCH_TIMEOUT_MS: 120000
} as const;

/**
 * HTTP request constants
 */
export const HTTP_CONFIG = {
	/**
	 * Default request timeout (milliseconds)
	 */
	DEFAULT_TIMEOUT_MS: 30000,

	/**
	 * Cart page fetch timeout (milliseconds)
	 */
	CART_FETCH_TIMEOUT_MS: 15000,

	/**
	 * Proposal request timeout (milliseconds)
	 */
	PROPOSAL_REQUEST_TIMEOUT_MS: 30000,

	/**
	 * Actions.js fetch timeout (milliseconds)
	 */
	ACTIONS_JS_TIMEOUT_MS: 10000,

	/**
	 * Collect API timeout (milliseconds)
	 */
	COLLECT_TIMEOUT_MS: 5000,

	/**
	 * Maximum number of redirects to follow
	 */
	MAX_REDIRECTS: 5
} as const;

/**
 * Progressive feature flags for /api/collect calls
 * These are sent in sequence across multiple calls
 */
export const PROGRESSIVE_FEATURE_FLAGS = [
	// Step 1: Initial flags
	[
		'stock_problems',
		'suggestions',
		'shopify.customer_privacy_api',
		'shopify.consent_tracking_api',
		'shopify.identity.customer_accounts',
		'customer_account_required',
		'shop_pay_installments_iframe_with_csrf'
	],
	// Step 2: Additional context flags
	[
		'shopify.customer_privacy_api',
		'shopify.consent_tracking_api',
		'shopify.identity.customer_accounts',
		'customer_account_required',
		'shop_pay_installments_iframe_with_csrf'
	],
	// Step 3: More progressive flags
	[
		'shopify.customer_privacy_api',
		'shopify.consent_tracking_api',
		'shopify.identity.customer_accounts',
		'customer_account_required',
		'shop_pay_installments_iframe_with_csrf'
	],
	// Step 4: Expanded flags
	[
		'shopify.customer_privacy_api',
		'shopify.consent_tracking_api',
		'shopify.identity.customer_accounts',
		'customer_account_required',
		'shop_pay_installments_iframe_with_csrf'
	],
	// Step 5: Final flags
	[
		'shopify.customer_privacy_api',
		'shopify.consent_tracking_api',
		'shopify.identity.customer_accounts',
		'customer_account_required',
		'shop_pay_installments_iframe_with_csrf'
	]
] as const;

/**
 * Number of progressive /api/collect calls to make
 */
export const PROGRESSIVE_COLLECT_STEPS = 5;

/**
 * Delay between progressive collect calls (milliseconds)
 */
export const PROGRESSIVE_COLLECT_DELAY_MS = 500;

/**
 * Shopify checkout constants
 */
export const SHOPIFY_CONFIG = {
	/**
	 * Default currency code
	 */
	DEFAULT_CURRENCY: 'INR',

	/**
	 * Default country code
	 */
	DEFAULT_COUNTRY_CODE: 'IN',

	/**
	 * Default phone country code
	 */
	DEFAULT_PHONE_COUNTRY_CODE: 'IN'
} as const;

/**
 * Zone code mappings for Indian states
 */
export const ZONE_MAPPINGS = {
	// Format: [State Name]: Zone Code
	'Andaman and Nicobar Islands': 'AN',
	'Andhra Pradesh': 'AP',
	'Arunachal Pradesh': 'AR',
	'Assam': 'AS',
	'Bihar': 'BR',
	'Chandigarh': 'CH',
	'Chhattisgarh': 'CT',
	'Dadra and Nagar Haveli and Daman and Diu': 'DH',
	'Delhi': 'DL',
	'Goa': 'GA',
	'Gujarat': 'GJ',
	'Haryana': 'HR',
	'Himachal Pradesh': 'HP',
	'Jammu and Kashmir': 'JK',
	'Jharkhand': 'JH',
	'Karnataka': 'KA',
	'Kerala': 'KL',
	'Ladakh': 'LA',
	'Lakshadweep': 'LD',
	'Madhya Pradesh': 'MP',
	'Maharashtra': 'MH',
	'Manipur': 'MN',
	'Meghalaya': 'ML',
	'Mizoram': 'MZ',
	'Nagaland': 'NL',
	'Odisha': 'OR',
	'Puducherry': 'PY',
	'Punjab': 'PB',
	'Rajasthan': 'RJ',
	'Sikkim': 'SK',
	'Tamil Nadu': 'TN',
	'Telangana': 'TG',
	'Tripura': 'TR',
	'Uttar Pradesh': 'UP',
	'Uttarakhand': 'UT',
	'West Bengal': 'WB'
} as const;

/**
 * Monitoring and observability constants
 */
export const MONITORING_CONFIG = {
	/**
	 * Time window for response history (milliseconds)
	 */
	RESPONSE_HISTORY_WINDOW_MS: 3600000, // 1 hour

	/**
	 * Alert deduplication window (milliseconds)
	 */
	ALERT_DEDUPLICATION_WINDOW_MS: 300000, // 5 minutes

	/**
	 * Health check timeout (milliseconds)
	 */
	HEALTH_CHECK_TIMEOUT_MS: 5000,

	/**
	 * Maximum response body size to include in alerts (bytes)
	 */
	MAX_ALERT_RESPONSE_BODY_SIZE: 1000
} as const;

/**
 * Data masking constants
 */
export const MASKING_CONFIG = {
	/**
	 * Fields to mask in logs
	 */
	SENSITIVE_FIELDS: [
		'email',
		'phone',
		'address',
		'postalCode',
		'firstName',
		'lastName',
		'sessionToken',
		'queueToken',
		'cartToken'
	] as const,

	/**
	 * Characters to show at start of masked value
	 */
	MASK_PREFIX_LENGTH: 2,

	/**
	 * Characters to show at end of masked value
	 */
	MASK_SUFFIX_LENGTH: 2,

	/**
	 * Mask character
	 */
	MASK_CHARACTER: '*'
} as const;

/**
 * Queue management constants
 */
export const QUEUE_CONFIG = {
	/**
	 * Maximum queue size before rejecting new items
	 */
	MAX_QUEUE_SIZE: 10000,

	/**
	 * Maximum retry queue size
	 */
	MAX_RETRY_QUEUE_SIZE: 5000,

	/**
	 * Queue processing interval (milliseconds)
	 */
	QUEUE_PROCESS_INTERVAL_MS: 100
} as const;

/**
 * API endpoint paths
 */
export const API_ENDPOINTS = {
	ABANDON: '/api/abandon',
	HEALTH: '/api/health',
	SHOPIFY_CART: '/cart',
	SHOPIFY_COLLECT: '/api/collect',
	SHOPIFY_PROPOSAL: '/checkouts/internal/graphql/persisted',
	SHOPIFY_ACTIONS_JS: '/actions.js'
} as const;

/**
 * HTTP status codes
 */
export const HTTP_STATUS = {
	OK: 200,
	CREATED: 201,
	NO_CONTENT: 204,
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	TIMEOUT: 408,
	TOO_MANY_REQUESTS: 429,
	INTERNAL_SERVER_ERROR: 500,
	BAD_GATEWAY: 502,
	SERVICE_UNAVAILABLE: 503,
	GATEWAY_TIMEOUT: 504
} as const;

/**
 * Log event types
 */
export const LOG_EVENTS = {
	ABANDONMENT_RECEIVED: 'abandonment_received',
	ABANDONMENT_PROCESSING: 'abandonment_processing',
	ABANDONMENT_SUCCESS: 'abandonment_success',
	ABANDONMENT_FAILED: 'abandonment_failed',
	BATCH_STARTED: 'batch_started',
	BATCH_COMPLETED: 'batch_completed',
	RETRY_SCHEDULED: 'retry_scheduled',
	API_REQUEST: 'api_request',
	API_RESPONSE: 'api_response',
	HEALTH_CHECK: 'health_check'
} as const;
