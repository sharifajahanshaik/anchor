/**
 * @deprecated Config service stub for archived code compatibility
 * Use $lib/server/config instead
 */

export function getConfig(_name?: string): any {
	return {
		shopifyApiVersion: '2024-01',
		enableDebugLogs: false
	};
}
