// src/lib/utils/shopify.ts
import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';
import fetch from 'node-fetch';
import randomUseragent from 'random-useragent';
import type { UserInfo, AbandonmentInfo, CartItem } from '$lib/types';
import type { CheckoutInput } from '../types';
import { getLogger } from '../../logger';

const logger = getLogger('shopify');

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
                    properties: line.merchandise?.productVariantReference?.properties || [],
                    sellingPlanId: line.merchandise?.productVariantReference?.sellingPlanId || null,
                    sellingPlanDigest: line.merchandise?.productVariantReference?.sellingPlanDigest || null
                }
            },
            quantity: line.quantity || null,
            expectedTotalPrice: line.expectedTotalPrice || { any: true },
            lineComponentsSource: line.lineComponentsSource || null,
            lineComponents: line.lineComponents || []
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
                            address1: "",
                            city: "",
                            countryCode: userInfo?.countryCode || "IN",
                            lastName: "",
                            zoneCode: userInfo?.zoneCode || "",
                            phone: "",
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
                    deliveryMethodTypes: ["SHIPPING", "LOCAL"],
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
                            name: "RZP ",
                            paymentMethodIdentifier: '788affd63c99309bc6fcfec87ac49129', // Hardcoded for archived code
                            billingAddress: {
                                streetAddress: {
                                    address1: "",
                                    city: "",
                                    countryCode: userInfo?.countryCode || "IN",
                                    lastName: "",
                                    zoneCode: userInfo?.zoneCode || "",
                                    phone: ""
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
                    address1: "",
                    city: "",
                    countryCode: userInfo?.countryCode || "IN",
                    lastName: "",
                    zoneCode: userInfo?.zoneCode || "",
                    phone: ""
                }
            }
        },
        buyerIdentity: {
            customer: {
                presentmentCurrency: "INR",
                countryCode: userInfo?.countryCode || "IN"
            },
            phone: userInfo?.phone?.startsWith('0') ? userInfo.phone.substring(1) : (userInfo?.phone || ""),
            phoneCountryCode: "IN",
            marketingConsent: [],
            shopPayOptInPhone: {
                countryCode: "IN"
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
                    amount: "0",
                    currencyCode: "INR"
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
        },
        cartMetafields: []
    };

    return result;
}

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
                presentmentCurrency: "INR",
                countryCode: userInfo.countryCode || "IN"
            },
            emailChanged: true,
            phoneCountryCode: "IN",
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
                countryCode: "IN"
            };
        }
    }

    // Add merchandise
    if (merchandise &&
        merchandise.merchandise &&
        Array.isArray(merchandise.merchandise.merchandiseLines)) {
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
                            address1: userInfo.address || "",
                            address2: "",
                            city: userInfo.city || "",
                            countryCode: userInfo.countryCode || "IN",
                            postalCode: userInfo.postalCode || "",
                            firstName: userInfo.firstName || "",
                            lastName: userInfo.lastName || "",
                            zoneCode: userInfo.zoneCode || "",
                            phone: userInfo.phone || "",
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
                    deliveryMethodTypes: ["SHIPPING"],
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
            paymentLines: hasAddressInfo ? [
                {
                    paymentMethod: {
                        directPaymentMethod: null,
                        giftCardPaymentMethod: {
                            billingAddress: {
                                streetAddress: {
                                    address1: userInfo.address || "",
                                    address2: "",
                                    city: userInfo.city || "",
                                    countryCode: userInfo.countryCode || "IN",
                                    postalCode: userInfo.postalCode || "",
                                    firstName: userInfo.firstName || "",
                                    lastName: userInfo.lastName || "",
                                    zoneCode: userInfo.zoneCode || "",
                                    phone: userInfo.phone || ""
                                }
                            },
                            code: "CASH"
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
            ] : []
        };

        // Add billing address to payment if address info is present
        if (hasAddressInfo) {
            result.payment.billingAddress = {
                streetAddress: {
                    address1: userInfo.address || "",
                    address2: "",
                    city: userInfo.city || "",
                    countryCode: userInfo.countryCode || "IN",
                    postalCode: userInfo.postalCode || "",
                    firstName: userInfo.firstName || "",
                    lastName: userInfo.lastName || "",
                    zoneCode: userInfo.zoneCode || "",
                    phone: userInfo.phone || ""
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
                amount: "0",
                currencyCode: "INR"
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

export async function makeMerchandiseProposalRequest(
    shopUrl: string,
    variables: any,
    proposalQueryId: string,
    buildId: string | null = null,
    items?: CartItem[],
    userInfo?: UserInfo,
    checkoutUrl?: string,
    cookieJar?: any,
    userAgent?: string
): Promise<any> {
    const requestUrl = `${shopUrl}/checkouts/internal/graphql/persisted?operationName=Proposal`;

    // Note: The full query is no longer sent in the request body.
    // Instead, we use the persisted query ID (hash) extracted from actions.js

    // Reuse existing cookie jar if provided, otherwise create new one
    const jar = cookieJar || new CookieJar();
    const fetchWithCookies = fetchCookie(fetch, jar);

    // Log cookie jar status
    if (cookieJar) {
        const cookies = await cookieJar.getCookies(shopUrl);
        logger.debug('Reusing cookie jar', {
            cookieCount: cookies.length,
            cookieNames: cookies.length > 0 ? cookies.map((c: any) => c.key).join(', ') : undefined
        });
    } else {
        logger.warn('No cookie jar provided, creating new one (cookies will be lost!)');
    }

    // Extract checkout source ID from checkout URL dynamically
    // Format: https://domain.com/checkouts/cn/CHECKOUT_ID/en-in
    let checkoutSourceId = 'hWN7RSCPlrSvAz7GAb0tQX2X'; // Hardcoded for archived code
    let checkoutType = 'cn'; // Hardcoded for archived code

    if (checkoutUrl) {
        try {
            const urlMatch = checkoutUrl.match(/\/checkouts\/(cn|cs)\/([^/]+)/);
            if (urlMatch) {
                checkoutType = urlMatch[1]; // Extract type (cn or cs)
                checkoutSourceId = urlMatch[2]; // Extract checkout ID
                logger.debug('Extracted checkout ID from URL', { checkoutType, checkoutSourceId });
            }
        } catch (error) {
            logger.warn('Failed to extract checkout ID from URL, using default', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Detect platform and mobile from User Agent to match sec-ch-ua headers
    const ua = userAgent || randomUseragent.getRandom();
    const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    const platform = ua.includes('Windows') ? 'Windows' :
                     ua.includes('Mac') ? 'macOS' :
                     ua.includes('Linux') ? 'Linux' :
                     ua.includes('Android') ? 'Android' :
                     ua.includes('iPhone') || ua.includes('iPad') ? 'iOS' : 'macOS';

    const headers: Record<string, string> = {
        'accept': 'application/json',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-IN',
        'content-type': 'application/json',
        'dnt': '1',
        'origin': new URL(shopUrl).origin,
        'priority': 'u=1, i',
        'referer': checkoutUrl || shopUrl,
        'sec-ch-ua': '"Not_A Brand";v="99", "Chromium";v="142"',
        'sec-ch-ua-mobile': isMobile ? '?1' : '?0',
        'sec-ch-ua-platform': `"${platform}"`,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': ua,
        'x-checkout-one-session-token': variables.sessionInput.sessionToken,
        'shopify-checkout-client': 'checkout-web/1.0',
        'shopify-checkout-source': `id="${checkoutSourceId}", type="${checkoutType}"`,
        'x-checkout-web-build-id': buildId || 'fc1a22c39f13aa1a9d0a664c53e21ef1787b9cca',
        'x-checkout-web-deploy-stage': 'production',
        'x-checkout-web-server-handling': 'fast',
        'x-checkout-web-server-rendering': 'yes',
        'x-checkout-web-source-id': checkoutSourceId
    };

    const requestBody = {
        variables,
        operationName: "Proposal",
        id: proposalQueryId
    };

    // Log the request body for debugging
    // console.log('\n' + '='.repeat(80));
    // console.log('📤 PROPOSAL REQUEST BODY');
    // console.log('='.repeat(80));
    // console.log(JSON.stringify(requestBody, null, 2));
    // console.log('='.repeat(80) + '\n');

    const options = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
    };


    try {
        const response = await fetchWithCookies(requestUrl, options);

        // console.log("✅ Abandoned Checkout Response:", response.status)
        if (!response.ok) {
            const text = await response.text();
            // Send alert to Slack instead of throwing an error
            await sendSlackAbandonedCheckoutAlert({
                shopUrl,
                errorReason: `Request failed with status ${response.status} during proposal request`,
                additionalData: JSON.stringify({
                    responseText: text,
                    items: items || [],
                    userInfo: userInfo ? {
                        ...userInfo,
                        email: userInfo.email ? userInfo.email.substring(0, 2) + '***' + userInfo.email.substring(userInfo.email.length - 5) : undefined,
                        phone: userInfo.phone ? userInfo.phone.substring(0, 2) + '***' + userInfo.phone.substring(userInfo.phone.length - 2) : undefined
                    } : null
                }, null, 2)
            });
            // Return empty response to prevent further processing
            return { data: null };
        }
        const responseData = await response.json();

        // Log buyer identity from response to verify phone was accepted
        // const buyerIdentity = (responseData as any)?.data?.session?.negotiate?.result?.buyerProposal?.buyerIdentity;
        // const errors = (responseData as any)?.data?.session?.negotiate?.errors || [];

        // console.log('\n' + '='.repeat(80));
        // console.log('📥 PROPOSAL RESPONSE - KEY INFO');
        // console.log('='.repeat(80));
        // console.log(`Phone in response: ${buyerIdentity?.phone || 'NULL'}`);
        // console.log(`Email in response: ${buyerIdentity?.email || 'NULL'}`);
        // console.log(`Total errors: ${errors.length}`);
        // console.log(`Error codes: ${errors.map((e: any) => e.code).join(', ')}`);
        // console.log('='.repeat(80) + '\n');

        return responseData;
    } catch (error) {
        logger.error('Error during proposal request', error instanceof Error ? error : new Error(String(error)), {
            shopUrl
        });
        // Send alert to Slack instead of throwing an error
        await sendSlackAbandonedCheckoutAlert({
            shopUrl,
            errorReason: "Error during proposal request",
            additionalData: JSON.stringify({
                errorMessage: error instanceof Error ? error.message : String(error),
                items: items || [],
                userInfo: userInfo ? {
                    ...userInfo,
                    email: userInfo.email ? userInfo.email.substring(0, 2) + '***' + userInfo.email.substring(userInfo.email.length - 5) : undefined,
                    phone: userInfo.phone ? userInfo.phone.substring(0, 2) + '***' + userInfo.phone.substring(userInfo.phone.length - 2) : undefined
                } : null
            }, null, 2)
        });
        // Return empty response to prevent further processing
        return { data: null };
    }
}

/**
 * @deprecated Stub exports for archived code compatibility
 */
export function getCartClient(): any {
	return null;
}

export function getCollectClient(): any {
	return null;
}

export function getProposalClient(): any {
	return null;
}

export function getActionsJsClient(): any {
	return null;
}

export function sendSlackAbandonedCheckoutAlert(_params: any): Promise<void> {
	return Promise.resolve();
}
