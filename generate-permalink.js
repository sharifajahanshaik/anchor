// Generate cart permalink from abandonment payload

const abandonment = {
  shopUrl: 'https://d2cstore.in',
  items: [
    {
      variantId: '44265753051368',
      quantity: '1'
    }
  ],
  userInfo: {
    firstName: 'Swaroop',
    lastName: 'Vama',
   phone: '8688864546',
    countryCode: 'IN',
    address: 'Koramangala, 2nd block, 444',
    city: 'Koramangala',
    postalCode: '560095',
    zoneCode: 'KA',
    email: 'swaroopvamanew@gmail.com'
  }
};


// Build the permalink using the same logic as the code
function getCallingCode(countryCode) {
  const callingCodes = {
    'IN': '91',
    'US': '1',
    'GB': '44',
    'AU': '61',
    'CA': '1',
    'AE': '971',
    'SG': '65',
    'MY': '60',
    'PK': '92',
    'BD': '880',
    'LK': '94',
    'NP': '977'
  };
  return callingCodes[countryCode.toUpperCase()] || countryCode;
}

function normalizeShopUrl(shopUrl) {
  let normalized = shopUrl.replace(/\/$/, '');
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }
  if (normalized.startsWith('http://')) {
    normalized = normalized.replace('http://', 'https://');
  }
  return normalized;
}

function buildItemsPath(items) {
  return items.map((item) => `${item.variantId}:${item.quantity}`).join(',');
}

function buildCartPermalink(abandonment) {
  const { shopUrl, items, userInfo, customAttributes } = abandonment;
  const baseUrl = normalizeShopUrl(shopUrl);
  const itemsPath = buildItemsPath(items);
  const params = new URLSearchParams();

  // Add email
  if (userInfo.email) {
    params.append('checkout[email]', userInfo.email);
  }

  // Add phone (top-level with + prefix)
  if (userInfo.phone && userInfo.countryCode) {
    const callingCode = getCallingCode(userInfo.countryCode);
    params.append('checkout[phone]', `+${callingCode}${userInfo.phone}`);
  }

  // Add shipping address fields
  if (userInfo.firstName) {
    params.append('checkout[shipping_address][first_name]', userInfo.firstName);
  }
  if (userInfo.lastName) {
    params.append('checkout[shipping_address][last_name]', userInfo.lastName);
  }
  if (userInfo.phone && userInfo.countryCode) {
    const callingCode = getCallingCode(userInfo.countryCode);
    params.append('checkout[shipping_address][phone]', `${callingCode}${userInfo.phone}`);
  }
  if (userInfo.address) {
    params.append('checkout[shipping_address][address1]', userInfo.address);
  }
  if (userInfo.city) {
    params.append('checkout[shipping_address][city]', userInfo.city);
  }
  if (userInfo.zoneCode) {
    params.append('checkout[shipping_address][province]', userInfo.zoneCode);
  }
  if (userInfo.countryCode) {
    params.append('checkout[shipping_address][country]', userInfo.countryCode);
  }
  if (userInfo.postalCode) {
    params.append('checkout[shipping_address][zip]', userInfo.postalCode);
  }

  // Add tracking attributes if present
  if (customAttributes) {
    for (const [key, value] of Object.entries(customAttributes)) {
      if (value !== null && value !== undefined) {
        params.append(`attributes[${key}]`, value);
      }
    }
  }

  const queryString = params.toString();
  const url = queryString ? `${baseUrl}/cart/${itemsPath}?${queryString}` : `${baseUrl}/cart/${itemsPath}`;

  return {
    url,
    itemsPath,
    hasAllRequiredFields: true,
    missingFields: []
  };
}

const result = buildCartPermalink(abandonment);
console.log('\n=== CART PERMALINK GENERATED ===\n');
console.log('Cart Permalink URL:');
console.log(result.url);
console.log('\nItems Path:', result.itemsPath);
console.log('Has All Required Fields:', result.hasAllRequiredFields);
console.log('\n');
