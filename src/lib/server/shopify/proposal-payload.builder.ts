/**
 * Proposal Payload Builder
 *
 * Builds GraphQL Proposal API payload from extracted checkout data.
 * Follows Shopify's persisted query structure.
 */

import { logger } from '$lib/server/logger';
import type { CheckoutExtractedData } from '$lib/types/shopify.types';
import type { CartItem } from '$lib/types/shopify.types';
import type { AbandonmentInfo } from '$lib/types/abandonment.types';

/**
 * Proposal API GraphQL payload structure
 */
export interface ProposalPayload {
	variables: {
		sessionInput: {
			sessionToken: string;
		};
		queueToken: string | null;
		discounts: {
			lines: any[];
			acceptUnexpectedDiscounts: boolean;
		};
		delivery: any;
		deliveryExpectations: {
			deliveryExpectationLines: any[];
		};
		merchandise: any;
		memberships: {
			memberships: any[];
		};
		payment: any;
		buyerIdentity: any;
		tip: {
			tipLines: any[];
		};
		poNumber: null;
		taxes: any;
		note: {
			message: string | null;
			customAttributes: Array<{ key: string; value: string }>;
		};
		localizationExtension: {
			fields: any[];
		};
		nonNegotiableTerms: null;
		scriptFingerprint: {
			signature: null;
			signatureUuid: null;
			lineItemScriptChanges: any[];
			paymentScriptChanges: any[];
			shippingScriptChanges: any[];
		};
		optionalDuties: {
			buyerRefusesDuties: boolean;
		};
		cartMetafields: any[];
	};
	operationName: string;
	id: string;
}

/**
 * Shopify's persisted Proposal query ID
 * This is a constant hash that Shopify uses for the Proposal GraphQL query
 */
export const PROPOSAL_QUERY_ID = 'efedd3af0472edf30e995bb287edfafad61d7a790d9bb494f8be911a2571f795';

/**
 * Builds the Proposal API payload from extracted checkout data
 *
 * @param extractedData - Extracted data from checkout.html
 * @param items - Original cart items from abandonment request (optional, uses extracted data if not provided)
 * @param customAttributes - Custom attributes to include in the note (UTM params, recovery URLs, etc.)
 * @param requestId - Request ID for logging
 * @returns Complete Proposal API payload
 */
export function buildProposalPayload(
	extractedData: CheckoutExtractedData,
	items: CartItem[] | null,
	customAttributes: AbandonmentInfo['customAttributes'],
	requestId: string
): ProposalPayload {
	logger.debug('Building Proposal payload', {
		requestId,
		shop: extractedData.shop.domain,
		requestItemCount: items?.length ?? 0,
		extractedItemCount: extractedData.merchandise.length,
		taxesIncluded: extractedData.tax.taxesIncluded,
		extractedPrice: extractedData.merchandise[0]?.price
	});

	// Build address object (used in multiple places)
	// NOTE: Shopify rejects null values but accepts empty strings
	const streetAddress = {
		address1: extractedData.address.address1 ?? '',
		city: extractedData.address.city ?? '',
		countryCode: extractedData.customer.countryCode,
		postalCode: extractedData.address.postalCode ?? '',
		firstName: extractedData.customer.firstName ?? '',
		lastName: extractedData.customer.lastName ?? '',
		zoneCode: extractedData.address.zoneCode ?? '',
		phone: extractedData.customer.phone
	};

	// Build merchandise lines
	// If items provided, use them and match with extracted data
	// Otherwise, use extracted merchandise directly (better for accuracy)
	const merchandiseLines = items
		? items.map((item) => {
				// Find matching extracted merchandise data
				const extractedItem = extractedData.merchandise.find(
					(m) => m.variantIdNumber === item.variantId
				);

				// StableId must exist - if extractedItem is not found, we have a data mismatch
				if (!extractedItem) {
					logger.error(
						'Merchandise item mismatch - variant not found in extracted data',
						new Error(`Variant ${item.variantId} not found in extracted checkout data`),
						{
							requestId,
							variantId: item.variantId,
							extractedVariants: extractedData.merchandise.map((m) => m.variantIdNumber)
						}
					);
					throw new Error(`Variant ${item.variantId} not found in extracted checkout data`);
				}

				const stableId = extractedItem.stableId;
				const quantity = parseInt(item.quantity, 10);

				// Calculate expected total price (unit price × quantity)
				let expectedAmount = '0.00';
				if (extractedItem?.price) {
					const unitPrice = parseFloat(extractedItem.price);
					const totalPrice = unitPrice * quantity;
					expectedAmount = totalPrice.toFixed(2);
				}

				// Log info if price is missing or zero
				if (!extractedItem?.price || expectedAmount === '0.00') {
					logger.info('Missing or zero price for merchandise line', {
						requestId,
						variantId: item.variantId,
						extractedPrice: extractedItem?.price,
						calculatedAmount: expectedAmount
					});
				}

				return {
					stableId,
					merchandise: {
						productVariantReference: {
							id: `gid://shopify/ProductVariantMerchandise/${item.variantId}`,
							variantId: `gid://shopify/ProductVariant/${item.variantId}`,
							properties: [],
							sellingPlanId: null,
							sellingPlanDigest: null
						}
					},
					quantity: {
						items: {
							value: quantity
						}
					},
					expectedTotalPrice: {
						value: {
							amount: expectedAmount,
							currencyCode: extractedItem?.currencyCode || 'INR'
						}
					},
					lineComponentsSource: null,
					lineComponents: []
				};
		  })
		: extractedData.merchandise.map((extractedItem) => {
				// Use extracted merchandise directly (most accurate)
				const quantity = extractedItem.quantity;

				// Calculate expected total price (unit price × quantity)
				let expectedAmount = '0.00';
				if (extractedItem.price) {
					const unitPrice = parseFloat(extractedItem.price);
					const totalPrice = unitPrice * quantity;
					expectedAmount = totalPrice.toFixed(2);
				}

				// Log info if price is missing or zero
				if (!extractedItem.price || expectedAmount === '0.00') {
					logger.info('Missing or zero price for merchandise line', {
						requestId,
						variantId: extractedItem.variantIdNumber,
						extractedPrice: extractedItem.price,
						calculatedAmount: expectedAmount
					});
				}

				return {
					stableId: extractedItem.stableId,
					merchandise: {
						productVariantReference: {
							id: `gid://shopify/ProductVariantMerchandise/${extractedItem.variantIdNumber}`,
							variantId: extractedItem.variantId,
							properties: [],
							sellingPlanId: null,
							sellingPlanDigest: null
						}
					},
					quantity: {
						items: {
							value: quantity
						}
					},
					expectedTotalPrice: {
						value: {
							amount: expectedAmount,
							currencyCode: extractedItem.currencyCode
						}
					},
					lineComponentsSource: null,
					lineComponents: []
				};
		  });

	// Build delivery lines
	const deliveryLines = [
		{
			destination: {
				partialStreetAddress: {
					...streetAddress,
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
	];

	// Build payment lines
	const paymentLines: any[] = [];

	// Only add payment method if available
	if (extractedData.payment.paymentMethodIdentifier && extractedData.payment.paymentMethodName) {
		paymentLines.push({
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
					name: extractedData.payment.paymentMethodName,
					paymentMethodIdentifier: extractedData.payment.paymentMethodIdentifier,
					billingAddress: {
						streetAddress
					}
				},
				customOnsitePaymentMethod: null,
				deferredPaymentMethod: null,
				customerCreditCardPaymentMethod: null,
				paypalBillingAgreementPaymentMethod: null,
				remotePaymentInstrument: null
			},
			amount: { any: true }
		});
	}

	// Build the complete payload
	const payload: ProposalPayload = {
		variables: {
			sessionInput: {
				sessionToken: extractedData.sessionToken
			},
			queueToken: extractedData.queueToken,
			discounts: {
				lines: [],
				acceptUnexpectedDiscounts: true
			},
			delivery: {
				deliveryLines,
				noDeliveryRequired: [],
				useProgressiveRates: false,
				prefetchShippingRatesStrategy: null,
				supportsSplitShipping: true
			},
			deliveryExpectations: {
				deliveryExpectationLines: []
			},
			merchandise: {
				merchandiseLines
			},
			memberships: {
				memberships: []
			},
			payment: {
				totalAmount: { any: true },
				paymentLines,
				billingAddress: {
					streetAddress
				}
			},
			buyerIdentity: {
				customer: {
					presentmentCurrency: extractedData.merchandise[0]?.currencyCode || 'INR',
					countryCode: extractedData.customer.countryCode
				},
				email: extractedData.customer.email,
				emailChanged: false,
				phone: extractedData.customer.phone,
				phoneCountryCode: extractedData.customer.countryCode,
				marketingConsent: [],
				shopPayOptInPhone: {
					number: extractedData.customer.phone,
					countryCode: extractedData.customer.countryCode
				},
				rememberMe: false
			},
			tip: {
				tipLines: []
			},
			poNumber: null,
			taxes: {
				proposedAllocations: null,
				proposedTotalAmount: extractedData.tax.taxesIncluded
					? null
					: {
							value: {
								amount: extractedData.tax.totalTaxAmount || '0.00',
								currencyCode: extractedData.tax.currencyCode
							}
					  },
				proposedTotalIncludedAmount: extractedData.tax.taxesIncluded
					? {
							value: {
								amount: extractedData.tax.totalTaxAmount || '0.00',
								currencyCode: extractedData.tax.currencyCode
							}
					  }
					: null,
				proposedMixedStateTotalAmount: null,
				proposedExemptions: []
			},
			note: {
				message: customAttributes?.breeze_checkout_url
					? customAttributes.breeze_checkout_url
					: customAttributes?.breeze_abandoned_checkout_url
						? customAttributes.breeze_abandoned_checkout_url
						: customAttributes?.abandonedRecoveryUrl
							? customAttributes.abandonedRecoveryUrl
							: null,
				customAttributes: customAttributes
					? Object.entries(customAttributes)
							.filter((entry): entry is [string, string] => entry[1] !== null)
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
		},
		operationName: 'Proposal',
		id: PROPOSAL_QUERY_ID
	};

	logger.debug('Proposal payload built successfully', {
		requestId,
		shop: extractedData.shop.domain,
		payloadSize: JSON.stringify(payload).length,
		merchandiseLineCount: merchandiseLines.length,
		hasPaymentMethod: paymentLines.length > 0,
		hasCustomAttributes: !!customAttributes && Object.keys(customAttributes).length > 0,
		customAttributeCount: customAttributes ? Object.entries(customAttributes).filter(([_, v]) => v !== null).length : 0,
		noteMessage: payload.variables.note.message?.substring(0, 50) || null
	});

	return payload;
}

/**
 * Builds request headers for Proposal API call
 *
 * @param extractedData - Extracted data from checkout.html
 * @param shopUrl - Shop URL (e.g., "test-store.myshopify.com")
 * @param userAgent - User agent string
 * @param platformInfo - Platform information from user agent
 * @returns Headers object for Proposal API request
 */
export function buildProposalHeaders(
	extractedData: CheckoutExtractedData,
	shopUrl: string,
	userAgent: string,
	platformInfo: { secChUaMobile: '?0' | '?1'; secChUaPlatform: string }
): Record<string, string> {
	return {
		accept: 'application/json',
		'accept-language': 'en-GB,en;q=0.9',
		'content-type': 'application/json',
		'shopify-checkout-source': `id="${extractedData.sourceToken}", type="${extractedData.sourceType}"`,
		'x-checkout-one-session-token': extractedData.sessionToken,
		'x-checkout-web-source-id': extractedData.sourceToken,
		'x-checkout-web-build-id': extractedData.buildId || 'fc1a22c39f13aa1a9d0a664c53e21ef1787b9cca',
		'shopify-checkout-client': 'checkout-web/1.0',
		'x-checkout-web-deploy-stage': 'production',
		'x-checkout-web-server-handling': 'fast',
		'x-checkout-web-server-rendering': 'yes',
		'sec-ch-ua': '"Not_A Brand";v="99", "Chromium";v="120"',
		'sec-ch-ua-mobile': platformInfo.secChUaMobile,
		'sec-ch-ua-platform': platformInfo.secChUaPlatform,
		'sec-fetch-dest': 'empty',
		'sec-fetch-mode': 'cors',
		'sec-fetch-site': 'same-origin',
		origin: `https://${shopUrl}`,
		referer: `https://${shopUrl}/checkouts/${extractedData.sourceType}/${extractedData.sourceToken}/en-in`
	};
}
