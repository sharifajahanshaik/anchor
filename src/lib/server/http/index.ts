/**
 * HTTP Module
 *
 * Exports HTTP client and related utilities with cookie jar support
 *
 * Features:
 * - Automatic metrics collection
 * - Automatic alerting for errors
 * - Cookie jar integration (tough-cookie + fetch-cookie)
 * - Manual cookie support
 * - Timeout handling
 * - User-Agent injection
 * - Error classification
 */

export { HttpClient, getHttpClient, resetHttpClient } from './http.client';
export type { HttpRequestOptions, HttpResponse } from './http.client';

// Re-export cookie-related types for convenience
export type { CookieInfo } from '../cookies';
