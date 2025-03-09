# API Specification

## Endpoint: `/api/abandon`

**Method:** POST

**Description:** Processes a batch of abandoned cart recovery requests.

**Request Payload:**

```json
{
	"abandonments": [
		{
			"shopUrl": "https://example.myshopify.com",
			"items": [
				{
					"variantId": "1234567890",
					"quantity": "1"
				},
				{
					"variantId": "0987654321",
					"quantity": "2"
				}
			],
			"userInfo": {
				"firstName": "John",
				"lastName": "Doe",
				"phone": "+918688868526",
				"address": "123 Main St",
				"city": "Koramangala",
				"postalCode": "560095",
				"state": "Karnataka",
				"email": "john.doe@example.com"
			},
			"customAttributes": {
				"abandonedRecoveryUrl": "https://example.myshopify.com/checkout/recovery?token=abc123",
				"cartToken": "abc123",
				"fbclid": "IwAR1234567890",
				"utmMedium": "email",
				"utmCampaign": "abandoned_cart",
				"utmContent": "recovery_email",
				"utmSource": "shopify"
			}
		}
	]
}
```

**Response:**

**Success (200 OK):**

```json
{
	"message": "All abandonments processed successfully"
}
```

**Error (400 Bad Request):**

```json
{
	"error": "Invalid request body"
}
```

**Error (500 Internal Server Error):**

```json
{
	"error": "Internal Server Error"
}
```

**Details:**

- The endpoint expects a JSON payload with an `abandonments` array.
- Each element in the `abandonments` array represents an individual abandoned cart recovery request.
- Each request requires a `shopUrl`, an array of `items`, and `userInfo`.
- The `shopUrl` should be a valid Shopify store URL.
- The `items` array should contain objects with `variantId` and `quantity`.
- The `userInfo` object should contain customer information required for checkout.
- Mandatory fields in `userInfo` for now are: `address`, `firstName`, `city`, `postalCode`, `email`, `zoneCode`, and `phone`.
- The `zoneCode` field can be automatically derived from the `state` field if not provided explicitly.
- The `customAttributes` object is optional and can contain the following fields:
  - `abandonedRecoveryUrl`: A URL that can be used to recover the abandoned cart
  - `cartToken`: The cart token associated with the abandoned cart
  - `fbclid`: Facebook click identifier
  - `utmMedium`: UTM medium parameter
  - `utmCampaign`: UTM campaign parameter
  - `utmContent`: UTM content parameter
  - `utmSource`: UTM source parameter
- The server processes abandonments in batches. The batch size is defined by `BATCH_SIZE` and is set to 50 by default.
- Failed requests are added to a retry queue and processed later with a maximum of 3 retry attempts.
- If provided, the `customAttributes` values will be included in the checkout note and as custom attributes in the Shopify checkout (with keys converted to snake_case).
- Missing mandatory fields are reported via Slack notifications.
- Sensitive data (phone numbers, emails, addresses, recovery URLs) is masked in logs and notifications for privacy.

## State to ZoneCode Quick Reference

The API automatically maps state names to their corresponding zone codes if the `zoneCode` is not provided. Here's a quick reference for state to zone code mapping:

| State                       | Zone Code | Alternates          |
| --------------------------- | --------- | ------------------- |
| Andaman and Nicobar Islands | AN        | andaman and nicobar |
| Andhra Pradesh              | AP        |                     |
| Arunachal Pradesh           | AR        |                     |
| Assam                       | AS        |                     |
| Bihar                       | BR        |                     |
| Chandigarh                  | CH        |                     |
| Chhattisgarh                | CG        | chattisgarh, ct     |
| Dadra and Nagar Haveli      | DN        |                     |
| Daman and Diu               | DD        |                     |
| Delhi                       | DL        |                     |
| Goa                         | GA        |                     |
| Gujarat                     | GJ        |                     |
| Haryana                     | HR        |                     |
| Himachal Pradesh            | HP        |                     |
| Jammu and Kashmir           | JK        |                     |
| Jharkhand                   | JH        |                     |
| Karnataka                   | KA        |                     |
| Kerala                      | KL        |                     |
| Ladakh                      | LA        |                     |
| Lakshadweep                 | LD        |                     |
| Madhya Pradesh              | MP        |                     |
| Maharashtra                 | MH        |                     |
| Manipur                     | MN        |                     |
| Meghalaya                   | ML        |                     |
| Mizoram                     | MZ        |                     |
| Nagaland                    | NL        |                     |
| Odisha                      | OR        | od, orissa          |
| Puducherry                  | PY        |                     |
| Punjab                      | PB        |                     |
| Rajasthan                   | RJ        |                     |
| Sikkim                      | SK        |                     |
| Tamil Nadu                  | TN        |                     |
| Telangana                   | TS        |                     |
| Tripura                     | TR        |                     |
| Uttar Pradesh               | UP        |                     |
| Uttarakhand                 | UK        |                     |
| West Bengal                 | WB        |                     |
