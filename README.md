# Abandonment Cart Recovery

This project is designed to recover abandoned carts by automatically creating checkouts on Shopify. It uses a queue system to process abandonments, a Tor proxy for anonymity, and interacts with the Shopify API.

## Functionality

The core logic for processing abandonments resides in `src/lib/server/utils/abandon.ts`. It uses a queue system (`abandonmentQueue` and `retryQueue`) to manage abandonments and retries. The `processAbandonments` function adds abandonments to the queue, and the `processAbandonmentQueue` function processes them in batches. Tor identities are renewed periodically for anonymity. The `makeRequest` function creates a checkout URL on Shopify, extracts data from the HTML response, and then makes a merchandise proposal request to Shopify.

## API Endpoint

The project exposes a POST endpoint at `/api/abandon`. This endpoint accepts a JSON payload with an array of abandonments, as defined by the `AbandonmentRequest` type.

```typescript
type AbandonmentRequest = {
	abandonments: AbandonmentInfo[];
};
```

Each `AbandonmentInfo` object should contain the following:

```typescript
type AbandonmentInfo = {
	shopUrl: string;
	items: {
		variantId: string;
		quantity: string;
	}[];
	userInfo: UserInfo;
	customAttributes?: {
		abandonedRecoveryUrl: string | null;
		cartToken: string | null;
		fbclid: string | null;
		utmMedium: string | null;
		utmCampaign: string | null;
		utmContent: string | null;
		utmSource: string | null;
	} | null;
	retryCount: number;
};
```

The `UserInfo` object should contain the following:

```typescript
interface UserInfo {
	firstName: string | null;
	lastName: string | null;
	phone: string;
	countryCode: string | null;
	address: string | null;
	city: string | null;
	postalCode: string | null;
	zoneCode: string | null;
	email: string | null;
	state: string | null;
}

Note: The `zoneCode` field can be automatically derived from the `state` field if not provided explicitly. See the State to ZoneCode mapping in the API.md file for details.
```

## Features

- **Queue System**: Processes abandonments in batches and manages retries.
- **Tor Integration**: Uses Tor for anonymity, rotating identities periodically.
- **Error Handling**: Sends Slack notifications for errors with masked sensitive data.
- **Custom Attributes Support**: Includes custom attributes like recovery URLs, cart tokens, and UTM parameters in checkout notes and custom attributes.
- **Data Masking**: Masks sensitive information like phone numbers, emails, and addresses in logs and notifications.
- **State to ZoneCode Mapping**: Automatically maps state names to their corresponding zone codes if not provided explicitly.

## Dependencies

Key dependencies include:

- `tor-control-ts`: For interacting with Tor.
- `node-fetch`: For making HTTP requests.
- `fetch-cookie`: For managing cookies with `node-fetch`.
- `tough-cookie`: For robust cookie handling.
- `socks-proxy-agent`: For using Tor as a proxy.
- `random-useragent`: For generating random user agents.
- `jsdom`: For parsing HTML content.

## Setup

1. **Install Tor:** Ensure Tor is installed and running on your system.
2. **Configure Tor Control Port:** The Tor control port is configured in `src/lib/server/utils/tor.ts`. Ensure the password matches your Tor configuration.
3. **Install Dependencies:** Run `npm install` to install project dependencies.
4. **Build:** Run `npm run build` to build the project.
5. **Run:** Run `npm run dev` to start the development server.

## API Spec

See API.md for details.
