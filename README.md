# Anchor - Checkout Automation Service

A robust e-commerce automation service that streamlines checkout processing for online stores. Built with SvelteKit and designed for reliability, scalability, and privacy.

## Overview

Anchor automates the checkout creation process, helping businesses reduce cart abandonment and improve conversion rates. The service provides a RESTful API that accepts checkout requests and processes them efficiently through a queue-based system.

## API Endpoint

The service exposes a RESTful API endpoint for processing checkout requests:

**Endpoint:** `POST /api/abandon`

**Request Format:**

```typescript
{
	abandonments: AbandonmentInfo[]
}
```

**AbandonmentInfo Schema:**

```typescript
{
	shopUrl: string;                    // Store URL
	items: {
		variantId: string;              // Product variant ID
		quantity: string;               // Item quantity
	}[];
	userInfo: {
		firstName: string | null;
		lastName: string | null;
		phone: string;                  // Required
		countryCode: string | null;
		address: string | null;
		city: string | null;
		postalCode: string | null;
		zoneCode: string | null;       // Auto-derived from state if not provided
		email: string | null;
		state: string | null;
	};
	customAttributes?: {
		// Standard tracking attributes
		abandonedRecoveryUrl: string | null;
		cartToken: string | null;
		fbclid: string | null;
		utmMedium: string | null;
		utmCampaign: string | null;
		utmContent: string | null;
		utmSource: string | null;
		breeze_checkout_url: string | null;
		breeze_abandoned_checkout_url: string | null;
		// Any additional custom key-value pairs
		[key: string]: string | null;
	} | null;
}
```

## Key Features

- **Scalable Queue System**: Efficient batch processing with automatic retry logic
- **Privacy-First Architecture**: Built-in anonymization and data protection
- **Comprehensive Error Handling**: Real-time monitoring with sanitized notifications
- **Flexible Custom Attributes**: Support for tracking parameters and custom metadata
- **Data Security**: Automatic masking of sensitive information in logs
- **Smart Data Handling**: Auto-completion of regional information (e.g., zone code derivation)
- **Type-Safe API**: Full TypeScript support with runtime validation

## Technology Stack

- **Framework**: SvelteKit
- **Runtime**: Node.js
- **Language**: TypeScript
- **Key Libraries**:
  - Network handling and session management
  - HTML parsing and data extraction
  - Queue-based processing system
  - Cookie and state management

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd anchor
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and configure the required environment variables.

4. **Build the project**
   ```bash
   npm run build
   ```

5. **Start the service**
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

The API will be available at `http://localhost:3000` (or your configured port).

## Documentation

- **API Specification**: See [API.md](API.md) for detailed API documentation
- **Type Definitions**: Located in `src/lib/types/`
- **Request Validation**: Built-in decoder functions ensure data integrity

## Usage Example

```bash
curl -X POST http://localhost:3000/api/abandon \
  -H "Content-Type: application/json" \
  -d '{
    "abandonments": [
      {
        "shopUrl": "https://example.com",
        "items": [
          {
            "variantId": "12345",
            "quantity": "1"
          }
        ],
        "userInfo": {
          "phone": "1234567890",
          "firstName": "John",
          "lastName": "Doe",
          "email": "john@example.com",
          "countryCode": "US"
        },
        "customAttributes": {
          "utmSource": "google",
          "utmMedium": "cpc"
        }
      }
    ]
  }'
```

## License

Proprietary - All Rights Reserved
