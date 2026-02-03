/**
 * GraphQL Parser
 *
 * Specialized parser for handling Shopify GraphQL responses:
 * - Proposal response parsing
 * - Error extraction and classification
 * - Checkout URL extraction
 * - Buyer identity data extraction
 * - Response validation
 *
 * @module parsers/graphql.parser
 */

import type {
	ProposalResponse,
	ShopifyGraphQLErrorData,
	ShopifyGraphQLErrorCode
} from '../types';
import { getLogger } from '../../logger';

const logger = getLogger('graphql-parser');

/**
 * Parsed proposal result
 */
export interface ParsedProposalResult {
	/** Checkout URL from response */
	checkoutUrl: string | null;

	/** Buyer identity information */
	buyerIdentity: {
		email?: string;
		phone?: string;
		phoneCountryCode?: string;
	} | null;

	/** Session token */
	sessionToken: string | null;

	/** Queue token */
	queueToken: string | null;

	/** Merchandise data */
	merchandise: any;

	/** Delivery data */
	delivery: any;

	/** Payment data */
	payment: any;
}

/**
 * Error classification result
 */
export interface ErrorClassification {
	/** Error code */
	code: string;

	/** Error message */
	message: string;

	/** Error severity */
	severity: 'critical' | 'warning' | 'info';

	/** Whether error is recoverable */
	recoverable: boolean;

	/** User-friendly message */
	userMessage: string;
}

/**
 * GraphQL Parser class
 *
 * Handles parsing and validation of Shopify GraphQL responses
 */
export class GraphQLParser {
	/**
	 * Parse Proposal GraphQL response
	 *
	 * @param response - Proposal response data
	 * @param context - Optional context for logging
	 * @returns Parsed result or null if invalid
	 *
	 * @example
	 * ```typescript
	 * const parser = getGraphQLParser();
	 *
	 * const result = parser.parseProposalResponse(responseData, {
	 *   requestId: 'req-123'
	 * });
	 *
	 * if (result) {
	 *   console.log(`Checkout URL: ${result.checkoutUrl}`);
	 *   console.log(`Email: ${result.buyerIdentity?.email}`);
	 * }
	 * ```
	 */
	parseProposalResponse(
		response: ProposalResponse,
		context: { requestId?: string; [key: string]: any } = {}
	): ParsedProposalResult | null {
		const requestId = context.requestId || 'unknown';

		try {
			// Check if response has data
			if (!response.data) {
				logger.warn('Proposal response has no data', { requestId });
				return null;
			}

			const negotiate = response.data.session?.negotiate;
			if (!negotiate) {
				logger.warn('Proposal response has no negotiate data', { requestId });
				return null;
			}

			const result = negotiate.result;
			const buyerProposal = result?.buyerProposal;

			if (!buyerProposal) {
				logger.warn('Proposal response has no buyer proposal', { requestId });
				return null;
			}

			const parsed: ParsedProposalResult = {
				checkoutUrl: result.checkoutUrl || null,
				buyerIdentity: buyerProposal.buyerIdentity
					? {
							email: buyerProposal.buyerIdentity.email,
							phone: buyerProposal.buyerIdentity.phone,
							phoneCountryCode: buyerProposal.buyerIdentity.phoneCountryCode
						}
					: null,
				sessionToken: buyerProposal.sessionToken || null,
				queueToken: buyerProposal.queueToken || null,
				merchandise: buyerProposal.merchandise || null,
				delivery: buyerProposal.delivery || null,
				payment: buyerProposal.payment || null
			};

			logger.debug('Successfully parsed Proposal response', {
				requestId,
				hasCheckoutUrl: !!parsed.checkoutUrl,
				hasBuyerIdentity: !!parsed.buyerIdentity,
				hasSessionToken: !!parsed.sessionToken
			});

			return parsed;
		} catch (error) {
			logger.error(
				'Error parsing Proposal response',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId }
			);
			return null;
		}
	}

	/**
	 * Extract errors from Proposal response
	 *
	 * @param response - Proposal response data
	 * @param context - Optional context for logging
	 * @returns Array of GraphQL errors
	 *
	 * @example
	 * ```typescript
	 * const errors = parser.extractErrors(responseData);
	 *
	 * errors.forEach(error => {
	 *   console.log(`Error: ${error.code} - ${error.message}`);
	 * });
	 * ```
	 */
	extractErrors(
		response: ProposalResponse,
		context: { requestId?: string; [key: string]: any } = {}
	): ShopifyGraphQLErrorData[] {
		const requestId = context.requestId || 'unknown';

		try {
			const errors: ShopifyGraphQLErrorData[] = [];

			// Check for negotiate errors
			const negotiateErrors = response.data?.session?.negotiate?.errors;
			if (Array.isArray(negotiateErrors) && negotiateErrors.length > 0) {
				errors.push(...negotiateErrors);
			}

			// Check for top-level GraphQL errors
			if (Array.isArray(response.errors) && response.errors.length > 0) {
				const formattedErrors = response.errors.map((error: any) => ({
					code: 'GRAPHQL_ERROR',
					message: error.message,
					path: error.path,
					extensions: error as any
				}));
				errors.push(...formattedErrors);
			}

			if (errors.length > 0) {
				logger.debug('Extracted errors from Proposal response', {
					requestId,
					errorCount: errors.length,
					errorCodes: errors.map((e) => e.code).join(', ')
				});
			}

			return errors;
		} catch (error) {
			logger.error(
				'Error extracting errors from response',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId }
			);
			return [];
		}
	}

	/**
	 * Check if response has errors
	 *
	 * @param response - Proposal response data
	 * @returns True if response contains errors
	 *
	 * @example
	 * ```typescript
	 * if (parser.hasErrors(responseData)) {
	 *   console.log('Response contains errors');
	 * }
	 * ```
	 */
	hasErrors(response: ProposalResponse): boolean {
		return this.extractErrors(response).length > 0;
	}

	/**
	 * Check if response has specific error code
	 *
	 * @param response - Proposal response data
	 * @param errorCode - Error code to check
	 * @returns True if error code exists
	 *
	 * @example
	 * ```typescript
	 * if (parser.hasErrorCode(responseData, 'MERCHANDISE_OUT_OF_STOCK')) {
	 *   console.log('Product is out of stock');
	 * }
	 * ```
	 */
	hasErrorCode(response: ProposalResponse, errorCode: string): boolean {
		const errors = this.extractErrors(response);
		return errors.some((error) => error.code === errorCode);
	}

	/**
	 * Classify error by severity and recoverability
	 *
	 * @param error - GraphQL error
	 * @returns Error classification
	 *
	 * @example
	 * ```typescript
	 * const classification = parser.classifyError(error);
	 *
	 * if (!classification.recoverable) {
	 *   console.log('Critical error, cannot proceed');
	 * }
	 * ```
	 */
	classifyError(error: ShopifyGraphQLErrorData): ErrorClassification {
		const code = error.code;
		const message = error.message;

		// Map error codes to classifications
		const errorMap: Record<
			string,
			Omit<ErrorClassification, 'code' | 'message'>
		> = {
			MERCHANDISE_OUT_OF_STOCK: {
				severity: 'critical',
				recoverable: false,
				userMessage: 'One or more items in your cart are out of stock.'
			},
			DELIVERY_INVALID_POSTAL_CODE_FOR_ZONE: {
				severity: 'critical',
				recoverable: true,
				userMessage: 'The postal code is invalid for the selected region.'
			},
			DELIVERY_ADDRESS_INVALID: {
				severity: 'critical',
				recoverable: true,
				userMessage: 'The delivery address is invalid.'
			},
			PAYMENT_METHOD_INVALID: {
				severity: 'critical',
				recoverable: true,
				userMessage: 'The payment method is invalid.'
			},
			PHONE_INVALID: {
				severity: 'warning',
				recoverable: true,
				userMessage: 'The phone number is invalid.'
			},
			EMAIL_INVALID: {
				severity: 'warning',
				recoverable: true,
				userMessage: 'The email address is invalid.'
			},
			GRAPHQL_ERROR: {
				severity: 'warning',
				recoverable: true,
				userMessage: 'An error occurred while processing your request.'
			}
		};

		const classification = errorMap[code] || {
			severity: 'info' as const,
			recoverable: true,
			userMessage: message || 'An unknown error occurred.'
		};

		return {
			code,
			message,
			...classification
		};
	}

	/**
	 * Extract checkout URL from response
	 *
	 * @param response - Proposal response data
	 * @returns Checkout URL or null
	 *
	 * @example
	 * ```typescript
	 * const checkoutUrl = parser.extractCheckoutUrl(responseData);
	 * ```
	 */
	extractCheckoutUrl(response: ProposalResponse): string | null {
		try {
			return response.data?.session?.negotiate?.result?.checkoutUrl || null;
		} catch {
			return null;
		}
	}

	/**
	 * Extract buyer identity from response
	 *
	 * @param response - Proposal response data
	 * @returns Buyer identity or null
	 *
	 * @example
	 * ```typescript
	 * const identity = parser.extractBuyerIdentity(responseData);
	 * if (identity) {
	 *   console.log(`Email: ${identity.email}`);
	 * }
	 * ```
	 */
	extractBuyerIdentity(response: ProposalResponse): {
		email?: string;
		phone?: string;
		phoneCountryCode?: string;
	} | null {
		try {
			const buyerIdentity =
				response.data?.session?.negotiate?.result?.buyerProposal?.buyerIdentity;

			if (!buyerIdentity) {
				return null;
			}

			return {
				email: buyerIdentity.email,
				phone: buyerIdentity.phone,
				phoneCountryCode: buyerIdentity.phoneCountryCode
			};
		} catch {
			return null;
		}
	}

	/**
	 * Validate Proposal response structure
	 *
	 * @param response - Response to validate
	 * @returns True if response is valid
	 *
	 * @example
	 * ```typescript
	 * if (parser.isValidProposalResponse(responseData)) {
	 *   // Process response
	 * }
	 * ```
	 */
	isValidProposalResponse(response: any): response is ProposalResponse {
		try {
			return (
				typeof response === 'object' &&
				response !== null &&
				(response.data !== undefined || response.errors !== undefined)
			);
		} catch {
			return false;
		}
	}

	/**
	 * Check if response indicates success
	 *
	 * @param response - Proposal response data
	 * @returns True if response is successful (has data and no critical errors)
	 *
	 * @example
	 * ```typescript
	 * if (parser.isSuccessfulResponse(responseData)) {
	 *   console.log('Checkout created successfully');
	 * }
	 * ```
	 */
	isSuccessfulResponse(response: ProposalResponse): boolean {
		try {
			// Must have data
			if (!response.data) {
				return false;
			}

			// Must have negotiate result
			if (!response.data.session?.negotiate?.result) {
				return false;
			}

			// Check for critical errors
			const errors = this.extractErrors(response);
			const hasCriticalErrors = errors.some((error) => {
				const classification = this.classifyError(error);
				return classification.severity === 'critical' && !classification.recoverable;
			});

			return !hasCriticalErrors;
		} catch {
			return false;
		}
	}

	/**
	 * Get summary of response for logging
	 *
	 * @param response - Proposal response data
	 * @returns Response summary
	 *
	 * @example
	 * ```typescript
	 * const summary = parser.getResponseSummary(responseData);
	 * console.log(JSON.stringify(summary, null, 2));
	 * ```
	 */
	getResponseSummary(response: ProposalResponse): {
		hasData: boolean;
		hasCheckoutUrl: boolean;
		hasBuyerIdentity: boolean;
		errorCount: number;
		errorCodes: string[];
		isSuccessful: boolean;
	} {
		const errors = this.extractErrors(response);

		return {
			hasData: !!response.data,
			hasCheckoutUrl: !!this.extractCheckoutUrl(response),
			hasBuyerIdentity: !!this.extractBuyerIdentity(response),
			errorCount: errors.length,
			errorCodes: errors.map((e) => e.code),
			isSuccessful: this.isSuccessfulResponse(response)
		};
	}
}

/**
 * Singleton instance
 */
let graphqlParserInstance: GraphQLParser | null = null;

/**
 * Get the GraphQL parser singleton instance
 *
 * @returns GraphQLParser instance
 *
 * @example
 * ```typescript
 * import { getGraphQLParser } from '$lib/server/parsers';
 *
 * const parser = getGraphQLParser();
 *
 * const result = parser.parseProposalResponse(responseData);
 * if (result) {
 *   console.log(`Checkout URL: ${result.checkoutUrl}`);
 * }
 * ```
 */
export function getGraphQLParser(): GraphQLParser {
	if (!graphqlParserInstance) {
		graphqlParserInstance = new GraphQLParser();
	}
	return graphqlParserInstance;
}

/**
 * Reset the GraphQL parser instance (for testing)
 * @internal
 */
export function resetGraphQLParser(): void {
	graphqlParserInstance = null;
}
