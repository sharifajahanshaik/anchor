// src/utils/parseHTML.ts
import { JSDOM, VirtualConsole } from 'jsdom';
import { transformCheckoutInput, transformCheckoutInputPhoneOnly } from './shopify';
import type { UserInfo, AbandonmentInfo } from '$lib/types';
import type { CheckoutInput } from '../types';
import fetch from 'node-fetch';
import { getLogger } from '../../logger';

const logger = getLogger('html-parser');

// Default actions.js filename (hardcoded for archived code)
const DEFAULT_ACTIONS_JS_FILENAME = 'actions.B_hz6_NC.js';

/**
 * Converts raw merchandise data using your conversion logic.
 */
export function convertMerchandise(input: any): any {
    if (!input || !Array.isArray(input.merchandiseLines)) {
        throw new Error("Invalid input: merchandiseLines array not found");
    }
    const convertedLines = input.merchandiseLines.map((line: any) => {
        const stableId = line.stableId;
        const merch = line.merchandise || {};
        const productVariantReference = {
            id: merch.id,
            variantId: merch.variantId,
            properties: merch.properties || [],
            sellingPlanId: merch.sellingPlan || null,
            sellingPlanDigest: null
        };
        const quantityValue = line.quantity?.items?.value;
        const totalAmount = line.totalAmount?.value;
        let formattedAmount = "0.00";
        if (totalAmount && totalAmount.amount) {
            formattedAmount = parseFloat(totalAmount.amount).toFixed(2);
        }
        return {
            stableId,
            merchandise: { productVariantReference },
            quantity: { items: { value: quantityValue } },
            expectedTotalPrice: {
                value: {
                    amount: formattedAmount,
                    currencyCode: totalAmount ? totalAmount.currencyCode : "INR"
                }
            },
            lineComponentsSource: line.lineComponentsSource,
            lineComponents: line.lineComponents || []
        };
    });
    return { merchandise: { merchandiseLines: convertedLines } };
}

function findQueueToken(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return null;
    if (obj.hasOwnProperty('queueToken') && obj.queueToken != null) return obj.queueToken;
    for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
            const result = findQueueToken(obj[key]);
            if (result != null) return result;
        }
    }
    return null;
}

/**
 * Extracts the actions.js file URL from checkout HTML.
 * This file has a dynamic hash (e.g., actions.B_hz6_NC.js) that changes over time.
 */
export function extractActionsJsUrl(doc: Document): string | null {
    // Find all script tags with src attribute
    const scriptTags = doc.querySelectorAll('script[src]');

    for (const script of scriptTags) {
        const src = script.getAttribute('src');
        if (src && src.includes('/cdn/shopifycloud/checkout-web/assets/') && src.includes('/actions.')) {
            return src;
        }
    }

    return null;
}

/**
 * Fetches the actions.js file and extracts the Proposal query ID
 * Returns the ID from: { id: "867b72fb...", type: "query", name: "Proposal" }
 */
export async function fetchActionsJs(shopUrl: string, actionsJsPath: string, userAgent: string): Promise<string | null> {
    try {
        // Construct full URL if path is relative
        const actionsJsUrl = actionsJsPath.startsWith('http')
            ? actionsJsPath
            : `${shopUrl}${actionsJsPath}`;

        logger.info('Fetching actions.js', { url: actionsJsUrl });

        const response = await fetch(actionsJsUrl, {
            headers: {
                'User-Agent': userAgent,
                'Referer': shopUrl,
                'Origin': shopUrl,
                'sec-ch-ua-platform': '"macOS"',
                'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
                'sec-ch-ua-mobile': '?0'
            }
        });

        if (!response.ok) {
            logger.error('Failed to fetch actions.js', undefined, {
                status: response.status,
                url: actionsJsUrl
            });
            return null;
        }

        const jsContent = await response.text();

        // Extract the Proposal query ID
        // Looking for: id: "867b72fb...", type: "query", name: "Proposal"
        const proposalMatch = jsContent.match(/id:\s*"([^"]+)"[^}]*type:\s*"query"[^}]*name:\s*"Proposal"/);

        if (proposalMatch) {
            const queryId = proposalMatch[1];
            logger.info('Extracted Proposal query ID', { queryId });
            return queryId;
        } else {
            logger.error('Could not find Proposal query ID in actions.js', undefined, { url: actionsJsUrl });
            return null;
        }
    } catch (error) {
        logger.error('Error fetching actions.js', error instanceof Error ? error : new Error(String(error)), {
            url: actionsJsPath
        });
        return null;
    }
}

/**
 * Extracts data from the given HTML and returns transformed checkout input.
 */
export async function extractDataFromHTML(
    htmlText: string,
    userInfo: UserInfo,
    customAttributes?: AbandonmentInfo['customAttributes'],
    isPhoneOnly: boolean = false
): Promise<any> {
    try {
        const virtualConsole = new VirtualConsole();
        virtualConsole.sendTo(console, { omitJSDOMErrors: true });
        const dom = new JSDOM(htmlText, { virtualConsole });
        const doc = dom.window.document;
        let cleanedMerchandise: any = null;
        let queueToken: any = null;
        let sessionToken = "";
        let buildId: string | null = null;

        // Extract actions.js URL
        let actionsJsUrl = extractActionsJsUrl(doc);

        // Use default filename if not found
        if (!actionsJsUrl) {
            actionsJsUrl = `/cdn/shopifycloud/checkout-web/assets/c1/${DEFAULT_ACTIONS_JS_FILENAME}`;
            logger.debug('Using default actions.js', { url: actionsJsUrl });
        }

        // Extract build ID from serialized-environment meta tag
        const serializedEnvironmentMeta = doc.querySelector('meta[name="serialized-environment"]');
        if (serializedEnvironmentMeta) {
            try {
                const metaElem = serializedEnvironmentMeta as unknown as { content: string };
                const envContent = JSON.parse(metaElem.content);
                buildId = envContent.commitSha || null;
                if (buildId) {
                    logger.debug('Extracted build ID', { buildId });
                }
            } catch (error) {
                logger.warn('Error parsing serialized-environment', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        const serializedGraphqlMeta = doc.querySelector('meta[name="serialized-graphql"]');
        if (serializedGraphqlMeta) {
            const metaElem = serializedGraphqlMeta as unknown as { content: string };
            const graphqlContent = JSON.parse(metaElem.content);
            let mainKey: string | null = null;
            for (const key in graphqlContent) {
                if (graphqlContent.hasOwnProperty(key) && graphqlContent[key]?.session?.negotiate) {
                    mainKey = key;
                    break;
                }
            }
            if (mainKey) {
                // Check if MERCHANDISE_OUT_OF_STOCK error is present in the errors array
                const errors = graphqlContent[mainKey]?.session?.negotiate?.errors;
                if (Array.isArray(errors) && errors.some(error => error?.code === 'MERCHANDISE_OUT_OF_STOCK')) {
                    return "MERCHANDISE_OUT_OF_STOCK";
                }

                const merchandise = graphqlContent[mainKey]?.session?.negotiate?.result?.buyerProposal?.merchandise;
                cleanedMerchandise = convertMerchandise(merchandise);
                queueToken = findQueueToken(graphqlContent);
            } else {
                return null
            }
        }

        const serializedSessionToken = doc.querySelector('meta[name="serialized-session-token"]');
        const typedSerializedSessionToken = serializedSessionToken as unknown as { content: string };

        if (typedSerializedSessionToken && typedSerializedSessionToken.content) {
            sessionToken = typedSerializedSessionToken.content.replace(/[\"]/g, "");
        } else {
            sessionToken = "";
        }

        if (!typedSerializedSessionToken) {
            return null
        }

        // Print all extracted values
        // console.log("=== EXTRACTED VALUES FROM CHECKOUT HTML ===");
        // console.log("Session Token:", sessionToken);
        // console.log("Queue Token:", queueToken);
        // console.log("Actions.js URL:", actionsJsUrl);
        // console.log("Build ID:", buildId || "NOT FOUND");
        // console.log("Merchandise Lines:", JSON.stringify(cleanedMerchandise?.merchandise?.merchandiseLines, null, 2));
        // console.log("===========================================");

        const checkoutInput: CheckoutInput = {
            queueToken,
            sessionToken,
            merchandise: cleanedMerchandise
        }

        // Use phone-only transform if isPhoneOnly flag is set
        const transformedInput = isPhoneOnly
            ? transformCheckoutInputPhoneOnly(checkoutInput, userInfo, customAttributes)
            : transformCheckoutInput(checkoutInput, userInfo, customAttributes);

        // Return transformed input, actions.js URL, and build ID
        return {
            payloadVariableObject: transformedInput,
            actionsJsUrl,
            buildId
        };
    } catch (error) {
        logger.error('Error parsing HTML or extracting data', error instanceof Error ? error : new Error(String(error)));
        return null;
    }
}
