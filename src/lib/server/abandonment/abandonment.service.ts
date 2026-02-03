/**
 * Abandonment Service
 * Main orchestration service for processing cart abandonments
 * This is the public API - all other modules are internal implementation details
 *
 * Updated to use Cart Permalink approach (simplified from GraphQL-based flow)
 */

import { v4 as uuidv4 } from 'uuid';
import type { UserInfo, CartItem, AbandonmentInfo } from '$lib/types';
import { AbandonmentProcessingError } from '$lib/types/error.types';
import { maskSensitiveData } from '../utils';
import { getLogger } from '../logger';
import { getAlertService } from '../alerts/alert.service';
import { AlertType, AlertSeverity } from '../alerts/alert.types';
import { getMetricsService } from '../metrics';
import { MetricNames, LabelNames } from '../metrics/metrics.types';
import { addToQueue, getAbandonmentQueue, getRetryQueue } from './queue.manager';
import { processQueue, setCheckoutCreatorFn } from './batch.processor';
import { buildCartPermalink, visitCartPermalink } from '../shopify';
import type { VisitResult } from '../shopify';
import { extractCheckoutData, validateExtractedData, ExtractionError } from '../shopify/proposal-data.extractor';
import { buildProposalPayload, buildProposalHeaders } from '../shopify/proposal-payload.builder';
import { getProposalClient } from '../shopify/proposal.client';
import type { ProposalResponse } from '../shopify/proposal.client';
import { getCollectClient } from '../shopify/collect.client';
import { getUserAgentProvider } from '../useragent';
import { getHttpClient } from '../http';

const logger = getLogger('abandonment-service');
const alertService = getAlertService();
const metrics = getMetricsService();

// Initialize Proposal metrics
const proposalRequestsCounter = metrics.counter({
	name: MetricNames.PROPOSAL_REQUESTS,
	description: 'Total Proposal API requests'
});

const proposalSuccessCounter = metrics.counter({
	name: MetricNames.PROPOSAL_SUCCESS,
	description: 'Successful Proposal API requests'
});

const proposalFailedCounter = metrics.counter({
	name: MetricNames.PROPOSAL_FAILED,
	description: 'Failed Proposal API requests'
});

const proposalDurationHistogram = metrics.histogram({
	name: MetricNames.PROPOSAL_DURATION,
	description: 'Proposal API request duration',
	unit: 'seconds'
});

const proposalExtractionSuccessCounter = metrics.counter({
	name: MetricNames.PROPOSAL_EXTRACTION_SUCCESS,
	description: 'Successful data extractions from checkout HTML'
});

const proposalExtractionFailedCounter = metrics.counter({
	name: MetricNames.PROPOSAL_EXTRACTION_FAILED,
	description: 'Failed data extractions from checkout HTML'
});

const proposalPayloadSizeHistogram = metrics.histogram({
	name: MetricNames.PROPOSAL_PAYLOAD_SIZE,
	description: 'Proposal API payload size',
	unit: 'bytes',
	boundaries: [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000]
});

/**
 * Flag to track if queue processing is currently running
 */
let isProcessing = false;

/**
 * Create a Shopify checkout using Cart Permalink approach
 *
 * This is the core function that converts an abandonment into a Shopify checkout.
 *
 * Flow:
 * 1. Build cart permalink URL with all parameters
 * 2. Visit the permalink URL
 * 3. Extract checkout token from response
 * 4. Validate success (200 + token found)
 *
 * @param shopUrl - The shop URL
 * @param items - Cart items
 * @param userInfo - User information
 * @param customAttributes - Custom attributes for tracking
 * @param requestId - Unique request ID for tracking
 * @returns Response status code (200 for success) or null on failure
 */
export async function createShopifyCheckout(
	shopUrl: string,
	items: CartItem[],
	userInfo: UserInfo,
	customAttributes?: AbandonmentInfo['customAttributes'],
	requestId?: string
): Promise<number | null> {
	const reqId = requestId || uuidv4();

	// Create request-specific cookie jar key for isolation
	// Each abandonment gets its own cookie jar to prevent session leakage
	const cookieJarKey = `${shopUrl}:${reqId}`;

	logger.info('Creating Shopify checkout via Cart Permalink', {
		requestId: reqId,
		shop: shopUrl,
		cookieJarKey,
		itemCount: items.length,
		hasEmail: !!userInfo.email,
		hasAddress: !!userInfo.address,
		hasCustomAttributes: !!customAttributes && Object.keys(customAttributes).length > 0
	});

	try {
		// Step 1: Build cart permalink URL
		const permalinkResult = buildCartPermalink({
			shopUrl,
			items,
			userInfo,
			customAttributes,
			retryCount: 0
		});

		if (!permalinkResult.hasAllRequiredFields) {
			logger.error('Cart permalink missing required fields', new Error('Missing required fields'), {
				requestId: reqId,
				missingFields: permalinkResult.missingFields
			});

			// Send alert for missing fields
			await alertService.sendAlert({
				type: AlertType.ABANDONMENT_FAILED,
				severity: AlertSeverity.ERROR,
				title: 'Cart Permalink Missing Required Fields',
				message: `Missing required fields: ${permalinkResult.missingFields?.join(', ')}`,
				context: {
					shop: shopUrl,
					requestId: reqId,
					...maskSensitiveData({
						shopUrl,
						items,
						userInfo,
						retryCount: 0,
						customAttributes
					})
				}
			});

			return null;
		}

		logger.debug('Built cart permalink', {
			requestId: reqId,
			urlLength: permalinkResult.url.length,
			itemsPath: permalinkResult.itemsPath
		});

		// Get user agent with platform info for request
		const userAgentProvider = getUserAgentProvider();
		const { userAgent, platform } = userAgentProvider.getUserAgentWithPlatform(shopUrl);

		logger.debug('Generated user agent', {
			requestId: reqId,
			platform: platform.platform,
			isMobile: platform.isMobile
		});

		// Step 2: Visit cart permalink URL (with request-specific cookie jar)
		const visitResult: VisitResult = await visitCartPermalink(permalinkResult.url, {
			shopUrl,
			cookieJarKey,
			timeout: 15000
		});

		// Step 3: Check if we got HTTP 200 response
		if (visitResult.statusCode === 200 && visitResult.htmlBody) {
			logger.info('Cart permalink visit successful', {
				requestId: reqId,
				shop: shopUrl,
				statusCode: visitResult.statusCode,
				checkoutUrl: visitResult.checkoutUrl,
				responseTime: visitResult.responseTime
			});

			// Step 4: Extract checkout data for Proposal API (NEW)

			try {
				// Extract data from checkout.html with fallback phone from original request
				const extractionResult = extractCheckoutData(
					visitResult.htmlBody,
					reqId,
					userInfo.email,
					userInfo.phone // Fallback phone from original abandonment request
				);

				const extractedData = extractionResult.data;

				// Send alert if we had to use fallback contact data
				if (extractionResult.usedFallbackPhone || extractionResult.usedFallbackEmail) {
					const missingContact: string[] = [];
					if (extractionResult.usedFallbackPhone) missingContact.push('phone');
					if (extractionResult.usedFallbackEmail) missingContact.push('email');

					await alertService.sendAlert({
						type: AlertType.ABANDONMENT_FAILED,
						severity: AlertSeverity.WARN,
						title: 'Contact Data Missing from HTML - Using Fallback',
						message: `HTML extraction did not find ${missingContact.join(' or ')}. Using original request data as fallback.`,
						context: {
							shop: shopUrl,
							requestId: reqId,
							checkoutToken: extractedData.checkoutToken.substring(0, 8),
							missingContact,
							usedFallbackPhone: extractionResult.usedFallbackPhone,
							usedFallbackEmail: extractionResult.usedFallbackEmail
						}
					});
				}

				// Validate extracted data
				const missingFields = validateExtractedData(extractedData);
				if (missingFields.length > 0) {
					logger.error('Checkout data extraction incomplete', new Error('Missing critical fields'), {
						requestId: reqId,
						shop: shopUrl,
						missingFields
					});

					// Track extraction failure metric
					proposalExtractionFailedCounter.inc({
						[LabelNames.SHOP]: shopUrl,
						[LabelNames.ERROR_TYPE]: 'missing_fields'
					});

					// Send alert for extraction failure
					await alertService.sendAlert({
						type: AlertType.ABANDONMENT_FAILED,
						severity: AlertSeverity.ERROR,
						title: 'Proposal Data Extraction Failed',
						message: `Missing critical fields: ${missingFields.join(', ')}`,
						context: {
							shop: shopUrl,
							requestId: reqId,
							checkoutToken: extractedData.checkoutToken.substring(0, 8),
							missingFields
						}
					});

					return null;
				}

				// Track successful extraction
				proposalExtractionSuccessCounter.inc({
					[LabelNames.SHOP]: shopUrl
				});

				// Step 5: Make progressive /api/collect calls to simulate user interaction
				// This helps avoid bot detection by simulating browser behavior BEFORE checkout submission
				const collectClient = getCollectClient();

				// Normalize shop URL (remove https:// if present, we'll add it in collect client)
				const normalizedShopUrl = shopUrl.replace(/^https?:\/\//, '');

				try {
					await collectClient.makeProgressiveCalls(`https://${normalizedShopUrl}`, {
						checkoutUrl: visitResult.checkoutUrl!,
						requestId: reqId,
						cookieJarKey,
						userAgent,
						minDelay: 1000,
						maxDelay: 5000,
						continueOnError: true // Continue even if collect calls fail
					});

					logger.info('Progressive /api/collect calls completed', {
						requestId: reqId,
						shop: shopUrl
					});
				} catch (error) {
					// Log but don't fail the entire request if collect calls fail
					logger.warn('Progressive /api/collect calls failed', {
						requestId: reqId,
						shop: shopUrl,
						error: error instanceof Error ? error.message : String(error)
					});
				}

				// Step 6: Build Proposal API payload
				const proposalPayload = buildProposalPayload(extractedData, items, customAttributes, reqId);
				const proposalHeaders = buildProposalHeaders(extractedData, shopUrl, userAgent, platform);

				const payloadSize = JSON.stringify(proposalPayload).length;

				logger.info('Proposal payload built successfully', {
					requestId: reqId,
					shop: shopUrl,
					payloadSize
				});

				// Track payload size
				proposalPayloadSizeHistogram.record(payloadSize, {
					[LabelNames.SHOP]: shopUrl
				});

				// Step 7: Call Proposal API
				const proposalClient = getProposalClient();

				// Track Proposal request
				proposalRequestsCounter.inc({
					[LabelNames.SHOP]: shopUrl
				});

				const proposalResponse: ProposalResponse = await proposalClient.makeRequest(
					shopUrl,
					proposalPayload,
					proposalHeaders,
					{
						requestId: reqId,
						cookieJarKey, // Reuse cookies from Cart Permalink visit
						timeout: 30000
					}
				);

				// Track Proposal duration
				proposalDurationHistogram.record(proposalResponse.responseTime / 1000, {
					[LabelNames.SHOP]: shopUrl,
					[LabelNames.SUCCESS]: proposalResponse.success.toString(),
					[LabelNames.STATUS_CODE]: proposalResponse.statusCode.toString()
				});

				// Step 8: Handle Proposal API response
				if (proposalResponse.success) {
					logger.info('Proposal API request successful - checkout finalized', {
						requestId: reqId,
						shop: shopUrl,
						checkoutToken: extractedData.checkoutToken.substring(0, 8),
						responseTime: proposalResponse.responseTime
					});

					// Track success
					proposalSuccessCounter.inc({
						[LabelNames.SHOP]: shopUrl
					});

					return 200;
				} else {
					// Proposal API failed
					const error = proposalResponse.error!;
					logger.warn('Proposal API request failed', {
						requestId: reqId,
						shop: shopUrl,
						errorType: error.type,
						errorMessage: error.message,
						retryable: error.retryable,
						statusCode: proposalResponse.statusCode,
						responseTime: proposalResponse.responseTime
					});

					// Check if this is a UnprocessableTermViolation (non-retryable)
					const isTermViolation = error.message.includes('UnprocessableTermViolation');

					if (isTermViolation) {
						// UnprocessableTermViolation - send alert immediately and don't retry
						logger.error('UnprocessableTermViolation - permanent failure', new Error(error.message), {
							requestId: reqId,
							shop: shopUrl,
							errorDetails: error.details
						});

						// Track permanent failure
						proposalFailedCounter.inc({
							[LabelNames.SHOP]: shopUrl,
							[LabelNames.ERROR_TYPE]: error.type,
							retryable: 'false',
							[LabelNames.STATUS_CODE]: proposalResponse.statusCode.toString()
						});

						// Send alert immediately for UnprocessableTermViolation
						await alertService.sendAlert({
							type: AlertType.ABANDONMENT_FAILED,
							severity: AlertSeverity.ERROR,
							title: 'Term Violation - Restricted Product',
							message: `UnprocessableTermViolation: Shopify rejected the checkout due to term violations (restricted/prohibited products). ${error.message}`,
							context: {
								shop: shopUrl,
								requestId: reqId,
								checkoutToken: extractedData.checkoutToken.substring(0, 8),
								errorType: error.type,
								retryable: false,
								statusCode: proposalResponse.statusCode,
								errorDetails: error.details
							}
						});

						// Throw non-retryable error - batch processor will NOT retry
						throw new AbandonmentProcessingError(
							error.message,
							false, // NOT retryable
							'UNPROCESSABLE_TERM_VIOLATION',
							{
								shop: shopUrl,
								requestId: reqId,
								checkoutToken: extractedData.checkoutToken.substring(0, 8)
							},
							error.details
						);
					}

					// Retryable failure (HTTP non-200, timeouts, network errors) - don't alert yet
					logger.warn('Retryable failure - will retry', {
						requestId: reqId,
						shop: shopUrl,
						errorType: error.type,
						errorMessage: error.message,
						retryable: error.retryable,
						statusCode: proposalResponse.statusCode
					});

					// Throw retryable error - batch processor WILL retry
					throw new AbandonmentProcessingError(
						error.message,
						true, // Retryable
						'PROPOSAL_API_ERROR',
						{
							shop: shopUrl,
							requestId: reqId,
							errorType: error.type,
							statusCode: proposalResponse.statusCode
						}
					);
				}
			} catch (error) {
				if (error instanceof ExtractionError) {
					logger.error('Checkout data extraction failed', error, {
						requestId: reqId,
						shop: shopUrl,
						field: error.field
					});

					// Track extraction failure metric
					proposalExtractionFailedCounter.inc({
						[LabelNames.SHOP]: shopUrl,
						[LabelNames.ERROR_TYPE]: 'extraction_error',
						field: error.field
					});

					// Send alert for extraction error
					await alertService.sendAlert({
						type: AlertType.ABANDONMENT_FAILED,
						severity: AlertSeverity.ERROR,
						title: 'Proposal Data Extraction Error',
						message: error.message,
						context: {
							shop: shopUrl,
							requestId: reqId,
							field: error.field,
						}
					});

					return null;
				}

				// Re-throw unexpected errors
				throw error;
			}
		} else {
			// Failure scenario
			logger.warn('Shopify checkout creation failed', {
				requestId: reqId,
				shop: shopUrl,
				statusCode: visitResult.statusCode,
				errorReason: visitResult.errorReason,
				responseTime: visitResult.responseTime
			});

			// Send alert for non-200 or missing token
			if (visitResult.statusCode === 404) {
				// Don't retry 404 errors (invalid variant)
				await alertService.sendAlert({
					type: AlertType.ABANDONMENT_FAILED,
					severity: AlertSeverity.ERROR,
					title: 'Invalid Variant ID (HTTP 404)',
					message: visitResult.errorReason || 'Variant not found',
					context: {
						shop: shopUrl,
						requestId: reqId,
						statusCode: visitResult.statusCode,
						items
					}
				});
			} else if (visitResult.statusCode >= 500) {
				// Server error - should retry
				logger.warn('Server error, will retry', {
					requestId: reqId,
					statusCode: visitResult.statusCode
				});
			} else if (visitResult.statusCode === 200 && !visitResult.checkoutToken) {
				// Token not found - possibly out of stock
				await alertService.sendAlert({
					type: AlertType.ABANDONMENT_FAILED,
					severity: AlertSeverity.WARN,
					title: 'Checkout Token Not Found',
					message: 'Possibly out of stock or product unavailable',
					context: {
						shop: shopUrl,
						requestId: reqId,
						...maskSensitiveData({
							shopUrl,
							items,
							userInfo,
							retryCount: 0,
							customAttributes
						})
					}
				});
			}

			return null;
		}
	} catch (err: any) {
		// Re-throw AbandonmentProcessingError to preserve retryable flag
		if (err instanceof AbandonmentProcessingError) {
			throw err;
		}

		logger.error(
			'Shopify checkout creation failed with error',
			err instanceof Error ? err : new Error(String(err)),
			{ requestId: reqId, shop: shopUrl }
		);

		return null;
	} finally {
		// Clean up request-specific cookie jar to prevent memory leaks
		// This ensures each abandonment has isolated cookies that are discarded after processing
		const httpClient = getHttpClient();
		httpClient.clearCookies(cookieJarKey);

		logger.debug('Cookie jar cleaned up', {
			requestId: reqId,
			cookieJarKey
		});
	}
}

/**
 * Process a batch of abandonments
 * This is the main public API for the abandonment service
 * @param abandonments - Array of abandonment items to process
 */
export async function processAbandonments(abandonments: AbandonmentInfo[]): Promise<void> {
	const batchId = uuidv4().substring(0, 8); // Generate a unique batch ID for tracking
	logger.info('Processing new batch of abandonments', {
		batchId,
		abandonmentCount: abandonments.length
	});

	// Inject checkout creation function into batch processor
	setCheckoutCreatorFn(createShopifyCheckout);

	// Add unique IDs to abandonments and add to queue
	const abandonsWithIds = abandonments.map((abandonment) => ({
		...abandonment,
		retryCount: 0,
		id: uuidv4()
	}));

	addToQueue(abandonsWithIds);
	logger.info('Added abandonments to queue', {
		batchId,
		queuedCount: abandonments.length
	});

	// Only start processing if not already running
	if (!isProcessing) {
		isProcessing = true;
		logger.info('Starting queue processing', { batchId });

		try {
			// Process abandonment queue
			await processQueue(getAbandonmentQueue(), 'abandonment');

			// Process retry queue if it has items
			const retryQueue = getRetryQueue();
			if (retryQueue.length > 0) {
				logger.info('Processing retry queue', {
					batchId,
					retryQueueSize: retryQueue.length
				});
				await processQueue(retryQueue, 'retry');
			}
		} catch (error) {
			logger.error(
				'Error processing queues',
				error instanceof Error ? error : new Error(String(error)),
				{ batchId }
			);
		} finally {
			isProcessing = false;
			logger.info('Queue processing completed', { batchId });
		}
	} else {
		logger.info('Queue already processing, items queued for next cycle', { batchId });
	}
}
