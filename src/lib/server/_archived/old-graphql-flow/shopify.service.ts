/**
 * Shopify Service
 *
 * High-level orchestrator for Shopify checkout operations:
 * - Cart page fetching and HTML parsing
 * - Actions.js fetching and query ID extraction
 * - Proposal request orchestration
 * - Progressive /api/collect calls
 * - End-to-end checkout flow
 * - Input transformation and validation
 *
 * This service integrates all specialized clients and parsers into a cohesive API.
 *
 * @module shopify.service
 */

import type {
	CartItem,
	UserInfo,
	AbandonmentInfo
} from '$lib/types';
import type { CheckoutInput, ProposalResponse } from '../types';
import {
	getCartClient,
	getCollectClient,
	getProposalClient,
	getActionsJsClient
} from './shopify';
import { getHtmlParser, getGraphQLParser } from '../parsers';
import { getLogger } from '../../logger';

const logger = getLogger('shopify-service');

/**
 * Transform checkout input with user information (phone-only)
 *
 * @param input - Checkout input from HTML parsing
 * @param userInfo - User information
 * @param customAttributes - Custom attributes
 * @returns Transformed variables for Proposal request
 */
export function transformCheckoutInputPhoneOnly(
	input: CheckoutInput,
	userInfo?: UserInfo,
	customAttributes?: AbandonmentInfo['customAttributes']
): any {
	const { queueToken = null, sessionToken = null, merchandise = null } = input;
	let newMerchandiseLines: any[] = [];

	if (
		merchandise &&
		merchandise.merchandise &&
		Array.isArray(merchandise.merchandise.merchandiseLines)
	) {
		newMerchandiseLines = merchandise.merchandise.merchandiseLines.map((line: any) => ({
			stableId: line.stableId || null,
			merchandise: {
				productVariantReference: {
					id: line.merchandise?.productVariantReference?.id || null,
					variantId: line.merchandise?.productVariantReference?.variantId || null,
					properties: line.merchandise?.productVariantReference?.properties || [],
					sellingPlanId: line.merchandise?.productVariantReference?.sellingPlanId || null,
					sellingPlanDigest: line.merchandise?.productVariantReference?.sellingPlanDigest || null
				}
			},
			quantity: line.quantity || null,
			expectedTotalPrice: line.expectedTotalPrice || { any: true },
			lineComponentsSource: line.lineComponentsSource || null,
			lineComponents: line.lineComponents || []
		}));
	}

	// Build result matching HAR first request exactly
	const result: any = {
		sessionInput: {
			sessionToken: sessionToken || null
		},
		queueToken: queueToken || null,
		discounts: {
			lines: [],
			acceptUnexpectedDiscounts: true
		},
		delivery: {
			deliveryLines: [
				{
					destination: {
						partialStreetAddress: {
							address1: '',
							city: '',
							countryCode: userInfo?.countryCode || 'IN',
							lastName: '',
							zoneCode: userInfo?.zoneCode || '',
							phone: '',
							oneTimeUse: false
						}
					},
					selectedDeliveryStrategy: {
						deliveryStrategyMatchingConditions: {
							estimatedTimeInTransit: { any: true },
							shipments: { any: true }
						},
						options: {}
					},
					targetMerchandiseLines: { any: true },
					deliveryMethodTypes: ['SHIPPING', 'LOCAL'],
					expectedTotalPrice: { any: true },
					destinationChanged: true
				}
			],
			noDeliveryRequired: [],
			useProgressiveRates: false,
			prefetchShippingRatesStrategy: null,
			supportsSplitShipping: true
		},
		deliveryExpectations: {
			deliveryExpectationLines: []
		},
		merchandise: { merchandiseLines: newMerchandiseLines },
		memberships: {
			memberships: []
		},
		payment: {
			totalAmount: { any: true },
			paymentLines: [
				{
					paymentMethod: {
						directPaymentMethod: null,
						giftCardPaymentMethod: null,
						redeemablePaymentMethod: null,
						walletPaymentMethod: null,
						walletsPlatformPaymentMethod: null,
						localPaymentMethod: null,
						paymentOnDeliveryMethod: null,
						paymentOnDeliveryMethod2: null,
						manualPaymentMethod: null,
						customPaymentMethod: null,
						offsitePaymentMethod: {
							name: 'RZP ',
							paymentMethodIdentifier: '788affd63c99309bc6fcfec87ac49129', // Hardcoded for archived code
							billingAddress: {
								streetAddress: {
									address1: '',
									city: '',
									countryCode: userInfo?.countryCode || 'IN',
									lastName: '',
									zoneCode: userInfo?.zoneCode || '',
									phone: ''
								}
							}
						},
						customOnsitePaymentMethod: null,
						deferredPaymentMethod: null,
						customerCreditCardPaymentMethod: null,
						paypalBillingAgreementPaymentMethod: null,
						remotePaymentInstrument: null
					},
					amount: { any: true }
				}
			],
			billingAddress: {
				streetAddress: {
					address1: '',
					city: '',
					countryCode: userInfo?.countryCode || 'IN',
					lastName: '',
					zoneCode: userInfo?.zoneCode || '',
					phone: ''
				}
			}
		},
		buyerIdentity: {
			customer: {
				presentmentCurrency: 'INR',
				countryCode: userInfo?.countryCode || 'IN'
			},
			phone: userInfo?.phone?.startsWith('0')
				? userInfo.phone.substring(1)
				: userInfo?.phone || '',
			phoneCountryCode: 'IN',
			marketingConsent: [],
			shopPayOptInPhone: {
				countryCode: 'IN'
			},
			rememberMe: false
		},
		tip: {
			tipLines: []
		},
		taxes: {
			proposedAllocations: null,
			proposedTotalAmount: {
				value: {
					amount: '0',
					currencyCode: 'INR'
				}
			},
			proposedTotalIncludedAmount: null,
			proposedMixedStateTotalAmount: null
		},
		note: {
			message: customAttributes?.breeze_checkout_url
				? customAttributes.breeze_checkout_url
				: customAttributes?.breeze_abandoned_checkout_url
					? customAttributes.breeze_abandoned_checkout_url
					: null,
			customAttributes: customAttributes
				? Object.entries(customAttributes)
						.filter(([_, value]) => value !== null)
						.map(([key, value]) => ({ key, value }))
				: []
		},
		localizationExtension: {
			fields: []
		},
		nonNegotiableTerms: null,
		scriptFingerprint: {
			signature: null,
			signatureUuid: null,
			lineItemScriptChanges: [],
			paymentScriptChanges: [],
			shippingScriptChanges: []
		},
		optionalDuties: {
			buyerRefusesDuties: false
		},
		cartMetafields: []
	};

	return result;
}

/**
 * Transform checkout input with full user information
 *
 * @param input - Checkout input from HTML parsing
 * @param userInfo - User information
 * @param customAttributes - Custom attributes
 * @returns Transformed variables for Proposal request
 */
export function transformCheckoutInput(
	input: CheckoutInput,
	userInfo?: UserInfo,
	customAttributes?: AbandonmentInfo['customAttributes']
): any {
	const { queueToken = null, sessionToken = null, merchandise = null } = input;
	let newMerchandiseLines: any[] = [];

	// Check if address fields are provided (full info scenario)
	const hasAddressInfo = userInfo?.address && userInfo?.city && userInfo?.postalCode;

	if (
		merchandise &&
		merchandise.merchandise &&
		Array.isArray(merchandise.merchandise.merchandiseLines)
	) {
		newMerchandiseLines = merchandise.merchandise.merchandiseLines.map((line: any) => ({
			stableId: line.stableId || null,
			merchandise: {
				productVariantReference: {
					id: line.merchandise?.productVariantReference?.id || null,
					variantId: line.merchandise?.productVariantReference?.variantId || null,
					properties: line.merchandise?.productVariantReference?.properties || [],
					sellingPlanId: line.merchandise?.productVariantReference?.sellingPlanId || null,
					sellingPlanDigest: line.merchandise?.productVariantReference?.sellingPlanDigest || null
				}
			},
			quantity: line.quantity || null,
			expectedTotalPrice: line.expectedTotalPrice || { any: true },
			lineComponentsSource: line.lineComponentsSource || null,
			lineComponents: line.lineComponents || []
		}));
	}

	const result: any = {
		sessionInput: {
			sessionToken: sessionToken || null
		},
		queueToken: queueToken || null
	};

	// Add discounts
	result.discounts = {
		lines: [],
		acceptUnexpectedDiscounts: true
	};

	// Add buyerIdentity - always present if userInfo exists
	if (userInfo) {
		result.buyerIdentity = {
			customer: {
				presentmentCurrency: 'INR',
				countryCode: userInfo.countryCode || 'IN'
			},
			emailChanged: true,
			phoneCountryCode: 'IN',
			marketingConsent: [],
			rememberMe: false
		};

		// Add email if present
		if (userInfo.email) {
			result.buyerIdentity.email = userInfo.email;
		}

		// Add phone and shopPayOptInPhone if phone is present
		if (userInfo.phone) {
			result.buyerIdentity.phone = userInfo.phone;
			result.buyerIdentity.shopPayOptInPhone = {
				countryCode: 'IN'
			};
		}
	}

	// Add merchandise
	if (
		merchandise &&
		merchandise.merchandise &&
		Array.isArray(merchandise.merchandise.merchandiseLines)
	) {
		result.merchandise = { merchandiseLines: newMerchandiseLines };
	}

	// Add memberships
	result.memberships = {
		memberships: []
	};

	// Add delivery - generic structure for both scenarios
	if (userInfo && hasAddressInfo) {
		result.delivery = {
			deliveryLines: [
				{
					destination: {
						partialStreetAddress: {
							address1: userInfo.address || '',
							address2: '',
							city: userInfo.city || '',
							countryCode: userInfo.countryCode || 'IN',
							postalCode: userInfo.postalCode || '',
							firstName: userInfo.firstName || '',
							lastName: userInfo.lastName || '',
							zoneCode: userInfo.zoneCode || '',
							phone: userInfo.phone || '',
							oneTimeUse: false
						}
					},
					selectedDeliveryStrategy: {
						deliveryStrategyMatchingConditions: {
							estimatedTimeInTransit: { any: true },
							shipments: { any: true }
						},
						options: {}
					},
					targetMerchandiseLines: { any: true },
					deliveryMethodTypes: ['SHIPPING'],
					expectedTotalPrice: { any: true },
					destinationChanged: true
				}
			],
			noDeliveryRequired: [],
			useProgressiveRates: false,
			prefetchShippingRatesStrategy: null,
			supportsSplitShipping: true
		};
	}

	// Add deliveryExpectations
	result.deliveryExpectations = {
		deliveryExpectationLines: []
	};

	// Add payment with full structure including billing address
	if (userInfo) {
		result.payment = {
			totalAmount: { any: true },
			paymentLines: hasAddressInfo
				? [
						{
							paymentMethod: {
								directPaymentMethod: null,
								giftCardPaymentMethod: {
									billingAddress: {
										streetAddress: {
											address1: userInfo.address || '',
											address2: '',
											city: userInfo.city || '',
											countryCode: userInfo.countryCode || 'IN',
											postalCode: userInfo.postalCode || '',
											firstName: userInfo.firstName || '',
											lastName: userInfo.lastName || '',
											zoneCode: userInfo.zoneCode || '',
											phone: userInfo.phone || ''
										}
									},
									code: 'CASH'
								},
								redeemablePaymentMethod: null,
								walletPaymentMethod: null,
								walletsPlatformPaymentMethod: null,
								localPaymentMethod: null,
								paymentOnDeliveryMethod: null,
								paymentOnDeliveryMethod2: null,
								manualPaymentMethod: null,
								customPaymentMethod: null,
								offsitePaymentMethod: null,
								customOnsitePaymentMethod: null,
								deferredPaymentMethod: null,
								customerCreditCardPaymentMethod: null,
								paypalBillingAgreementPaymentMethod: null,
								remotePaymentInstrument: null
							},
							amount: { any: true }
						}
					]
				: []
		};

		// Add billing address to payment if address info is present
		if (hasAddressInfo) {
			result.payment.billingAddress = {
				streetAddress: {
					address1: userInfo.address || '',
					address2: '',
					city: userInfo.city || '',
					countryCode: userInfo.countryCode || 'IN',
					postalCode: userInfo.postalCode || '',
					firstName: userInfo.firstName || '',
					lastName: userInfo.lastName || '',
					zoneCode: userInfo.zoneCode || '',
					phone: userInfo.phone || ''
				}
			};
		}
	}

	// Add tip
	result.tip = {
		tipLines: []
	};

	// Add poNumber
	result.poNumber = null;

	// Add taxes
	result.taxes = {
		proposedAllocations: null,
		proposedTotalAmount: {
			value: {
				amount: '0',
				currencyCode: 'INR'
			}
		},
		proposedTotalIncludedAmount: null,
		proposedMixedStateTotalAmount: null
	};

	// Add note with custom attributes if provided
	result.note = {
		message: customAttributes?.breeze_checkout_url
			? customAttributes.breeze_checkout_url
			: customAttributes?.breeze_abandoned_checkout_url
				? customAttributes.breeze_abandoned_checkout_url
				: null,
		customAttributes: customAttributes
			? Object.entries(customAttributes)
					.filter(([_, value]) => value !== null)
					.map(([key, value]) => ({ key, value }))
			: []
	};

	// Add localizationExtension
	result.localizationExtension = {
		fields: []
	};

	// Add nonNegotiableTerms
	result.nonNegotiableTerms = null;

	// Add scriptFingerprint
	result.scriptFingerprint = {
		signature: null,
		signatureUuid: null,
		lineItemScriptChanges: [],
		paymentScriptChanges: [],
		shippingScriptChanges: []
	};

	// Add optionalDuties
	result.optionalDuties = {
		buyerRefusesDuties: false
	};

	// Add cartMetafields
	result.cartMetafields = [];

	return result;
}

/**
 * Shopify Service options
 */
export interface ShopifyServiceOptions {
	/**
	 * Request ID for logging
	 */
	requestId?: string;

	/**
	 * Custom user agent
	 */
	userAgent?: string;

	/**
	 * Cart fetch timeout
	 */
	cartTimeout?: number;

	/**
	 * Proposal request timeout
	 */
	proposalTimeout?: number;

	/**
	 * Whether to perform /api/collect calls
	 * @default true
	 */
	performCollectCalls?: boolean;

	/**
	 * Min delay between collect calls
	 * @default 1000
	 */
	collectMinDelay?: number;

	/**
	 * Max delay between collect calls
	 * @default 10000
	 */
	collectMaxDelay?: number;
}

/**
 * Complete checkout result
 */
export interface CheckoutResult {
	/**
	 * Checkout URL
	 */
	checkoutUrl: string | null;

	/**
	 * Buyer identity
	 */
	buyerIdentity: {
		email?: string;
		phone?: string;
		phoneCountryCode?: string;
	} | null;

	/**
	 * Proposal response
	 */
	proposalResponse: ProposalResponse;

	/**
	 * Session token
	 */
	sessionToken: string | null;

	/**
	 * User agent used
	 */
	userAgent: string;

	/**
	 * Build ID
	 */
	buildId: string | null;

	/**
	 * Actions.js URL
	 */
	actionsJsUrl: string | null;
}

/**
 * Shopify Service class
 *
 * High-level orchestrator for Shopify checkout operations
 */
export class ShopifyService {
	private cartClient = getCartClient();
	private collectClient = getCollectClient();
	private proposalClient = getProposalClient();
	private actionsJsClient = getActionsJsClient();
	private htmlParser = getHtmlParser();
	private graphqlParser = getGraphQLParser();

	/**
	 * Execute complete checkout flow
	 *
	 * This orchestrates the full checkout process:
	 * 1. Fetch cart page
	 * 2. Parse HTML for session/queue tokens and merchandise
	 * 3. Fetch actions.js and extract Proposal query ID
	 * 4. Transform user input to Proposal variables
	 * 5. Make Proposal request
	 * 6. Perform progressive /api/collect calls
	 *
	 * @param shopUrl - Shop URL
	 * @param items - Cart items
	 * @param userInfo - User information
	 * @param customAttributes - Custom attributes
	 * @param isPhoneOnly - Whether to use phone-only transformation
	 * @param options - Service options
	 * @returns Checkout result
	 *
	 * @example
	 * ```typescript
	 * const service = getShopifyService();
	 *
	 * const result = await service.executeCheckoutFlow(
	 *   'https://myshop.myshopify.com',
	 *   [{ variantId: '123', quantity: '1' }],
	 *   { phone: '+919876543210', countryCode: 'IN', zoneCode: 'MH' },
	 *   { breeze_abandoned_checkout_url: 'https://...' },
	 *   true,
	 *   { requestId: 'req-123' }
	 * );
	 *
	 * if (result.checkoutUrl) {
	 *   console.log(`Checkout URL: ${result.checkoutUrl}`);
	 * }
	 * ```
	 */
	async executeCheckoutFlow(
		shopUrl: string,
		items: CartItem[],
		userInfo: UserInfo,
		customAttributes?: AbandonmentInfo['customAttributes'],
		isPhoneOnly: boolean = false,
		options: ShopifyServiceOptions = {}
	): Promise<CheckoutResult | null> {
		const {
			requestId = 'unknown',
			userAgent,
			cartTimeout,
			proposalTimeout,
			performCollectCalls = true,
			collectMinDelay = 1000,
			collectMaxDelay = 10000
		} = options;

		try {
			logger.info('Starting checkout flow', {
				requestId,
				shop: shopUrl,
				itemCount: items.length,
				isPhoneOnly
			});

			// Step 1: Fetch cart page
			const cartResult = await this.cartClient.fetchCart(shopUrl, items, {
				userAgent,
				timeout: cartTimeout,
				context: { requestId }
			});

			if (!cartResult) {
				logger.error('Failed to fetch cart page', undefined, { requestId, shop: shopUrl });
				return null;
			}

			const { html, checkoutUrl, userAgent: finalUserAgent } = cartResult;

			logger.debug('Cart page fetched', {
				requestId,
				checkoutUrl,
				htmlLength: html.length
			});

			// Step 2: Parse HTML
			const parsedData = this.htmlParser.parseCheckoutHtml(html, { requestId });

			if (parsedData === 'MERCHANDISE_OUT_OF_STOCK') {
				logger.warn('Merchandise out of stock', { requestId, shop: shopUrl });
				return null;
			}

			if (!parsedData) {
				logger.error('Failed to parse checkout HTML', undefined, { requestId, shop: shopUrl });
				return null;
			}

			const { sessionToken, queueToken, merchandise, actionsJsUrl, buildId } = parsedData;

			logger.debug('HTML parsed successfully', {
				requestId,
				hasSessionToken: !!sessionToken,
				hasQueueToken: !!queueToken,
				hasMerchandise: !!merchandise,
				actionsJsUrl,
				buildId
			});

			// Step 3: Fetch actions.js and extract Proposal query ID
			const proposalQueryId = await this.actionsJsClient.fetchProposalQueryId(
				shopUrl,
				actionsJsUrl,
				{
					userAgent: finalUserAgent,
					context: { requestId }
				}
			);

			if (!proposalQueryId) {
				logger.error('Failed to extract Proposal query ID', undefined, {
					requestId,
					shop: shopUrl
				});
				return null;
			}

			logger.debug('Proposal query ID extracted', {
				requestId,
				queryId: proposalQueryId
			});

			// Step 4: Transform user input to Proposal variables
			const checkoutInput: CheckoutInput = {
				queueToken: queueToken ?? undefined,
				sessionToken: sessionToken ?? undefined,
				merchandise: merchandise ?? undefined
			};

			const payloadVariables = isPhoneOnly
				? transformCheckoutInputPhoneOnly(checkoutInput, userInfo, customAttributes)
				: transformCheckoutInput(checkoutInput, userInfo, customAttributes);

			logger.debug('Payload variables prepared', {
				requestId,
				isPhoneOnly
			});

			// Step 5: Make Proposal request
			const proposalResponse = await this.proposalClient.makeRequest(
				shopUrl,
				payloadVariables,
				proposalQueryId,
				{
					userAgent: finalUserAgent,
					buildId,
					checkoutUrl,
					timeout: proposalTimeout,
					context: { requestId, items }
				}
			);

			if (!proposalResponse || !proposalResponse.data) {
				logger.error('Proposal request failed', undefined, { requestId, shop: shopUrl });
				return null;
			}

			logger.debug('Proposal request successful', {
				requestId,
				hasData: !!proposalResponse.data
			});

			// Parse proposal response
			const parsedProposal = this.graphqlParser.parseProposalResponse(proposalResponse, {
				requestId
			});

			// Step 6: Perform progressive /api/collect calls
			if (performCollectCalls && checkoutUrl) {
				logger.debug('Starting progressive collect calls', { requestId });

				await this.collectClient.makeProgressiveCalls(shopUrl, checkoutUrl, finalUserAgent, {
					minDelay: collectMinDelay,
					maxDelay: collectMaxDelay,
					context: { requestId }
				});

				logger.debug('Completed progressive collect calls', { requestId });
			}

			logger.info('Checkout flow completed successfully', {
				requestId,
				shop: shopUrl,
				checkoutUrl: parsedProposal?.checkoutUrl
			});

			return {
				checkoutUrl: parsedProposal?.checkoutUrl || null,
				buyerIdentity: parsedProposal?.buyerIdentity || null,
				proposalResponse,
				sessionToken,
				userAgent: finalUserAgent,
				buildId,
				actionsJsUrl
			};
		} catch (error) {
			logger.error(
				'Error in checkout flow',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId, shop: shopUrl }
			);
			return null;
		}
	}

	/**
	 * Clear cookies for a shop
	 *
	 * @param shop - Shop URL
	 */
	clearShopCookies(shop: string): void {
		this.cartClient.clearShopCookies(shop);
		this.proposalClient.clearShopCookies(shop);
	}
}

/**
 * Singleton instance
 */
let shopifyServiceInstance: ShopifyService | null = null;

/**
 * Get the Shopify service singleton instance
 *
 * @returns ShopifyService instance
 *
 * @example
 * ```typescript
 * import { getShopifyService } from '$lib/server/shopify.service';
 *
 * const service = getShopifyService();
 *
 * const result = await service.executeCheckoutFlow(...);
 * ```
 */
export function getShopifyService(): ShopifyService {
	if (!shopifyServiceInstance) {
		shopifyServiceInstance = new ShopifyService();
	}
	return shopifyServiceInstance;
}

/**
 * Reset the Shopify service instance (for testing)
 * @internal
 */
export function resetShopifyService(): void {
	shopifyServiceInstance = null;
}
