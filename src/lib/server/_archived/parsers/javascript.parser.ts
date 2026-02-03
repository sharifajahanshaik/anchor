/**
 * JavaScript Parser
 *
 * Specialized parser for extracting data from JavaScript code:
 * - GraphQL query IDs from actions.js files
 * - Persisted query definitions
 * - Query type and name extraction
 * - Pattern matching for structured data
 *
 * @module parsers/javascript.parser
 */

import { getLogger } from '../../logger';

const logger = getLogger('javascript-parser');

/**
 * Query information
 */
export interface QueryInfo {
	/** Query ID (hash) */
	id: string;

	/** Query type (query, mutation, subscription) */
	type: string;

	/** Query name */
	name: string;
}

/**
 * JavaScript Parser class
 *
 * Handles parsing of JavaScript code to extract structured data
 */
export class JavaScriptParser {
	/**
	 * Extract Proposal query ID from actions.js content
	 *
	 * Looks for pattern: id: "867b72fb...", type: "query", name: "Proposal"
	 *
	 * @param jsContent - JavaScript file content
	 * @param context - Optional context for logging
	 * @returns Query ID or null if not found
	 *
	 * @example
	 * ```typescript
	 * const parser = getJavaScriptParser();
	 *
	 * const queryId = parser.extractProposalQueryId(actionsJsContent, {
	 *   requestId: 'req-123'
	 * });
	 *
	 * if (queryId) {
	 *   console.log(`Proposal Query ID: ${queryId}`);
	 * }
	 * ```
	 */
	extractProposalQueryId(
		jsContent: string,
		context: { requestId?: string; [key: string]: any } = {}
	): string | null {
		const requestId = context.requestId || 'unknown';

		try {
			// Looking for: id: "867b72fb...", type: "query", name: "Proposal"
			const proposalMatch = jsContent.match(
				/id:\s*"([^"]+)"[^}]*type:\s*"query"[^}]*name:\s*"Proposal"/
			);

			if (proposalMatch) {
				const queryId = proposalMatch[1];
				logger.debug('Extracted Proposal query ID', {
					requestId,
					queryId,
					queryLength: queryId.length
				});
				return queryId;
			}

			logger.warn('Could not find Proposal query ID in JavaScript', {
				requestId,
				contentLength: jsContent.length
			});

			return null;
		} catch (error) {
			logger.error(
				'Error extracting Proposal query ID',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId }
			);
			return null;
		}
	}

	/**
	 * Extract all query information from JavaScript content
	 *
	 * Finds all GraphQL query definitions with id, type, and name
	 *
	 * @param jsContent - JavaScript file content
	 * @param context - Optional context for logging
	 * @returns Array of query information
	 *
	 * @example
	 * ```typescript
	 * const queries = parser.extractAllQueries(actionsJsContent);
	 *
	 * queries.forEach(query => {
	 *   console.log(`${query.name}: ${query.id}`);
	 * });
	 * ```
	 */
	extractAllQueries(
		jsContent: string,
		context: { requestId?: string; [key: string]: any } = {}
	): QueryInfo[] {
		const requestId = context.requestId || 'unknown';

		try {
			const queries: QueryInfo[] = [];

			// Pattern to match: id: "...", type: "...", name: "..."
			const queryPattern = /id:\s*"([^"]+)"[^}]*type:\s*"(query|mutation|subscription)"[^}]*name:\s*"([^"]+)"/g;

			let match;
			while ((match = queryPattern.exec(jsContent)) !== null) {
				queries.push({
					id: match[1],
					type: match[2],
					name: match[3]
				});
			}

			logger.debug('Extracted all queries from JavaScript', {
				requestId,
				queryCount: queries.length,
				queryNames: queries.map((q) => q.name).join(', ')
			});

			return queries;
		} catch (error) {
			logger.error(
				'Error extracting queries from JavaScript',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId }
			);
			return [];
		}
	}

	/**
	 * Find query ID by name
	 *
	 * @param jsContent - JavaScript file content
	 * @param queryName - Name of the query to find
	 * @param context - Optional context for logging
	 * @returns Query ID or null if not found
	 *
	 * @example
	 * ```typescript
	 * const checkoutQueryId = parser.findQueryIdByName(actionsJsContent, 'Checkout');
	 * ```
	 */
	findQueryIdByName(
		jsContent: string,
		queryName: string,
		context: { requestId?: string; [key: string]: any } = {}
	): string | null {
		const requestId = context.requestId || 'unknown';

		try {
			// Escape special regex characters in query name
			const escapedName = queryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

			// Pattern to match: id: "...", type: "...", name: "QueryName"
			const pattern = new RegExp(
				`id:\\s*"([^"]+)"[^}]*type:\\s*"(?:query|mutation|subscription)"[^}]*name:\\s*"${escapedName}"`,
				'i'
			);

			const match = jsContent.match(pattern);

			if (match) {
				const queryId = match[1];
				logger.debug('Found query ID by name', {
					requestId,
					queryName,
					queryId
				});
				return queryId;
			}

			logger.debug('Query not found by name', {
				requestId,
				queryName
			});

			return null;
		} catch (error) {
			logger.error(
				'Error finding query ID by name',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId, queryName }
			);
			return null;
		}
	}

	/**
	 * Check if JavaScript content contains a specific query
	 *
	 * @param jsContent - JavaScript file content
	 * @param queryName - Name of the query to check
	 * @returns True if query exists
	 *
	 * @example
	 * ```typescript
	 * if (parser.hasQuery(actionsJsContent, 'Proposal')) {
	 *   // Query exists
	 * }
	 * ```
	 */
	hasQuery(jsContent: string, queryName: string): boolean {
		return this.findQueryIdByName(jsContent, queryName) !== null;
	}

	/**
	 * Validate that JavaScript content contains GraphQL query definitions
	 *
	 * @param jsContent - JavaScript file content
	 * @returns True if contains query definitions
	 *
	 * @example
	 * ```typescript
	 * if (parser.isValidActionsJs(jsContent)) {
	 *   // Valid actions.js file
	 * }
	 * ```
	 */
	isValidActionsJs(jsContent: string): boolean {
		try {
			// Check for query definition pattern
			return /id:\s*"[^"]+"\s*,\s*type:\s*"(?:query|mutation|subscription)"\s*,\s*name:\s*"[^"]+"/.test(
				jsContent
			);
		} catch {
			return false;
		}
	}

	/**
	 * Extract query type by ID
	 *
	 * @param jsContent - JavaScript file content
	 * @param queryId - Query ID to find
	 * @param context - Optional context for logging
	 * @returns Query type or null if not found
	 *
	 * @example
	 * ```typescript
	 * const type = parser.extractQueryTypeById(actionsJsContent, 'abc123');
	 * // Returns: 'query' or 'mutation' or 'subscription'
	 * ```
	 */
	extractQueryTypeById(
		jsContent: string,
		queryId: string,
		context: { requestId?: string; [key: string]: any } = {}
	): string | null {
		const requestId = context.requestId || 'unknown';

		try {
			// Escape special regex characters in query ID
			const escapedId = queryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

			// Pattern to match: id: "queryId", type: "query|mutation|subscription"
			const pattern = new RegExp(
				`id:\\s*"${escapedId}"[^}]*type:\\s*"(query|mutation|subscription)"`,
				'i'
			);

			const match = jsContent.match(pattern);

			if (match) {
				const queryType = match[1];
				logger.debug('Found query type by ID', {
					requestId,
					queryId,
					queryType
				});
				return queryType;
			}

			logger.debug('Query type not found by ID', {
				requestId,
				queryId
			});

			return null;
		} catch (error) {
			logger.error(
				'Error extracting query type by ID',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId, queryId }
			);
			return null;
		}
	}

	/**
	 * Extract query name by ID
	 *
	 * @param jsContent - JavaScript file content
	 * @param queryId - Query ID to find
	 * @param context - Optional context for logging
	 * @returns Query name or null if not found
	 *
	 * @example
	 * ```typescript
	 * const name = parser.extractQueryNameById(actionsJsContent, 'abc123');
	 * // Returns: 'Proposal'
	 * ```
	 */
	extractQueryNameById(
		jsContent: string,
		queryId: string,
		context: { requestId?: string; [key: string]: any } = {}
	): string | null {
		const requestId = context.requestId || 'unknown';

		try {
			// Escape special regex characters in query ID
			const escapedId = queryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

			// Pattern to match: id: "queryId", ... name: "QueryName"
			const pattern = new RegExp(`id:\\s*"${escapedId}"[^}]*name:\\s*"([^"]+)"`, 'i');

			const match = jsContent.match(pattern);

			if (match) {
				const queryName = match[1];
				logger.debug('Found query name by ID', {
					requestId,
					queryId,
					queryName
				});
				return queryName;
			}

			logger.debug('Query name not found by ID', {
				requestId,
				queryId
			});

			return null;
		} catch (error) {
			logger.error(
				'Error extracting query name by ID',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId, queryId }
			);
			return null;
		}
	}

	/**
	 * Get complete query info by ID
	 *
	 * @param jsContent - JavaScript file content
	 * @param queryId - Query ID to find
	 * @param context - Optional context for logging
	 * @returns Complete query information or null
	 *
	 * @example
	 * ```typescript
	 * const queryInfo = parser.getQueryInfo(actionsJsContent, 'abc123');
	 * if (queryInfo) {
	 *   console.log(`${queryInfo.name} (${queryInfo.type}): ${queryInfo.id}`);
	 * }
	 * ```
	 */
	getQueryInfo(
		jsContent: string,
		queryId: string,
		context: { requestId?: string; [key: string]: any } = {}
	): QueryInfo | null {
		const requestId = context.requestId || 'unknown';

		try {
			// Escape special regex characters in query ID
			const escapedId = queryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

			// Pattern to match: id: "queryId", type: "...", name: "..."
			const pattern = new RegExp(
				`id:\\s*"${escapedId}"[^}]*type:\\s*"(query|mutation|subscription)"[^}]*name:\\s*"([^"]+)"`,
				'i'
			);

			const match = jsContent.match(pattern);

			if (match) {
				const queryInfo: QueryInfo = {
					id: queryId,
					type: match[1],
					name: match[2]
				};

				logger.debug('Found complete query info', {
					requestId,
					...queryInfo
				});

				return queryInfo;
			}

			logger.debug('Query info not found by ID', {
				requestId,
				queryId
			});

			return null;
		} catch (error) {
			logger.error(
				'Error getting query info',
				error instanceof Error ? error : new Error(String(error)),
				{ requestId, queryId }
			);
			return null;
		}
	}
}

/**
 * Singleton instance
 */
let javascriptParserInstance: JavaScriptParser | null = null;

/**
 * Get the JavaScript parser singleton instance
 *
 * @returns JavaScriptParser instance
 *
 * @example
 * ```typescript
 * import { getJavaScriptParser } from '$lib/server/parsers';
 *
 * const parser = getJavaScriptParser();
 *
 * const queryId = parser.extractProposalQueryId(actionsJsContent);
 * if (queryId) {
 *   console.log(`Proposal Query ID: ${queryId}`);
 * }
 * ```
 */
export function getJavaScriptParser(): JavaScriptParser {
	if (!javascriptParserInstance) {
		javascriptParserInstance = new JavaScriptParser();
	}
	return javascriptParserInstance;
}

/**
 * Reset the JavaScript parser instance (for testing)
 * @internal
 */
export function resetJavaScriptParser(): void {
	javascriptParserInstance = null;
}
