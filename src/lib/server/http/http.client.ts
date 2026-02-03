/**
 * HTTP Client
 *
 * Centralized HTTP client wrapper that provides:
 * - Automatic status code validation
 * - Automatic metrics collection
 * - Automatic alerting for non-200 responses
 * - Cookie management integration
 * - User agent injection
 * - Timeout handling
 * - Error classification
 *
 * @module http/http.client
 */

import fetch from 'node-fetch';
import type { RequestInit, Response, RequestInfo } from 'node-fetch';
import { getLogger } from '../logger';
import { getMetricsService } from '../metrics';
import { MetricNames, LabelNames } from '../metrics/metrics.types';
import { getAlertService } from '../alerts';
import { AlertSeverity, AlertType } from '../alerts/alert.types';
import {
	NetworkError,
	ConfigurationError,
	type BaseError
} from '$lib/types/error.types';
import { HTTP_CONFIG, HTTP_STATUS } from '../config/constants';
import { getCookieManager } from '../cookies';
import { ApiResponseMonitor } from '../monitoring/api-response.monitor';
import { StatusCodeTracker } from '../monitoring/status-code.tracker';
import { StatusCodeCategory } from '../monitoring/monitoring.types';
import { circuitBreaker } from '../resilience/circuit-breaker';
import { rateLimiter } from '../resilience/rate-limiter';

const logger = getLogger('http-client');
const metrics = getMetricsService();

// Monitoring - singleton instance
let monitorInstance: ApiResponseMonitor | null = null;

/**
 * Get or create API response monitor instance
 */
function getMonitor(): ApiResponseMonitor {
	if (!monitorInstance) {
		monitorInstance = new ApiResponseMonitor(
			metrics,
			new StatusCodeTracker(metrics),
			{ enabled: true }
		);
		logger.info('API response monitor initialized');
	}
	return monitorInstance;
}

/**
 * Export monitor instance for use in summary reporter
 * @internal
 */
export function getApiResponseMonitor(): ApiResponseMonitor {
	return getMonitor();
}

// Metrics
const httpRequestsCounter = metrics.counter({
	name: MetricNames.API_REQUESTS,
	description: 'Total HTTP requests',
	unit: 'requests'
});

const httpDurationHistogram = metrics.histogram({
	name: MetricNames.API_REQUEST_DURATION,
	description: 'HTTP request duration',
	unit: 'seconds'
});

const httpErrorsCounter = metrics.counter({
	name: MetricNames.API_REQUESTS_NON_200,
	description: 'Total HTTP errors',
	unit: 'errors'
});

/**
 * HTTP request options
 */
export interface HttpRequestOptions extends Omit<RequestInit, 'signal'> {
	/**
	 * Request timeout in milliseconds
	 * @default HTTP_CONFIG.DEFAULT_TIMEOUT_MS (30000)
	 */
	timeout?: number;

	/**
	 * Custom cookies to send with request (manual mode)
	 * Note: If useCookieJar is true, this will be ignored
	 */
	cookies?: Record<string, string>;

	/**
	 * Use cookie jar for automatic cookie management
	 * Requires 'shop' to be specified in context
	 * @default false
	 */
	useCookieJar?: boolean;

	/**
	 * Custom user agent to use
	 * If not provided, a default user agent will be used
	 */
	userAgent?: string;

	/**
	 * Whether to throw on non-2xx status codes
	 * @default true
	 */
	throwOnError?: boolean;

	/**
	 * Whether to send alerts for non-2xx responses
	 * @default true
	 */
	alertOnError?: boolean;

	/**
	 * Additional context for metrics and alerts
	 */
	context?: {
		/**
		 * Shop domain (e.g., 'myshop.myshopify.com')
		 * Required if useCookieJar is true
		 */
		shop?: string;
		/**
		 * Cookie jar key for request-specific cookie isolation
		 * Format: 'shop:requestId' (e.g., 'myshop.myshopify.com:req_abc123')
		 * If not provided, falls back to shop domain
		 */
		cookieJarKey?: string;
		endpoint?: string;
		operation?: string;
		[key: string]: any;
	};
}

/**
 * HTTP response wrapper
 */
export interface HttpResponse<T = any> {
	/**
	 * Response status code
	 */
	status: number;

	/**
	 * Response status text
	 */
	statusText: string;

	/**
	 * Response headers
	 */
	headers: Record<string, string>;

	/**
	 * Parsed response body
	 */
	data: T;

	/**
	 * Raw response (for accessing other methods)
	 */
	raw: Response;

	/**
	 * Request duration in milliseconds
	 */
	duration: number;
}

/**
 * Default user agent
 */
const DEFAULT_USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * HTTP Client class
 */
export class HttpClient {
	private defaultTimeout: number;
	private defaultHeaders: Record<string, string>;

	constructor(options?: {
		defaultTimeout?: number;
		defaultHeaders?: Record<string, string>;
	}) {
		this.defaultTimeout = options?.defaultTimeout || HTTP_CONFIG.DEFAULT_TIMEOUT_MS;
		this.defaultHeaders = options?.defaultHeaders || {};
	}

	/**
	 * Perform GET request
	 */
	async get<T = any>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
		return this.request<T>(url, {
			...options,
			method: 'GET'
		});
	}

	/**
	 * Perform POST request
	 */
	async post<T = any>(
		url: string,
		body?: any,
		options?: HttpRequestOptions
	): Promise<HttpResponse<T>> {
		return this.request<T>(url, {
			...options,
			method: 'POST',
			body: body ? JSON.stringify(body) : undefined,
			headers: {
				'Content-Type': 'application/json',
				...options?.headers
			}
		});
	}

	/**
	 * Perform PUT request
	 */
	async put<T = any>(
		url: string,
		body?: any,
		options?: HttpRequestOptions
	): Promise<HttpResponse<T>> {
		return this.request<T>(url, {
			...options,
			method: 'PUT',
			body: body ? JSON.stringify(body) : undefined,
			headers: {
				'Content-Type': 'application/json',
				...options?.headers
			}
		});
	}

	/**
	 * Perform DELETE request
	 */
	async delete<T = any>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
		return this.request<T>(url, {
			...options,
			method: 'DELETE'
		});
	}

	/**
	 * Perform generic HTTP request
	 */
	async request<T = any>(
		url: string,
		options: HttpRequestOptions = {}
	): Promise<HttpResponse<T>> {
		const startTime = Date.now();
		const method = options.method || 'GET';
		const timeout = options.timeout ?? this.defaultTimeout;
		const throwOnError = options.throwOnError ?? true;
		const alertOnError = options.alertOnError ?? true;
		const context = options.context || {};
		const useCookieJar = options.useCookieJar ?? false;

		// Validate URL
		if (!url) {
			throw new ConfigurationError('URL is required for HTTP request', { url });
		}

		// Validate cookie jar requirements
		if (useCookieJar && !context.shop) {
			throw new ConfigurationError(
				'Shop domain is required in context when useCookieJar is true',
				{ url, useCookieJar, context }
			);
		}

		// Get shop URL for resilience patterns
		const shopUrl = context.shop || 'default';

		// Wrap request execution in circuit breaker and rate limiter
		return circuitBreaker.execute(shopUrl, async () => {
			// Apply rate limiting before making request
			await rateLimiter.consume(shopUrl, 1);

			return this.executeRequest<T>(url, options, {
				method,
				timeout,
				throwOnError,
				alertOnError,
				context,
				useCookieJar,
				startTime
			});
		});
	}

	/**
	 * Execute the actual HTTP request (extracted for circuit breaker wrapping)
	 */
	private async executeRequest<T = any>(
		url: string,
		options: HttpRequestOptions,
		executionContext: {
			method: string;
			timeout: number;
			throwOnError: boolean;
			alertOnError: boolean;
			context: {
				shop?: string;
				endpoint?: string;
				operation?: string;
				requestId?: string;
				[key: string]: any;
			};
			useCookieJar: boolean;
			startTime: number;
		}
	): Promise<HttpResponse<T>> {
		const { method, timeout, throwOnError, alertOnError, context, useCookieJar, startTime } =
			executionContext;

		// Get fetch implementation (with or without cookie jar)
		// Use cookieJarKey if provided, otherwise fall back to shop
		const jarKey = context.cookieJarKey || context.shop;
		const fetchImpl = this.getFetchImplementation(useCookieJar, jarKey);

		// Create abort controller for timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			// Build headers
			const headers = this.buildHeaders(options, useCookieJar);

			// Build request options
			const requestOptions: RequestInit = {
				method,
				headers,
				body: options.body as any,
				redirect: options.redirect || 'follow',
				signal: controller.signal
			};

			logger.debug('HTTP request starting', {
				method,
				url,
				timeout,
				shop: context.shop,
				endpoint: context.endpoint,
				useCookieJar
			});

			// Perform request
			const response = await fetchImpl(url, requestOptions);
			const duration = Date.now() - startTime;

			// Clear timeout
			clearTimeout(timeoutId);

			// Record metrics
			this.recordMetrics(method, response.status, duration, context);

			// Track response in monitoring system
			getMonitor().trackResponse({
				endpoint: (context.endpoint || 'unknown') as any,
				shop: context.shop || 'unknown',
				statusCode: response.status,
				statusCategory: this.getStatusCategory(response.status),
				durationMs: duration,
				timestamp: new Date(),
				requestId: context.requestId
			});

			// Parse response body
			const data = await this.parseResponseBody<T>(response);

			// Build response object
			const httpResponse: HttpResponse<T> = {
				status: response.status,
				statusText: response.statusText,
				headers: this.extractHeaders(response),
				data,
				raw: response,
				duration
			};

			// Handle non-2xx responses
			if (!this.isSuccessStatus(response.status)) {
				await this.handleErrorResponse(
					url,
					method,
					httpResponse,
					context,
					throwOnError,
					alertOnError
				);
			}

			logger.debug('HTTP request completed', {
				method,
				url,
				status: response.status,
				duration,
				shop: context.shop
			});

			return httpResponse;
		} catch (error) {
			clearTimeout(timeoutId);
			const duration = Date.now() - startTime;

			// Handle specific error types
			if (error instanceof Error) {
				if (error.name === 'AbortError') {
					return this.handleTimeout(url, method, timeout, duration, context, throwOnError);
				}
			}

			// Handle network errors
			return this.handleNetworkError(url, method, error, duration, context, throwOnError);
		}
	}

	/**
	 * Get fetch implementation based on cookie jar configuration
	 */
	private getFetchImplementation(
		useCookieJar: boolean,
		jarKey?: string
	): (url: RequestInfo, init?: RequestInit) => Promise<Response> {
		if (!useCookieJar) {
			// Return native fetch
			return fetch as any;
		}

		// Get cookie-enabled fetch from cookie manager
		const cookieManager = getCookieManager();
		return cookieManager.getFetchWithCookies(fetch as any, jarKey!) as any;
	}

	/**
	 * Build request headers
	 */
	private buildHeaders(options: HttpRequestOptions, useCookieJar: boolean = false): Record<string, string> {
		const headers: Record<string, string> = {
			...this.defaultHeaders,
			...(options.headers as Record<string, string>)
		};

		// Add user agent if not present
		if (!headers['User-Agent'] && !headers['user-agent']) {
			headers['User-Agent'] = options.userAgent || DEFAULT_USER_AGENT;
		}

		// Add cookies if provided (only in manual mode, not when using cookie jar)
		if (options.cookies && !useCookieJar) {
			const cookieString = Object.entries(options.cookies)
				.map(([key, value]) => `${key}=${value}`)
				.join('; ');
			headers['Cookie'] = cookieString;
		}

		return headers;
	}

	/**
	 * Extract headers from response
	 */
	private extractHeaders(response: Response): Record<string, string> {
		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			headers[key] = value;
		});
		return headers;
	}

	/**
	 * Parse response body based on content type
	 */
	private async parseResponseBody<T>(response: Response): Promise<T> {
		const contentType = response.headers.get('content-type') || '';

		try {
			if (contentType.includes('application/json')) {
				return (await response.json()) as T;
			} else if (contentType.includes('text/')) {
				return (await response.text()) as any;
			} else {
				// Return buffer for binary data
				return (await response.buffer()) as any;
			}
		} catch (error) {
			logger.warn('Failed to parse response body', {
				contentType,
				error: error instanceof Error ? error.message : String(error)
			});
			// Return empty object if parsing fails
			return {} as T;
		}
	}

	/**
	 * Check if status code is successful (2xx)
	 */
	private isSuccessStatus(status: number): boolean {
		return status >= 200 && status < 300;
	}

	/**
	 * Record metrics for HTTP request
	 */
	private recordMetrics(
		method: string,
		status: number,
		duration: number,
		context: Record<string, any>
	): void {
		const labels = {
			[LabelNames.METHOD]: method,
			[LabelNames.STATUS_CODE]: String(status),
			...(context.shop && { [LabelNames.SHOP]: context.shop }),
			...(context.endpoint && { [LabelNames.ENDPOINT]: context.endpoint })
		};

		httpRequestsCounter.inc(labels);
		httpDurationHistogram.record(duration / 1000, labels); // Convert ms to seconds

		if (!this.isSuccessStatus(status)) {
			httpErrorsCounter.inc(labels);
		}
	}

	/**
	 * Handle error response (non-2xx status)
	 */
	private async handleErrorResponse<T>(
		url: string,
		method: string,
		response: HttpResponse<T>,
		context: Record<string, any>,
		throwOnError: boolean,
		alertOnError: boolean
	): Promise<void> {
		const { status, statusText, data } = response;

		logger.warn('HTTP request failed with non-2xx status', {
			method,
			url,
			status,
			statusText,
			shop: context.shop
		});

		// Send alert if enabled
		if (alertOnError) {
			try {
				const alertService = getAlertService();
				await alertService.sendAlert({
					type: AlertType.API_ERROR,
					severity: status >= 500 ? AlertSeverity.ERROR : AlertSeverity.WARN,
					title: `HTTP ${status} Error`,
					message: `HTTP request failed: ${method} ${url}`,
					context: {
						shop: context.shop,
						url,
						method,
						status,
						statusText,
						responseBody:
							typeof data === 'string' ? data.substring(0, 500) : JSON.stringify(data).substring(0, 500)
					}
				});
			} catch (alertError) {
				logger.error(
					'Failed to send alert for HTTP error',
					alertError instanceof Error ? alertError : new Error(String(alertError))
				);
			}
		}

		// Throw error if enabled
		if (throwOnError) {
			throw new NetworkError(
				`HTTP request failed with status ${status}: ${statusText}`,
				context,
				url,
				method,
				status
			);
		}
	}

	/**
	 * Handle request timeout
	 */
	private handleTimeout(
		url: string,
		method: string,
		timeout: number,
		duration: number,
		context: Record<string, any>,
		throwOnError: boolean
	): never | HttpResponse {
		logger.error('HTTP request timeout', undefined, {
			method,
			url,
			timeout,
			duration,
			shop: context.shop
		});

		// Record metrics
		this.recordMetrics(method, HTTP_STATUS.TIMEOUT, duration, context);

		if (throwOnError) {
			throw new NetworkError(
				`HTTP request timeout after ${timeout}ms`,
				context,
				url,
				method,
				HTTP_STATUS.TIMEOUT
			);
		}

		// Return error response
		return {
			status: HTTP_STATUS.TIMEOUT,
			statusText: 'Request Timeout',
			headers: {},
			data: null as any,
			raw: null as any,
			duration
		};
	}

	/**
	 * Handle network error (connection failure, DNS, etc.)
	 */
	private handleNetworkError(
		url: string,
		method: string,
		error: unknown,
		duration: number,
		context: Record<string, any>,
		throwOnError: boolean
	): never | HttpResponse {
		const errorMessage = error instanceof Error ? error.message : String(error);

		logger.error('HTTP request network error', error instanceof Error ? error : undefined, {
			method,
			url,
			errorMessage,
			duration,
			shop: context.shop
		});

		// Record metrics
		this.recordMetrics(method, 0, duration, context);

		if (throwOnError) {
			throw new NetworkError(`HTTP request failed: ${errorMessage}`, context, url, method);
		}

		// Return error response
		return {
			status: 0,
			statusText: 'Network Error',
			headers: {},
			data: null as any,
			raw: null as any,
			duration
		};
	}

	/**
	 * Get status code category from HTTP status code
	 */
	private getStatusCategory(statusCode: number): StatusCodeCategory {
		if (statusCode >= 200 && statusCode < 300) return StatusCodeCategory.SUCCESS;
		if (statusCode >= 300 && statusCode < 400) return StatusCodeCategory.REDIRECT;
		if (statusCode >= 400 && statusCode < 500) return StatusCodeCategory.CLIENT_ERROR;
		if (statusCode >= 500 && statusCode < 600) return StatusCodeCategory.SERVER_ERROR;
		if (statusCode === 0) return StatusCodeCategory.NETWORK_ERROR;
		return StatusCodeCategory.UNKNOWN;
	}

	/**
	 * Get cookies for a specific shop
	 * Requires cookie jar to be used for the shop
	 *
	 * @param shop - Shop domain
	 * @param url - URL to get cookies for
	 * @returns Promise resolving to array of cookie info
	 *
	 * @example
	 * ```typescript
	 * const httpClient = getHttpClient();
	 * const cookies = await httpClient.getCookies('myshop.myshopify.com', 'https://myshop.myshopify.com/');
	 * ```
	 */
	async getCookies(shop: string, url: string) {
		const cookieManager = getCookieManager();
		return cookieManager.getCookies(shop, url);
	}

	/**
	 * Clear cookies for a specific jar key
	 *
	 * @param jarKey - Cookie jar key (e.g., 'myshop.myshopify.com:req_abc123')
	 *
	 * @example
	 * ```typescript
	 * const httpClient = getHttpClient();
	 * httpClient.clearCookies('myshop.myshopify.com:req_abc123');
	 * ```
	 */
	clearCookies(jarKey: string): void {
		const cookieManager = getCookieManager();
		cookieManager.clearCookies(jarKey);
	}

	/**
	 * Clear cookies for a specific shop (backwards compatibility)
	 *
	 * @param shop - Shop domain
	 * @deprecated Use clearCookies(jarKey) instead
	 *
	 * @example
	 * ```typescript
	 * const httpClient = getHttpClient();
	 * httpClient.clearShopCookies('myshop.myshopify.com');
	 * ```
	 */
	clearShopCookies(shop: string): void {
		this.clearCookies(shop);
	}

	/**
	 * Get cookie statistics
	 *
	 * @returns Cookie manager statistics
	 *
	 * @example
	 * ```typescript
	 * const httpClient = getHttpClient();
	 * const stats = httpClient.getCookieStats();
	 * console.log(`Managing cookies for ${stats.shopCount} shops`);
	 * ```
	 */
	getCookieStats() {
		const cookieManager = getCookieManager();
		return cookieManager.getStats();
	}
}

/**
 * Singleton instance
 */
let httpClientInstance: HttpClient | null = null;

/**
 * Get the HTTP client singleton instance
 *
 * @returns HttpClient instance
 *
 * @example
 * ```typescript
 * import { getHttpClient } from '$lib/server/http';
 *
 * const httpClient = getHttpClient();
 *
 * // Perform GET request
 * const response = await httpClient.get('https://example.com/api/data', {
 *   timeout: 5000,
 *   context: { shop: 'myshop.myshopify.com', endpoint: '/api/data' }
 * });
 *
 * // Perform POST request
 * const response = await httpClient.post('https://example.com/api/data', {
 *   key: 'value'
 * }, {
 *   timeout: 10000,
 *   context: { shop: 'myshop.myshopify.com' }
 * });
 * ```
 */
export function getHttpClient(): HttpClient {
	if (!httpClientInstance) {
		httpClientInstance = new HttpClient();
	}
	return httpClientInstance;
}

/**
 * Reset the HTTP client instance (for testing)
 * @internal
 */
export function resetHttpClient(): void {
	httpClientInstance = null;
}
