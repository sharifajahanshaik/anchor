import fetchCookie from 'fetch-cookie';
import fetch from 'node-fetch';
import randomUseragent from 'random-useragent';
import { CookieJar } from 'tough-cookie';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { v4 as uuidv4 } from 'uuid';
import { makeMerchandiseProposalRequest } from './shopify';
import { extractDataFromHTML } from './html-parser';
import { renewTorIdentity } from './tor';
import type { UserInfo, CartItem, AbandonmentInfo } from '$lib/types';
import { sleep, sendSlackAbandonedCheckoutAlert, maskSensitiveData, sendLogsToCrane } from './index';

const BATCH_SIZE = 50;
const torProxy = 'socks5://127.0.0.1:9050';

const abandonmentQueue: AbandonmentInfo[] = [];
const MAX_RETRY_LIMIT = 3;
const retryQueue: AbandonmentInfo[] = [];

let isProcessing = false;

// Track the current batch being processed to recover in case of interruption
let currentBatch: AbandonmentInfo[] = [];
let currentQueue: AbandonmentInfo[] | null = null;

async function processQueue(queue: AbandonmentInfo[]): Promise<void> {
    console.log(`[QUEUE:START] Starting to process queue with ${queue.length} items (${queue === abandonmentQueue ? 'abandonment' : 'retry'} queue)`);
    // Set the current queue reference for recovery purposes
    currentQueue = queue;

    while (queue.length > 0) {
        // Store the current batch for potential recovery
        currentBatch = queue.splice(0, BATCH_SIZE);
        console.log(`[BATCH:START] Processing batch of ${currentBatch.length} items from ${queue === abandonmentQueue ? 'abandonment' : 'retry'} queue...`);

        try {
            console.log(`[TOR:START] Renewing Tor identity for ${queue === abandonmentQueue ? 'abandonment' : 'retry'} queue...`);
            await renewTorIdentity();
            console.log(`[TOR:END] Tor identity renewed successfully`);
            await sleep(2000);
        } catch (e) {
            console.log(`[TOR:ERROR] Failed to renew Tor identity for ${queue === abandonmentQueue ? 'abandonment' : 'retry'} queue:`, e);
        }

        console.log(`[BATCH:PROCESS] Processing ${currentBatch.length} abandonments in parallel...`);

        await Promise.allSettled(
            currentBatch.map(async (abandonment, index) => {
                const { shopUrl, items, userInfo, customAttributes, retryCount } = abandonment;
                // Check for mandatory fields in UserInfo
                const mandatoryFields = ['address', 'firstName', 'city', 'postalCode', 'email', 'zoneCode'];
                const missingFields = mandatoryFields.filter(field => !userInfo[field as keyof UserInfo]);

                if (missingFields.length > 0) {
                    console.log(`[ITEM:ERROR:${index}] Mandatory fields missing in UserInfo: ${missingFields.join(', ')}`);
                    sendSlackAbandonedCheckoutAlert({
                        shopUrl,
                        errorReason: "Mandatory fields are missing in UserInfo",
                        additionalData: JSON.stringify(maskSensitiveData(abandonment)),
                        isTest: false
                    }).catch(err => {
                        console.log(`[ITEM:SLACK:ERROR:${index}] Failed to send Slack notification:`, err);
                    });
                    console.log(`[ITEM:END:${index}] Abandonment processing skipped due to missing fields`);
                    return;
                }

                if (queue === retryQueue && retryCount < MAX_RETRY_LIMIT) {
                    const newRetryCount = retryCount + 1;
                    const result = await makeRequest(shopUrl, items, userInfo, customAttributes, abandonment.id);
                    if (result === null && newRetryCount < MAX_RETRY_LIMIT) {
                        retryQueue.push({
                            ...abandonment,
                            retryCount: newRetryCount
                        });
                    } else if (result === null) {
                        console.log(`[ITEM:RETRY:FAILED:${index}] Max retries reached, sending alert`);
                        sendSlackAbandonedCheckoutAlert({
                            shopUrl,
                            errorReason: "Cannot retrieve checkout token after multiple retries",
                            additionalData: JSON.stringify(maskSensitiveData(abandonment)),
                            isTest: false
                        }).catch(err => {
                            console.log(`[ITEM:SLACK:ERROR:${index}] Failed to send Slack notification:`, err);
                        });
                    }
                } else if (queue === abandonmentQueue) {
                    const result = await makeRequest(shopUrl, items, userInfo, customAttributes, abandonment.id);
                    if (result === null) {
                        console.log(`[ITEM:RETRY:QUEUE:${index}] Adding to retry queue for first retry`);
                        retryQueue.push({
                            ...abandonment,
                            retryCount: 1
                        });
                    }
                }
            })
        );

        await sleep(1000);
    }
    console.log(`👍 ${queue === abandonmentQueue ? 'Abandonment' : 'Retry'} queue is empty.`);
}

/**
 * Handles the case when merchandise is out of stock
 * @param requestId - The unique identifier for the request
 * @param shopUrl - The URL of the shop
 * @param items - The cart items
 * @param userInfo - The user information
 * @param customAttributes - Custom attributes for the abandonment
 * @returns A success code (200) to prevent retries
 */
async function handleOutOfStockMerchandise(
    requestId: string,
    shopUrl: string,
    items: CartItem[],
    userInfo: UserInfo,
    customAttributes?: AbandonmentInfo['customAttributes']
): Promise<number> {
    console.log(`[STOCK:${requestId}] Item out of stock, not adding to retry queue`);

    // Send Slack notification
    await sendSlackAbandonedCheckoutAlert({
        shopUrl,
        errorReason: "Merchandise out of stock",
        additionalData: JSON.stringify(maskSensitiveData({
            shopUrl,
            items,
            userInfo,
            retryCount: 0,
            customAttributes
        })),
        isTest: false
    }).catch(err => {
        console.log(`[STOCK:SLACK:ERROR:${requestId}] Failed to send Slack notification:`, err);
    });

    // Send logs to Crane for out of stock items
    await sendLogsToCrane({
        id: requestId,
        phone: userInfo.phone || "",
        payload: "MERCHANDISE_OUT_OF_STOCK",
        shopUrl,
        event: "response" // Using "response" as the event type
    }).catch(err => {
        console.log(`[STOCK:CRANE:ERROR:${requestId}] Failed to send out of stock logs to Crane:`, err);
    });

    return 200; // Return success code to prevent retries
}

export async function makeRequest(
    shopUrl: string,
    items: CartItem[],
    userInfo: UserInfo,
    customAttributes?: AbandonmentInfo['customAttributes'],
    id?: string
): Promise<number | null> {
    // Log the start of the request
    const requestId = id || uuidv4();
    await sendLogsToCrane({
        id: requestId,
        phone: userInfo.phone || "",
        payload: JSON.stringify({ shopUrl, items }),
        shopUrl,
        event: "request"
    }).catch(err => {
        console.log(`[REQUEST:CRANE:ERROR:${requestId}] Failed to send request logs to Crane:`, err);
    });

    const formattedCartItems = items.map((item) => `${item.variantId}:${item.quantity}`).join(',');
    const url = `${shopUrl}/cart/${formattedCartItems}`;

    const userAgent = randomUseragent.getRandom();
    const jar = new CookieJar();
    const fetchWithCookies = fetchCookie(fetch, jar);
    const options = {
        method: 'GET',
        headers: { 'User-Agent': userAgent },
        agent: new SocksProxyAgent(torProxy),
        redirect: 'follow' as RequestRedirect,
    } as any;

    try {
        console.log(`[REQUEST:FETCH:${requestId}] Fetching cart page`);
        const response = await fetchWithCookies(url, options);
        // console.log(`👛 Checkout Creation response: ${response.status}`);

        if (response.status !== 200) {
            console.log(`[REQUEST:ERROR:${requestId}] Non-200 response, adding to retry queue`);
            return null;
        }

        const htmlBody = await response.text();
        const payloadVariableObject = await extractDataFromHTML(htmlBody, userInfo, customAttributes);

        if (payloadVariableObject === "MERCHANDISE_OUT_OF_STOCK") {
            return handleOutOfStockMerchandise(requestId, shopUrl, items, userInfo, customAttributes);
        } else if (payloadVariableObject === null) {
            console.log(`[REQUEST:TOKEN:${requestId}] Token not found, adding to retry queue`);
            return null;
        }

        const proposalResponse = await makeMerchandiseProposalRequest(shopUrl, payloadVariableObject, torProxy, items, userInfo);

        // Send logs to Crane if there are errors in the proposal response
        const errors = proposalResponse?.data?.session?.negotiate?.errors;

        // Check for invalid postal code errors
        if (Array.isArray(errors)) {
            const invalidPostalCodeError = errors.find(error =>
                error?.code === "DELIVERY_INVALID_POSTAL_CODE_FOR_ZONE" ||
                error?.code === "PAYMENTS_INVALID_POSTAL_CODE_FOR_ZONE"
            );

            if (invalidPostalCodeError) {
                // Send alert to Slack for invalid postal code
                await sendSlackAbandonedCheckoutAlert({
                    shopUrl,
                    errorReason: "Invalid postal code for zone",
                    additionalData: JSON.stringify({
                        error: invalidPostalCodeError,
                        userInfo: maskSensitiveData({
                            shopUrl,
                            items,
                            userInfo,
                            retryCount: 0,
                            customAttributes
                        }).userInfo
                    }),
                    isTest: false
                }).catch(err => {
                    console.log(`[REQUEST:SLACK:ERROR:${requestId}] Failed to send invalid postal code Slack notification:`, err);
                });
            }
        }

        await sendLogsToCrane({
            id: requestId, // Use the same ID as the request log
            phone: userInfo.phone || "",
            payload: errors ? JSON.stringify(errors) : "null",
            shopUrl,
            event: "response"
        }).catch(err => {
            console.log(`[REQUEST:CRANE:ERROR:${requestId}] Failed to send logs to Crane:`, err);
        });

        return response.status;
    } catch (err: any) {
        console.log(`[REQUEST:EXCEPTION:${requestId}] Request failed with error: ${err.message}`);
        return null;
    }
}

/**
 * Function to recover any unprocessed items if processing was interrupted
 */
async function recoverUnprocessedItems(): Promise<void> {
    if (currentBatch.length > 0 && currentQueue) {
        console.log(`[RECOVERY:START] Recovering ${currentBatch.length} unprocessed items from interrupted batch...`);

        // Send Slack notification about recovery
        try {
            console.log(`[RECOVERY:SLACK] Sending notification about queue recovery`);
            await sendSlackAbandonedCheckoutAlert({
                shopUrl: "N/A",
                errorReason: "Queue processing interrupted - Recovery triggered",
                additionalData: JSON.stringify({
                    recoveredItems: currentBatch.length,
                    queueType: currentQueue === abandonmentQueue ? 'abandonment' : 'retry',
                    timestamp: new Date().toISOString(),
                    firstItem: currentBatch.length > 0 ?
                        maskSensitiveData({
                            shopUrl: currentBatch[0].shopUrl,
                            items: currentBatch[0].items,
                            userInfo: currentBatch[0].userInfo,
                            retryCount: currentBatch[0].retryCount
                        }) : 'none'
                }),
                isTest: false
            });
            console.log(`[RECOVERY:SLACK:SUCCESS] Notification sent successfully`);
        } catch (err) {
            console.log(`[RECOVERY:SLACK:ERROR] Failed to send recovery notification:`, err);
        }

        // Add the current batch back to the beginning of the appropriate queue
        currentQueue.unshift(...currentBatch);
        console.log(`[RECOVERY:DONE] Items added back to ${currentQueue === abandonmentQueue ? 'abandonment' : 'retry'} queue`);
        // Clear the current batch
        currentBatch = [];
    } else {
        console.log(`[RECOVERY:NONE] No items to recover`);
    }
    currentQueue = null;
}

export async function processAbandonments(abandonments: AbandonmentInfo[]): Promise<void> {
    const batchId = uuidv4().substring(0, 8); // Generate a unique batch ID for tracking
    console.log(`[PROCESS:START:${batchId}] Processing new batch of ${abandonments.length} abandonments`);

    abandonments.forEach(abandonment => {
        // Generate a unique ID for each abandonment
        const id = uuidv4();
        abandonmentQueue.push({ ...abandonment, retryCount: 0, id });
    });
    console.log(`[PROCESS:QUEUE:${batchId}] Added ${abandonments.length} abandonments to the queue. Current queue size: ${abandonmentQueue.length}`);

    // Add a safety timeout to reset isProcessing if it gets stuck
    const MAX_PROCESSING_TIME = 2 * 60 * 1000; // 5 minutes

    if (!isProcessing) {
        console.log(`[PROCESS:INIT:${batchId}] Queue not currently being processed, starting processing`);
        isProcessing = true;
        console.log(`[PROCESS:FLAG:${batchId}] Set isProcessing flag to true`);

        // Set a timeout to reset isProcessing if it gets stuck
        console.log(`[PROCESS:TIMEOUT:${batchId}] Setting safety timeout for ${MAX_PROCESSING_TIME / 1000} seconds`);
        const safetyTimeout = setTimeout(async () => {
            if (isProcessing) {
                console.log(`[PROCESS:TIMEOUT:TRIGGERED:${batchId}] Queue processing timed out after ${MAX_PROCESSING_TIME / 60000} minutes. Resetting isProcessing flag.`);
                // Recover any unprocessed items before resetting
                await recoverUnprocessedItems();
                isProcessing = false;
                console.log(`[PROCESS:FLAG:${batchId}] Reset isProcessing flag to false due to timeout`);
            }
        }, MAX_PROCESSING_TIME);

        try {
            console.log(`[PROCESS:MAIN:${batchId}] Starting to process main abandonment queue`);
            await processQueue(abandonmentQueue);

            if (retryQueue.length > 0) {
                console.log(`[PROCESS:RETRY:${batchId}] Starting to process retry queue with ${retryQueue.length} items`);
                await processQueue(retryQueue);
            } else {
                console.log(`[PROCESS:RETRY:${batchId}] No items in retry queue, skipping`);
            }
        } catch (error) {
            console.log(`[PROCESS:ERROR:${batchId}] Error processing queues:`, error);
            // Recover any unprocessed items in case of error
            console.log(`[PROCESS:RECOVERY:${batchId}] Attempting to recover unprocessed items after error`);
            await recoverUnprocessedItems();
        } finally {
            console.log(`[PROCESS:CLEANUP:${batchId}] Cleaning up resources`);
            clearTimeout(safetyTimeout);
            console.log(`[PROCESS:TIMEOUT:CLEAR:${batchId}] Safety timeout cleared`);
            // Clear any remaining batch items
            currentBatch = [];
            currentQueue = null;
            isProcessing = false;
            console.log(`[PROCESS:FLAG:${batchId}] Reset isProcessing flag to false`);
            console.log(`[PROCESS:END:${batchId}] Queue processing completed`);
        }
    } else {
        console.log(`[PROCESS:BUSY:${batchId}] Queue is already being processed. Abandonments added to queue without starting new processing.`);
    }
}
