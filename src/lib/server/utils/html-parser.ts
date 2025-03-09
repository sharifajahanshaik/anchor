// src/utils/parseHTML.ts
import { JSDOM, VirtualConsole } from 'jsdom';
import { transformCheckoutInput } from './shopify';
import type { UserInfo, CheckoutInput, AbandonmentInfo } from '$lib/types';

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
 * Extracts data from the given HTML and returns transformed checkout input.
 */
export async function extractDataFromHTML(htmlText: string, userInfo: UserInfo, customAttributes?: AbandonmentInfo['customAttributes']): Promise<any> {
    try {
        const virtualConsole = new VirtualConsole();
        virtualConsole.sendTo(console, { omitJSDOMErrors: true });
        const dom = new JSDOM(htmlText, { virtualConsole });
        const doc = dom.window.document;
        let cleanedMerchandise: any = null;
        let queueToken: any = null;
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
        const sessionToken = typedSerializedSessionToken ? typedSerializedSessionToken.content.replace(/[\"]/g, "") : "";
        if (!typedSerializedSessionToken) {
            return null
        }
        const checkoutInput: CheckoutInput = {
            queueToken,
            sessionToken,
            merchandise: cleanedMerchandise
        }
        return transformCheckoutInput(
            checkoutInput, userInfo, customAttributes
        );
    } catch (error) {
        console.error("Error parsing HTML or extracting data:", error);
        return null;
    }
}
