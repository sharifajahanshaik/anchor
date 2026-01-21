import fetchCookie from 'fetch-cookie';
import fetch from 'node-fetch';
import randomUseragent from 'random-useragent';
import { CookieJar } from 'tough-cookie';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { v4 as uuidv4 } from 'uuid';
import { makeMerchandiseProposalRequest } from './shopify';
import { extractDataFromHTML, fetchActionsJs } from './html-parser';
import { renewTorIdentity } from './tor';
import type { UserInfo, CartItem, AbandonmentInfo } from '$lib/types';
import { sleep, sendSlackAbandonedCheckoutAlert, maskSensitiveData, sendLogsToCrane } from './index';
import { env } from '$env/dynamic/private';

const BATCH_SIZE = 50;
const ENABLE_TOR = env.ENABLE_TOR === 'true';
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

        if (ENABLE_TOR) {
            try {
                console.log(`[TOR:START] Renewing Tor identity for ${queue === abandonmentQueue ? 'abandonment' : 'retry'} queue...`);
                await renewTorIdentity();
                console.log(`[TOR:END] Tor identity renewed successfully`);
                await sleep(2000);
            } catch (e) {
                console.log(`[TOR:ERROR] Failed to renew Tor identity for ${queue === abandonmentQueue ? 'abandonment' : 'retry'} queue:`, e);
            }
        } else {
            console.log(`[TOR:DISABLED] Tor is disabled, using direct connection`);
        }

        console.log(`[BATCH:PROCESS] Processing ${currentBatch.length} abandonments in parallel...`);

        await Promise.allSettled(
            currentBatch.map(async (abandonment, index) => {
                const { shopUrl, items, userInfo, customAttributes, retryCount } = abandonment;

                // Check if only phone is present (phone-only mode)
                const hasPhone = !!userInfo.phone;
                const hasEmail = !!userInfo.email;
                const hasAddress = !!(userInfo.address && userInfo.city && userInfo.postalCode);
                const hasZoneCode = !!userInfo.zoneCode;
                const isPhoneOnlyMode = hasPhone && hasZoneCode && !hasEmail && !hasAddress;

                if (isPhoneOnlyMode) {
                    console.log(`[ITEM:PHONE_ONLY:${index}] Phone-only mode detected, using minimal request`);
                    // Process with phone-only mode (matches HAR first request)
                    if (queue === retryQueue && retryCount < MAX_RETRY_LIMIT) {
                        const newRetryCount = retryCount + 1;
                        const result = await makeRequest(shopUrl, items, userInfo, customAttributes, abandonment.id, true);
                        if (result === null && newRetryCount < MAX_RETRY_LIMIT) {
                            retryQueue.push({
                                ...abandonment,
                                retryCount: newRetryCount
                            });
                        } else if (result === null) {
                            console.log(`[ITEM:RETRY:FAILED:${index}] Max retries reached, sending alert`);
                            sendSlackAbandonedCheckoutAlert({
                                shopUrl,
                                errorReason: "Cannot retrieve checkout token after multiple retries (phone-only mode)",
                                additionalData: JSON.stringify(maskSensitiveData(abandonment)),
                                isTest: false
                            }).catch(err => {
                                console.log(`[ITEM:SLACK:ERROR:${index}] Failed to send Slack notification:`, err);
                            });
                        }
                    } else if (queue === abandonmentQueue) {
                        const result = await makeRequest(shopUrl, items, userInfo, customAttributes, abandonment.id, true);
                        if (result === null) {
                            console.log(`[ITEM:RETRY:QUEUE:${index}] Adding to retry queue for first retry`);
                            retryQueue.push({
                                ...abandonment,
                                retryCount: 1
                            });
                        }
                    }
                    return;
                }

                // Check for mandatory fields in UserInfo (full mode)
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
                    const result = await makeRequest(shopUrl, items, userInfo, customAttributes, abandonment.id, false);
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
                    const result = await makeRequest(shopUrl, items, userInfo, customAttributes, abandonment.id, false);
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

/**
 * Generate a random delay between min and max milliseconds
 * Simulates human-like timing variability
 */
function getRandomDelay(min: number = 1000, max: number = 10000): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Makes progressive /api/collect calls matching browser behavior
 * This function simulates real user interaction by making 5 calls with progressive feature flags
 * @param shopUrl - The shop URL
 * @param checkoutUrl - The checkout URL to use as referer
 * @param userAgent - The user agent string
 * @param torProxy - The Tor proxy URL (null to disable Tor)
 * @param fetchWithCookies - The fetch function with cookies
 * @param requestId - The request ID for logging
 */
async function makeProgressiveCollectCalls(
    shopUrl: string,
    checkoutUrl: string,
    userAgent: string,
    torProxy: string | null,
    fetchWithCookies: any,
    requestId: string
): Promise<void> {
    // Define the 5 progressive flag states matching HAR file exactly
    const collectSequence = [
        { wd: false, ua: false, cf: true, be: true, nm: false, nc: false, ka: false, sa: true, ta: true, pt: false, mp: true, sd: true },  // #1: Initial (page load)
        { wd: false, ua: false, cf: true, be: true, nm: false, nc: false, ka: false, sa: true, ta: true, pt: true, mp: true, sd: true },   // #2: Pointer detected
        { wd: false, ua: false, cf: true, be: true, nm: false, nc: false, ka: true, sa: true, ta: true, pt: true, mp: true, sd: true },    // #3: Keyboard detected
        { wd: false, ua: false, cf: true, be: true, nm: false, nc: true, ka: true, sa: true, ta: true, pt: true, mp: true, sd: true },     // #4: Network detected
        { wd: false, ua: false, cf: true, be: true, nm: true, nc: true, ka: true, sa: true, ta: true, pt: true, mp: true, sd: true }       // #5: Final (all enabled)
    ];

    for (let i = 0; i < collectSequence.length; i++) {
        const collectUrl = `${shopUrl}/api/collect`;
        const collectBody = {
            v: 1,
            s: collectSequence[i],
            r: "change"
        };

        try {
            console.log(`[COLLECT:PROGRESSIVE:${requestId}] Call #${i + 1}/5`);
            const collectResponse = await fetchWithCookies(collectUrl, {
                method: 'POST',
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-GB,en;q=0.9',
                    'content-type': 'application/json',
                    'origin': new URL(shopUrl).origin,
                    'priority': 'u=1, i',
                    'referer': checkoutUrl,
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                    'user-agent': userAgent
                },
                body: JSON.stringify(collectBody),
                ...(torProxy ? { agent: new SocksProxyAgent(torProxy) } : {})
            } as any);

            console.log(`[COLLECT:PROGRESSIVE:${requestId}] Call #${i + 1}/5 Response: ${collectResponse.status}`);

            // Wait random delay (1-10 seconds) before next call
            if (i < collectSequence.length - 1) {
                const delay = getRandomDelay(1000, 10000);
                console.log(`[COLLECT:PROGRESSIVE:${requestId}] Waiting ${delay}ms before next call`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        } catch (error) {
            console.log(`[COLLECT:PROGRESSIVE:ERROR:${requestId}] Call #${i + 1}/5 failed:`, error instanceof Error ? error.message : String(error));
            // Continue with other calls even if one fails
        }
    }
}

export async function makeRequest(
    shopUrl: string,
    items: CartItem[],
    userInfo: UserInfo,
    customAttributes?: AbandonmentInfo['customAttributes'],
    id?: string,
    isPhoneOnly: boolean = false
): Promise<number | null> {
    // Log the start of the request
    const requestId = id || uuidv4();

    if (isPhoneOnly) {
        console.log(`[REQUEST:MODE:${requestId}] Using PHONE-ONLY mode (minimal HAR request structure)`);
    } else {
        console.log(`[REQUEST:MODE:${requestId}] Using FULL mode (complete address & email)`);
    }

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
    console.log(`[USER_AGENT:${requestId}] Using User Agent: ${userAgent}`);
    const jar = new CookieJar();
    const fetchWithCookies = fetchCookie(fetch, jar);
    const options = {
        method: 'GET',
        headers: { 'User-Agent': userAgent },
        ...(ENABLE_TOR ? { agent: new SocksProxyAgent(torProxy) } : {}),
        redirect: 'follow' as RequestRedirect,
    } as any;

    try {
        console.log(`[REQUEST:FETCH:${requestId}] Fetching cart page`);
        console.log(`[COOKIE:JAR:${requestId}] Created new cookie jar for session`);
        const response = await fetchWithCookies(url, options);
        // console.log(`👛 Checkout Creation response: ${response.status}`);

        if (response.status !== 200) {
            console.log(`[REQUEST:ERROR:${requestId}] Non-200 response, adding to retry queue`);
            return null;
        }

        // Capture the final URL after redirects to use as referer
        const checkoutUrl = response.url || url;

        // Log cookies received from checkout page
        const cookies = await jar.getCookies(shopUrl);
        console.log(`[COOKIE:RECEIVED:${requestId}] Received ${cookies.length} cookie(s) from checkout page`);
        if (cookies.length > 0) {
            console.log(`[COOKIE:DETAILS:${requestId}] Cookie names: ${cookies.map(c => c.key).join(', ')}`);
        }

        const htmlBody = await response.text();
        const extractedData = await extractDataFromHTML(htmlBody, userInfo, customAttributes, isPhoneOnly);

        if (extractedData === "MERCHANDISE_OUT_OF_STOCK") {
            return handleOutOfStockMerchandise(requestId, shopUrl, items, userInfo, customAttributes);
        } else if (extractedData === null) {
            console.log(`[REQUEST:TOKEN:${requestId}] Token not found, adding to retry queue`);
            return null;
        }

        const { payloadVariableObject, actionsJsUrl, buildId } = extractedData;

        // Fetch actions.js if URL was found
        let proposalQueryId: string | null = null;
        if (actionsJsUrl) {
            proposalQueryId = await fetchActionsJs(shopUrl, actionsJsUrl, userAgent);
            if (proposalQueryId) {
                console.log(`[REQUEST:PROPOSAL_ID:${requestId}] Proposal Query ID: ${proposalQueryId}`);
            }
        }

        // Call progressive /api/collect endpoints (5 calls matching browser behavior)
        console.log(`[COLLECT:PROGRESSIVE:${requestId}] Starting progressive /api/collect sequence`);
        await makeProgressiveCollectCalls(shopUrl, checkoutUrl, userAgent, ENABLE_TOR ? torProxy : null, fetchWithCookies, requestId);
        console.log(`[COLLECT:PROGRESSIVE:${requestId}] Completed progressive /api/collect sequence`);

        // Random delay (1-10 seconds) before making Proposal request
        const delayBeforeProposal = getRandomDelay(1000, 10000);
        console.log(`[DELAY:BEFORE_PROPOSAL:${requestId}] Waiting ${delayBeforeProposal}ms before Proposal request`);
        await new Promise(resolve => setTimeout(resolve, delayBeforeProposal));

        // Make initial Proposal request for BOTH phone-only and full mode
        console.log(`[PROPOSAL:INIT:${requestId}] Making initial Proposal request (${isPhoneOnly ? 'phone-only mode - empty fields' : 'full mode - no phone/email'})`);

        // Create initial Proposal with minimal data
        const initialPayloadVars = JSON.parse(JSON.stringify(payloadVariableObject)); // Deep clone

        if (isPhoneOnly) {
            // Phone-only mode: Remove phone from buyerIdentity (matches HAR Proposal #1)
            if (initialPayloadVars.buyerIdentity && initialPayloadVars.buyerIdentity.phone) {
                delete initialPayloadVars.buyerIdentity.phone;
            }
        } else {
            // Full mode: Remove phone and email from buyerIdentity for initial request
            if (initialPayloadVars.buyerIdentity) {
                if (initialPayloadVars.buyerIdentity.phone) {
                    delete initialPayloadVars.buyerIdentity.phone;
                }
                if (initialPayloadVars.buyerIdentity.email) {
                    delete initialPayloadVars.buyerIdentity.email;
                }
            }
        }

        try {
            await makeMerchandiseProposalRequest(
                shopUrl,
                initialPayloadVars,
                proposalQueryId!,
                buildId,
                ENABLE_TOR ? torProxy : null,
                items,
                userInfo,
                checkoutUrl,
                jar,
                userAgent
            );

            console.log(`[PROPOSAL:INIT:${requestId}] Initial Proposal completed successfully`);

            // Random delay (1-10 seconds) before final Proposal
            const delayBeforeFinal = getRandomDelay(1000, 10000);
            console.log(`[PROPOSAL:INIT:${requestId}] Waiting ${delayBeforeFinal}ms before final Proposal`);
            await new Promise(resolve => setTimeout(resolve, delayBeforeFinal));
        } catch (error) {
            console.log(`[PROPOSAL:INIT:ERROR:${requestId}] Initial Proposal failed:`, error instanceof Error ? error.message : String(error));
            // Continue anyway - final Proposal might still work
        }

        // Now make the final Proposal request (with phone for phone-only mode, or with full details for full mode)
        // BUT WITHOUT customAttributes if they exist (we'll send them separately)
        console.log(`[PROPOSAL:FINAL:${requestId}] Making final Proposal request`);
        console.log(`[COOKIE:PASS:${requestId}] Passing cookie jar to proposal request`);

        // Clone the payload and remove customAttributes for the final proposal
        const finalPayloadVars = JSON.parse(JSON.stringify(payloadVariableObject)); // Deep clone

        // Check if customAttributes object has any non-null values
        const hasCustomAttributes = customAttributes && Object.values(customAttributes).some(val => val !== null);

        if (hasCustomAttributes) {
            const attrCount = Object.values(customAttributes).filter(val => val !== null).length;
            console.log(`[PROPOSAL:FINAL:${requestId}] CustomAttributes detected (${attrCount} attributes), will send separately`);
            // Set customAttributes to empty array AND clear message for final proposal
            if (finalPayloadVars.note) {
                finalPayloadVars.note.customAttributes = [];
                finalPayloadVars.note.message = null;  // Clear breeze URL from final proposal
            }
        }

        const proposalResponse = await makeMerchandiseProposalRequest(
            shopUrl,
            finalPayloadVars,
            proposalQueryId!,
            buildId,
            ENABLE_TOR ? torProxy : null,
            items,
            userInfo,
            checkoutUrl,
            jar,  // Pass the cookie jar to reuse session cookies
            userAgent  // Use same User Agent throughout the session
        );

        // If customAttributes exist, make a third proposal request to add them incrementally
        if (hasCustomAttributes) {
            console.log(`[PROPOSAL:FINAL:${requestId}] Final Proposal completed, preparing customAttributes proposal`);

            // Random delay (1-10 seconds) before customAttributes Proposal
            const delayBeforeCustomAttrs = getRandomDelay(1000, 10000);
            console.log(`[PROPOSAL:CUSTOM_ATTRS:${requestId}] Waiting ${delayBeforeCustomAttrs}ms before customAttributes Proposal`);
            await new Promise(resolve => setTimeout(resolve, delayBeforeCustomAttrs));

            const attrCount = Object.values(customAttributes).filter(val => val !== null).length;
            console.log(`[PROPOSAL:CUSTOM_ATTRS:${requestId}] Making customAttributes Proposal with ${attrCount} attributes`);

            // Use the original payload with customAttributes
            await makeMerchandiseProposalRequest(
                shopUrl,
                payloadVariableObject,  // This has the customAttributes
                proposalQueryId!,
                buildId,
                ENABLE_TOR ? torProxy : null,
                items,
                userInfo,
                checkoutUrl,
                jar,  // Reuse the same session
                userAgent
            );

            console.log(`[PROPOSAL:CUSTOM_ATTRS:${requestId}] CustomAttributes Proposal completed successfully`);
        }

        // Print comprehensive summary of all retrieved values
        console.log("\n" + "=".repeat(60));
        console.log("📋 COMPLETE CHECKOUT DATA SUMMARY");
        console.log("=".repeat(60));
        console.log(`🔗 Shop URL: ${shopUrl}`);
        console.log(`🛒 Checkout URL: ${checkoutUrl}`);
        console.log(`📦 Cart Items: ${items.map(i => `${i.variantId}:${i.quantity}`).join(', ')}`);
        console.log(`🎫 Session Token: ${payloadVariableObject.sessionInput?.sessionToken || 'N/A'}`);
        console.log(`⏳ Queue Token: ${payloadVariableObject.queueToken || 'N/A'}`);
        console.log(`🎬 Actions.js URL: ${actionsJsUrl || 'NOT FOUND'}`);
        console.log(`🔑 Proposal Query ID: ${proposalQueryId || 'NOT FOUND'}`);
        console.log(`👤 User Email: ${userInfo.email}`);
        console.log(`📍 Delivery Address: ${userInfo.city}, ${userInfo.zoneCode} ${userInfo.postalCode}`);
        console.log("=".repeat(60) + "\n");

        // Send logs to Crane if there are errors in the proposal response
        const errors = proposalResponse?.data?.session?.negotiate?.errors;

        // Log all errors if present
        if (Array.isArray(errors) && errors.length > 0) {
            console.log(`[REQUEST:ERRORS:${requestId}] Proposal response contains ${errors.length} error(s):`);
            errors.forEach((error, index) => {
                console.log(`  Error ${index + 1}:`, JSON.stringify(error, null, 2));
            });

            // Check for invalid postal code errors and send Slack alert
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
        } else {
            console.log(`[REQUEST:SUCCESS:${requestId}] No errors in proposal response`);
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
