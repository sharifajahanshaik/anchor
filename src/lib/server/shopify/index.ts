/**
 * Shopify Module
 *
 * Cart Permalink implementation for creating abandoned checkouts
 * This replaces the old GraphQL-based flow with Shopify's official Cart Permalink API
 */

// Cart Permalink Builder
export {
	buildCartPermalink,
	normalizeShopUrl,
	buildItemsPath,
	addCheckoutParams,
	addTrackingParams,
	validateCartPermalinkData
} from './cart-permalink.builder';
export type { CartItem, CartPermalinkResult } from './cart-permalink.builder';

// Cart Permalink Visitor
export {
	visitCartPermalink,
	extractCheckoutToken,
	parseCheckoutTokenFromHTML,
	parseCheckoutTokenFromCookies
} from './cart-permalink.visitor';
export type { VisitResult, VisitOptions } from './cart-permalink.visitor';

// Proposal Data Extractor
export { extractCheckoutData, validateExtractedData, ExtractionError } from './proposal-data.extractor';
export type { CheckoutExtractedData } from './proposal-data.extractor';

// Proposal Payload Builder
export {
	buildProposalPayload,
	buildProposalHeaders,
	PROPOSAL_QUERY_ID
} from './proposal-payload.builder';
export type { ProposalPayload } from './proposal-payload.builder';

// Proposal API Client
export { getProposalClient, resetProposalClient } from './proposal.client';
export type { ProposalResponse, ProposalRequestOptions } from './proposal.client';

// Collect Client
export { getCollectClient, resetCollectClient } from './collect.client';
export type { CollectFlags, CollectRequest, CollectCallOptions } from './collect.client';
