/**
 * @deprecated Logger service stub for archived code compatibility
 * Use $lib/server/logger instead
 */

export function getLogger(_name?: string): any {
	return {
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {}
	};
}
