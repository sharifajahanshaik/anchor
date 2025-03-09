import { Tor } from 'tor-control-ts';

const torConfig = {
    host: '127.0.0.1',
    port: 9051,
    password: 'swaroop'
};

export const tor = new Tor(torConfig);

/**
 * Sends the NEWNYM signal to Tor to request a new identity.
 * Since signalNewnym() returns void, we return a success message.
 */
export async function renewTorIdentity(): Promise<string | null> {
    try {
        await tor.connect();
        await tor.signalNewnym();
        return 'Renewed Tor identity successfully';
    } catch (error) {
        console.log('Failed to signal NEWNYM:', error);
        return null
    }
}
