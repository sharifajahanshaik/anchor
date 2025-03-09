import type { AbandonmentRequest } from '$lib/types';
import type { RequestHandler } from '@sveltejs/kit';
import { processAbandonments } from '$lib/server/utils/abandon';
import { decodeAbandonmentRequest } from '$lib/types/decoders';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const body = await request.json();
        const abandonmentRequest: AbandonmentRequest | null = decodeAbandonmentRequest(body);

        if (!abandonmentRequest) {
            return new Response(JSON.stringify({ error: 'Invalid request body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        processAbandonments(abandonmentRequest.abandonments)

        return new Response(JSON.stringify({ message: 'All abandonments processed successfully' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
