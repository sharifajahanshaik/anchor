/**
 * Proposal API Client
 *
 * Handles GraphQL Proposal requests to Shopify checkout.
 * This client uses the HTTP client infrastructure for all requests,
 * ensuring consistent error handling, metrics, and monitoring.
 */

import { logger } from '$lib/server/logger';
import { getHttpClient } from '$lib/server/http';
import { getConfig } from '$lib/server/config';
import type { ProposalPayload } from './proposal-payload.builder';

/**
 * Proposal API response structure
 */
export interface ProposalResponse {
	/** Success status */
	success: boolean;
	/** HTTP status code */
	statusCode: number;
	/** Response data from Shopify (if successful) */
	data: any;
	/** Error information (if failed) */
	error?: {
		type: 'timeout' | 'network' | 'http_error' | 'graphql_error' | 'unknown';
		message: string;
		retryable: boolean;
		details?: any;
	};
	/** Response time in milliseconds */
	responseTime: number;
}

/**
 * Proposal request options
 */
export interface ProposalRequestOptions {
	/** Request timeout in milliseconds (default: 30000) */
	timeout?: number;
	/** Custom user agent (optional) */
	userAgent?: string;
	/** Request ID for logging */
	requestId: string;
	/** Cookie jar key for request-specific cookie isolation (e.g., 'shop.myshopify.com:req_abc123') */
	cookieJarKey?: string;
}

/**
 * Proposal API Client
 */
export class ProposalClient {
	/**
	 * Make a Proposal API request
	 *
	 * @param shopUrl - Shop URL (e.g., "test-store.myshopify.com")
	 * @param payload - Complete Proposal payload (variables, operationName, id)
	 * @param headers - Request headers
	 * @param options - Request options
	 * @returns Proposal response
	 */
	async makeRequest(
		shopUrl: string,
		payload: ProposalPayload,
		headers: Record<string, string>,
		options: ProposalRequestOptions
	): Promise<ProposalResponse> {
		const { timeout = 30000, userAgent, requestId, cookieJarKey } = options;
		const config = getConfig();

		// Ensure shopUrl has protocol - if it already has one, don't add it again
		const normalizedShopUrl = shopUrl.startsWith('http') ? shopUrl : `https://${shopUrl}`;
		const requestUrl = `${normalizedShopUrl}/checkouts/internal/graphql/persisted?operationName=Proposal`;

		logger.info('Making Proposal API request', {
			requestId,
			shop: shopUrl,
			cookieJarKey,
			queryId: payload.id
		});

		if (config.debug.logPayloads) {
			logger.info('Proposal API request payload', {
				requestId,
				payload
			});
		}

		const startTime = Date.now();

		try {
			// Get HTTP client
			const httpClient = getHttpClient();

			// Make request using HTTP client with cookie jar enabled to reuse session cookies
			const response = await httpClient.post(requestUrl, payload, {
				timeout,
				userAgent,
				headers,
				throwOnError: false, // Handle errors manually
				alertOnError: false, // Handle alerts in abandonment service
				useCookieJar: true, // Enable cookie jar to reuse cookies from Cart Permalink visit
				context: {
					shop: shopUrl,
					cookieJarKey, // Request-specific cookie jar for isolation
					endpoint: 'proposal-api',
					operation: 'checkout-finalization',
					requestId
				}
			});

			const responseTime = response.duration;

			// Handle non-200 responses
			if (response.status !== 200) {
				logger.warn('Proposal API returned non-200 status', {
					requestId,
					shop: shopUrl,
					status: response.status,
					statusText: response.statusText,
					responseTime
				});

				return {
					success: false,
					statusCode: response.status,
					data: null,
					error: {
						type: 'http_error',
						message: `HTTP ${response.status}: ${response.statusText}`,
						retryable: this.isRetryableHttpStatus(response.status),
						details: {
							status: response.status,
							statusText: response.statusText
						}
					},
					responseTime
				};
			}

			// Parse response data
			const responseData = response.data;

			if (config.debug.logResponses) {
				logger.info('Proposal API response data', {
					requestId,
					shop: shopUrl,
					statusCode: response.status,
					responseData,
					responseTime
				});
			}

			// Check for GraphQL errors at top level
			if (responseData.errors && responseData.errors.length > 0) {
				const firstError = responseData.errors[0];
				logger.warn('Proposal API returned top-level GraphQL errors', {
					requestId,
					shop: shopUrl,
					errorCount: responseData.errors.length,
					firstError: firstError.message || firstError,
					responseTime
				});

				return {
					success: false,
					statusCode: response.status,
					data: responseData,
					error: {
						type: 'graphql_error',
						message: firstError.message || String(firstError),
						retryable: this.isRetryableGraphQLError(firstError),
						details: responseData.errors
					},
					responseTime
				};
			}

			// Check for validation errors in negotiate.errors (even with 200 status)
			const negotiateErrors = responseData?.data?.session?.negotiate?.errors;
			if (negotiateErrors && negotiateErrors.length > 0) {
				const errorCodes = negotiateErrors.map((e: any) => e.code).join(', ');

			// Check if any error is UnprocessableTermViolation (non-retryable)
			const hasTermViolation = negotiateErrors.some(
				(e: any) => e.__typename === 'UnprocessableTermViolation'
			);
				// ConfirmChangeViolation = Shopify counter-proposal with corrections (treat as success)
				// UnprocessableTermViolation = Permanent failure (e.g., restricted products)
				if (hasTermViolation) {
					// UnprocessableTermViolation - permanent failure, don't retry
					logger.warn('Proposal API returned UnprocessableTermViolation', {
						requestId,
						shop: shopUrl,
						errorCount: negotiateErrors.length,
						errorCodes,
						errors: negotiateErrors,
						responseTime
					});

					return {
						success: false,
						statusCode: response.status,
						data: responseData,
						error: {
							type: 'graphql_error',
							message: `UnprocessableTermViolation: ${errorCodes}`,
							retryable: false,
							details: negotiateErrors
						},
						responseTime
					};
				} else {
					// Only ConfirmChangeViolation - Shopify created checkout with corrections
					// Treat as success since checkout was created
					logger.info('Proposal API returned ConfirmChangeViolation (counter-proposal accepted)', {
						requestId,
						shop: shopUrl,
						errorCount: negotiateErrors.length,
						errorCodes,
						message: 'Shopify created checkout with corrections',
						errors: negotiateErrors,
						responseTime
					});

					// Return success - checkout was created with Shopify's corrections
					return {
						success: true,
						statusCode: response.status,
						data: responseData,
						responseTime
					};
				}
			}

			// Success
			logger.info('Proposal API request successful', {
				requestId,
				shop: shopUrl,
				hasData: !!responseData.data,
				responseTime
			});

			return {
				success: true,
				statusCode: response.status,
				data: responseData,
				responseTime
			};
		} catch (error) {
			const responseTime = Date.now() - startTime;

			// Handle timeout errors
			if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('timeout'))) {
				logger.warn('Proposal API request timeout', {
					requestId,
					shop: shopUrl,
					timeout,
					responseTime
				});

				return {
					success: false,
					statusCode: 0,
					data: null,
					error: {
						type: 'timeout',
						message: `Request timeout after ${timeout}ms`,
						retryable: true
					},
					responseTime
				};
			}

			// Handle network errors
			logger.error(
				'Proposal API request failed',
				error instanceof Error ? error : new Error(String(error)),
				{
					requestId,
					shop: shopUrl,
					responseTime
				}
			);

			return {
				success: false,
				statusCode: 0,
				data: null,
				error: {
					type: 'network',
					message: error instanceof Error ? error.message : String(error),
					retryable: true
				},
				responseTime
			};
		}
	}

	/**
	 * Determine if an HTTP status code is retryable
	 */
	private isRetryableHttpStatus(status: number): boolean {
		// 5xx errors are retryable (server errors)
		if (status >= 500 && status < 600) {
			return true;
		}

		// 429 Too Many Requests is retryable
		if (status === 429) {
			return true;
		}

		// 408 Request Timeout is retryable
		if (status === 408) {
			return true;
		}

		// 4xx errors are generally not retryable (client errors)
		// Examples: 401 Unauthorized, 403 Forbidden, 404 Not Found, 422 Unprocessable Entity
		return false;
	}

	/**
	 * Determine if a GraphQL error is retryable
	 */
	private isRetryableGraphQLError(error: any): boolean {
		const errorMessage = error.message || String(error);
		const errorCode = error.extensions?.code;

		// Non-retryable error codes/messages
		const nonRetryablePatterns = [
			'MERCHANDISE_OUT_OF_STOCK',
			'MERCHANDISE_NOT_AVAILABLE',
			'SESSION_EXPIRED',
			'INVALID_SESSION',
			'INVALID_CHECKOUT',
			'CHECKOUT_EXPIRED',
			'PAYMENT_METHOD_INVALID',
			'VALIDATION_ERROR',
			'UnprocessableTermViolation', // Term violation (e.g., restricted products)
			'was provided invalid value', // GraphQL input validation errors
			'Expected value to not be null' // GraphQL null validation errors
		];

		// Check if error matches any non-retryable pattern
		for (const pattern of nonRetryablePatterns) {
			if (errorCode === pattern || errorMessage.includes(pattern)) {
				return false;
			}
		}

		// Default to retryable for unknown errors
		// This is safer as we don't want to permanently fail for transient issues
		return true;
	}
}

/**
 * Singleton instance
 */
let proposalClientInstance: ProposalClient | null = null;

/**
 * Get the Proposal client singleton instance
 *
 * @returns ProposalClient instance
 */
export function getProposalClient(): ProposalClient {
	if (!proposalClientInstance) {
		proposalClientInstance = new ProposalClient();
	}
	return proposalClientInstance;
}

/**
 * Reset the Proposal client instance (for testing)
 * @internal
 */
export function resetProposalClient(): void {
	proposalClientInstance = null;
}
