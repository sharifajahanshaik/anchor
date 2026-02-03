/**
 * User Agent Module
 *
 * Exports user agent provider service and related utilities
 */

export {
	UserAgentProvider,
	getUserAgentProvider,
	resetUserAgentProvider
} from './useragent.provider';

export type {
	UserAgentProviderConfig,
	PlatformInfo
} from './useragent.provider';
