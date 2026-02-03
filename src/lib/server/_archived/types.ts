/**
 * ARCHIVED TYPE DEFINITIONS
 *
 * This file contains type definitions that are only used by deprecated/archived code flows.
 * These types support the old GraphQL-based checkout flow and should not be used in new code.
 *
 * Active code should use types from src/lib/types/ instead.
 */

/**
 * Checkout input structure extracted from cart page
 * @deprecated Only used in old-graphql-flow
 */
export interface CheckoutInput {
	queueToken?: string;
	sessionToken?: string;
	merchandise?: {
		merchandise?: {
			merchandiseLines?: MerchandiseLine[];
		};
	};
}

/**
 * Merchandise line structure from Shopify
 * @deprecated Only used in old-graphql-flow
 */
export interface MerchandiseLine {
	stableId?: string | null;
	merchandise?: {
		productVariantReference?: {
			id?: string | null;
			variantId?: string | null;
			properties?: Array<{ key: string; value: string }>;
			sellingPlanId?: string | null;
			sellingPlanDigest?: string | null;
		};
	};
	quantity?: number | null;
	expectedTotalPrice?: { any: boolean } | { amount: string; currencyCode: string };
	lineComponentsSource?: string | null;
	lineComponents?: any[];
}

/**
 * Shopify proposal request variables structure
 * @deprecated Only used in old-graphql-flow
 */
export interface ProposalVariables {
	sessionInput: {
		sessionToken: string | null;
	};
	queueToken?: string | null;
	discounts?: any;
	delivery?: any;
	deliveryExpectations?: any;
	merchandise?: any;
	memberships?: any;
	payment?: any;
	buyerIdentity?: any;
	tip?: any;
	poNumber?: string | null;
	taxes?: any;
	note?: any;
	localizationExtension?: any;
	nonNegotiableTerms?: any;
	scriptFingerprint?: any;
	optionalDuties?: any;
	cartMetafields?: any[];
}

/**
 * Parsed cart page data
 * @deprecated Only used in old-graphql-flow
 */
export interface ParsedCartData {
	sessionToken: string | null;
	queueToken: string | null;
	merchandise: any | null;
	checkoutUrl: string | null;
	buildId: string | null;
}

/**
 * Actions.js metadata extracted from script
 * @deprecated Only used in old-graphql-flow
 */
export interface ActionsJsMetadata {
	proposalQueryId: string;
	buildId: string | null;
	version: string | null;
}

/**
 * Shopify checkout source configuration
 * @deprecated Only used in old-graphql-flow
 */
export interface CheckoutSource {
	id: string;
	type: 'cn' | 'cs';
}

/**
 * Progressive feature flags for /api/collect
 * @deprecated Only used in old-graphql-flow
 */
export interface ProgressiveFeatureFlags {
	step: number;
	flags: string[];
}

/**
 * Collect API request payload
 * @deprecated Only used in old-graphql-flow
 */
export interface CollectRequest {
	event: string;
	timestamp: number;
	sessionId: string;
	flags?: string[];
	metadata?: Record<string, any>;
}

/**
 * Collect API response
 * @deprecated Only used in old-graphql-flow
 */
export interface CollectResponse {
	success: boolean;
	sessionId?: string;
	error?: string;
}

/**
 * Shopify GraphQL error codes
 * @deprecated Only used in old-graphql-flow
 */
export enum ShopifyGraphQLErrorCode {
	MERCHANDISE_OUT_OF_STOCK = 'MERCHANDISE_OUT_OF_STOCK',
	DELIVERY_INVALID_POSTAL_CODE_FOR_ZONE = 'DELIVERY_INVALID_POSTAL_CODE_FOR_ZONE',
	DELIVERY_ADDRESS_INVALID = 'DELIVERY_ADDRESS_INVALID',
	PAYMENT_METHOD_INVALID = 'PAYMENT_METHOD_INVALID',
	PHONE_INVALID = 'PHONE_INVALID',
	EMAIL_INVALID = 'EMAIL_INVALID',
	GENERIC_ERROR = 'GENERIC_ERROR'
}

/**
 * GraphQL error structure from Shopify response
 * @deprecated Only used in old-graphql-flow
 */
export interface ShopifyGraphQLErrorData {
	code: string;
	message: string;
	path?: string[];
	extensions?: Record<string, any>;
}

/**
 * Shopify proposal response structure
 * @deprecated Only used in old-graphql-flow
 */
export interface ProposalResponse {
	data?: {
		session?: {
			negotiate?: {
				result?: {
					buyerProposal?: {
						buyerIdentity?: {
							email?: string;
							phone?: string;
							phoneCountryCode?: string;
						};
						sessionToken?: string;
						queueToken?: string;
						merchandise?: any;
						delivery?: any;
						payment?: any;
					};
					checkoutUrl?: string;
				};
				errors?: ShopifyGraphQLErrorData[];
			};
		};
	};
	errors?: Array<{ message: string; locations?: any[]; path?: string[] }>;
}

/**
 * Payment method identifier structure
 * @deprecated Only used in old-graphql-flow
 */
export interface PaymentMethodIdentifier {
	type: string;
	value: string;
}

/**
 * Slack alert parameters for abandoned checkouts
 * @deprecated Only used in old-graphql-flow
 */
export interface SlackAbandonedCheckoutAlertParams {
	/**
	 * The URL of the shop where the abandoned checkout occurred
	 */
	shopUrl: string;

	/**
	 * Error reason to include in the notification
	 */
	errorReason: string;

	/**
	 * Additional data to include in the notification
	 */
	additionalData: string;

	/**
	 * Whether this is a test notification
	 * @default false
	 */
	isTest?: boolean;

	/**
	 * Array of Slack user IDs to mention in the notification
	 */
	userIdsToMention?: string[];

	/**
	 * Custom webhook URL (optional, defaults to the predefined webhook URL)
	 */
	webhookUrl?: string;
}
