import { Tor } from 'tor-control-ts';

const torConfig = {
    host: '127.0.0.1',
    port: 9051,
    password: 'swaroop'
};

export const tor = new Tor(torConfig);

/**
 * Get the current Tor exit node IP address
 */
async function getTorExitIP(): Promise<string | null> {
    try {
        // Use node-fetch with SOCKS proxy support
        const fetch = (await import('node-fetch')).default;
        const { SocksProxyAgent } = await import('socks-proxy-agent');

        const agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
        const response = await fetch('https://api.ipify.org?format=json', {
            // @ts-ignore - node-fetch supports agent
            agent
        });

        const data = await response.json() as { ip: string };
        return data.ip;
    } catch (error) {
        console.log('[TOR:IP:ERROR] Failed to get Tor exit IP:', error);
        return null;
    }
}

/**
 * Get geolocation info for an IP address using ip-api.com (free, no key required)
 */
async function getIPLocation(ip: string): Promise<{ country: string; countryCode: string; city: string } | null> {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city`);
        const data = await response.json() as { status: string; country: string; countryCode: string; city: string };

        if (data.status === 'success') {
            return {
                country: data.country,
                countryCode: data.countryCode,
                city: data.city
            };
        }
        return null;
    } catch (error) {
        console.log('[TOR:LOCATION:ERROR] Failed to get IP location:', error);
        return null;
    }
}

/**
 * Sends the NEWNYM signal to Tor to request a new identity.
 * After rotation, logs the new exit node location.
 */
export async function renewTorIdentity(): Promise<string | null> {
    try {
        await tor.connect();
        await tor.signalNewnym();

        // Wait a moment for the circuit to be established
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Get the new exit IP
        const exitIP = await getTorExitIP();

        if (exitIP) {
            console.log(`[TOR:EXIT_IP] New Tor exit IP: ${exitIP}`);

            // Get location info
            const location = await getIPLocation(exitIP);
            if (location) {
                console.log(`[TOR:LOCATION] Exit node location: ${location.city}, ${location.country} (${location.countryCode})`);
            } else {
                console.log('[TOR:LOCATION] Could not determine exit node location');
            }
        } else {
            console.log('[TOR:EXIT_IP] Could not retrieve exit IP');
        }

        return 'Renewed Tor identity successfully';
    } catch (error) {
        console.log('Failed to signal NEWNYM:', error);
        return null
    }
}
