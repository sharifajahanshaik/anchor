import type { SlackAbandonedCheckoutAlertParams, AbandonmentInfo } from "$lib/types";
import dotenv from 'dotenv';
import { logData, SeverityNumber } from './instrumentation';

dotenv.config();

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function chunkArray<T>(array: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

/**
 * Masks sensitive data in an abandonment object for security purposes
 * @param abandonment - The abandonment info object containing sensitive data
 * @returns A deep copy of the abandonment object with sensitive data masked
 */
export function maskSensitiveData(abandonment: AbandonmentInfo): AbandonmentInfo {
    // Create a deep copy to avoid modifying the original object
    const maskedAbandonment = JSON.parse(JSON.stringify(abandonment)) as AbandonmentInfo;
    const userInfo = maskedAbandonment.userInfo;

    // Mask phone number (leave first two and last two digits)
    if (userInfo.phone && userInfo.phone.length > 4) {
        const firstTwo = userInfo.phone.substring(0, 2);
        const lastTwo = userInfo.phone.substring(userInfo.phone.length - 2);
        const maskedPart = '*'.repeat(userInfo.phone.length - 4);
        userInfo.phone = `${firstTwo}${maskedPart}${lastTwo}`;
    }

    // Mask email (leave first 2 chars and last 5 chars)
    if (userInfo.email && userInfo.email.length > 7) {
        const firstTwo = userInfo.email.substring(0, 2);
        const lastFive = userInfo.email.substring(userInfo.email.length - 5);
        const maskedPart = '*'.repeat(Math.max(1, userInfo.email.length - 7));
        userInfo.email = `${firstTwo}${maskedPart}${lastFive}`;
    }

    // Mask address (leave first 2 and last 3 chars)
    if (userInfo.address && userInfo.address.length > 5) {
        const firstTwo = userInfo.address.substring(0, 2);
        const lastThree = userInfo.address.substring(userInfo.address.length - 3);
        const maskedPart = '*'.repeat(userInfo.address.length - 5);
        userInfo.address = `${firstTwo}${maskedPart}${lastThree}`;
    }

    // We don't mask abandonedRecoveryUrl as per requirements

    return maskedAbandonment;
}

/**
 * Sends logs to the Crane logging service using OpenTelemetry
 * @param params - Parameters for the log entry
 * @param params.id - Unique identifier for the log entry
 * @param params.phone - Phone number associated with the log
 * @param params.payload - Additional payload data to include in the log
 * @param params.shopUrl - Shop URL associated with the log
 * @param params.event - Event type, either "request" or "response" (defaults to "request")
 * @returns Promise resolving to void
 */
export async function sendLogsToCrane(params: {
    id: string;
    phone: string;
    payload: string;
    shopUrl: string;
    event?: "request" | "response";
}): Promise<void> {
    const {
        id,
        phone,
        payload,
        shopUrl,
        event = "request"
    } = params;

    // Use OpenTelemetry to send logs
    logData(
        'abandonment', // Service identifier
        'analytics',  // Log message body
        SeverityNumber.INFO, // Severity level
        {
            event,
            id,
            phone,
            shopUrl,
            payload,
            telemetry_sdk_name: 'abandonment'
        }
    );
}

export async function sendSlackAbandonedCheckoutAlert(params: SlackAbandonedCheckoutAlertParams): Promise<Response> {
    const {
        shopUrl,
        errorReason,
        additionalData,
        isTest = false,
        userIdsToMention = ["U06BPLC172N", "U0403DP9FJ6"],
        webhookUrl = SLACK_WEBHOOK_URL
    } = params;

    const testIndicator = isTest ? " | TEST" : "";

    const userMentions = userIdsToMention.map(id => `<@${id}>`).join(" ");

    const payload = {
        text: `Abandoned checkout creation failed.${testIndicator}`,
        blocks: [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: `🚨 Abandoned Checkout Alert!${testIndicator}`
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Shop URL:*\n${shopUrl}`
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Error Reason:*\n${errorReason}`
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Additional data:*\n${additionalData}`
                }
            },
            {
                type: "divider"
            },
            {
                type: "context",
                elements: [
                    {
                        type: "mrkdwn",
                        text: `Please investigate the issue. \n\n${userMentions}`
                    }
                ]
            }
        ]
    };

    if (!webhookUrl) {
        throw new Error("Slack webhook URL is not defined. Please set the SLACK_WEBHOOK_URL environment variable.");
    }

    return fetch(webhookUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });
}
