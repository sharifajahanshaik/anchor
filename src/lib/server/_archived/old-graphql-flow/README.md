# Old GraphQL-Based Abandonment Flow (Archived)

This directory contains the **old implementation** of the cart abandonment system that used Shopify's GraphQL API. This approach has been **replaced** with the simpler **Cart Permalink** approach.

## Why This Was Archived

The old GraphQL-based flow was complex and involved **10+ HTTP requests** per abandonment:

1. Fetch cart page
2. Parse HTML for session tokens and merchandise data
3. Fetch actions.js file
4. Extract Proposal GraphQL query ID
5. Make 5 progressive `/api/collect` calls
6. Make 3 GraphQL Proposal requests (phone-only, full-info, final)
7. Parse complex GraphQL responses

This resulted in:
- **30+ seconds** per abandonment
- **~2,300 lines** of code
- Complex error handling
- High maintenance burden
- Difficult to debug

## New Cart Permalink Approach

The new implementation uses Shopify's official **Cart Permalink API**:

1. Build cart permalink URL with all parameters
2. Visit the URL (1 HTTP request)
3. Extract checkout token from HTML/cookies
4. Validate success (200 + token found)

This results in:
- **<5 seconds** per abandonment
- **~700 lines** of code (-66% reduction)
- Simple error handling
- Easy to maintain
- Easy to debug

## Archived Files

### Shopify Clients
- **cart.client.ts** - Cart page fetching with cookie management
- **collect.client.ts** - Progressive `/api/collect` call orchestration
- **proposal.client.ts** - GraphQL Proposal request handling
- **actionsjs.client.ts** - Actions.js fetching and query ID extraction

### Service Layer
- **shopify.service.ts** - High-level orchestrator for the complete GraphQL flow

### Utilities
- **shopify.ts** - GraphQL variable transformation functions:
  - `transformCheckoutInputPhoneOnly()` - Phone-only transformation
  - `transformCheckoutInput()` - Full user info transformation
  - `makeMerchandiseProposalRequest()` - GraphQL request executor

- **html-parser.ts** - HTML parsing utilities:
  - `extractDataFromHTML()` - Main HTML extraction
  - `extractActionsJsUrl()` - Extract actions.js URL
  - `fetchActionsJs()` - Fetch and parse actions.js
  - `convertMerchandise()` - Merchandise data conversion

## Migration Date

These files were archived on: **January 23, 2026**

## If You Need to Reference This Code

You can safely **delete** this directory. The new Cart Permalink implementation is complete and production-ready.

If you need to understand how the old flow worked:
1. See [CART_PERMALINK_IMPLEMENTATION_GUIDE.md](../../../../../CART_PERMALINK_IMPLEMENTATION_GUIDE.md)
2. See [FUNCTIONALITY_COMPARISON.md](../../../../../FUNCTIONALITY_COMPARISON.md)

## New Implementation Location

The new Cart Permalink implementation is at:
- [src/lib/server/shopify/cart-permalink.builder.ts](../../shopify/cart-permalink.builder.ts)
- [src/lib/server/shopify/cart-permalink.visitor.ts](../../shopify/cart-permalink.visitor.ts)
- [src/lib/server/abandonment/abandonment.service.ts](../../abandonment/abandonment.service.ts)
