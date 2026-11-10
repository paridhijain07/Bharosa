/**
 * PayPal Orders v2 & Webhooks Service
 * Verified against PayPal REST API Reference:
 * - POST /v1/oauth2/token
 * - POST /v2/checkout/orders
 * - POST /v2/checkout/orders/{id}/capture
 * - POST /v2/payments/captures/{capture_id}/refund
 * - POST /v1/notifications/verify-webhook-signature
 */

let cachedToken = null;
let tokenExpiresAt = 0;

function getPayPalBaseUrl() {
  return process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
}

export function isRealPayPalConfigured() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  return (
    Boolean(clientId) &&
    Boolean(secret) &&
    !clientId.startsWith('your_') &&
    !secret.startsWith('your_')
  );
}

/**
 * Obtain OAuth 2.0 Bearer access token from PayPal Sandbox
 */
export async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');

  const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PayPal OAuth failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * Create a PayPal Order (Orders v2: POST /v2/checkout/orders)
 * Links the PayPal order to the tab via purchase_units[0].custom_id = tabId
 * and reference_id / invoice_id = tab number.
 */
export async function createPayPalOrder({ tabId, tabNumber, amount, currency, description }) {
  const resolvedCurrency = currency || process.env.PAYPAL_CURRENCY || 'INR';
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;

  if (!isRealPayPalConfigured()) {
    if (process.env.DEV_MODE === 'true') {
      const mockOrderId = `PAYPAL-SANDBOX-${tabNumber}-${Date.now().toString(36).toUpperCase()}`;
      const approvalUrl = `${publicBaseUrl}/api/paypal/sandbox-checkout/${tabId}?orderId=${mockOrderId}`;
      return {
        orderId: mockOrderId,
        approvalUrl,
        status: 'CREATED',
        isSandboxFallback: true,
      };
    }
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be configured.');
  }

  const uniqueInvoiceId = `BHAROSA-TAB-${tabNumber}-${Date.now().toString(36).toUpperCase()}`;

  const buildOrderPayload = (currencyCode, val, descSuffix = '') => ({
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: `ORDER-${tabNumber}`,
        custom_id: String(tabId),
        invoice_id: `${uniqueInvoiceId}${descSuffix ? '-FX' : ''}`,
        description: `${description || `Bharosa Order #${tabNumber}`}${descSuffix}`,
        amount: {
          currency_code: currencyCode,
          value: val,
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Bharosa Stall Pay',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: `${publicBaseUrl}/api/paypal/return?tabId=${tabId}`,
          cancel_url: `${publicBaseUrl}/?cancelled=${tabId}`,
        },
      },
    },
  });

  try {
    const token = await getAccessToken();
    const formattedValue = Number(amount).toFixed(2);
    let res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(buildOrderPayload(resolvedCurrency, formattedValue)),
    });

    // Smart FX Fallback: Standard US/International PayPal Sandbox accounts often reject INR with 422 CURRENCY_NOT_SUPPORTED.
    // Automatically convert INR -> USD at the PayPal API boundary while keeping ₹ INR across the Bharosa UI & ledger.
    if (!res.ok && resolvedCurrency.toUpperCase() === 'INR') {
      const errText = await res.text();
      if (res.status === 422 || errText.includes('CURRENCY_NOT_SUPPORTED')) {
        const fxRate = Number(process.env.PAYPAL_INR_TO_USD_RATE || 84);
        const usdValue = Math.max(0.5, Number(amount) / fxRate).toFixed(2);
        res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(
            buildOrderPayload('USD', usdValue, ` (Rs.${amount} INR @ 1 USD = Rs.${fxRate})`)
          ),
        });
      } else {
        throw new Error(`PayPal Create Order failed (${res.status}): ${errText}`);
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`PayPal Create Order failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const approveLinkObj =
      (data.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve') || {};

    return {
      orderId: data.id,
      approvalUrl: approveLinkObj.href || null,
      status: data.status,
      isSandboxFallback: false,
    };
  } catch (err) {
    if (process.env.DEV_MODE === 'true') {
      console.warn('[PayPal] Live API call failed in DEV_MODE, falling back to interactive sandbox:', err.message);
      const mockOrderId = `PAYPAL-SANDBOX-${tabNumber}-${Date.now().toString(36).toUpperCase()}`;
      const approvalUrl = `${publicBaseUrl}/api/paypal/sandbox-checkout/${tabId}?orderId=${mockOrderId}`;
      return {
        orderId: mockOrderId,
        approvalUrl,
        status: 'CREATED',
        isSandboxFallback: true,
      };
    }
    throw err;
  }
}

/**
 * Capture an approved PayPal Order (POST /v2/checkout/orders/{id}/capture)
 */
export async function capturePayPalOrder(orderId) {
  if (!isRealPayPalConfigured() || String(orderId).startsWith('PAYPAL-SANDBOX-')) {
    return {
      id: orderId,
      status: 'COMPLETED',
      captureId: `CAP-${Date.now().toString(36).toUpperCase()}`,
    };
  }

  const token = await getAccessToken();
  const res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PayPal Capture Order failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const purchaseUnit = (data.purchase_units || [])[0] || {};
  const capture = ((purchaseUnit.payments || {}).captures || [])[0] || {};
  const invoiceId = String(purchaseUnit.invoice_id || capture.invoice_id || '');
  const isFxConverted = invoiceId.endsWith('-FX');

  return {
    id: data.id,
    status: data.status,
    captureId: capture.id || null,
    captureStatus: capture.status || null,
    amount: isFxConverted ? null : capture.amount ? Number(capture.amount.value) : null,
    currency: isFxConverted
      ? process.env.PAYPAL_CURRENCY || 'INR'
      : capture.amount
        ? capture.amount.currency_code
        : null,
    customId: purchaseUnit.custom_id || capture.custom_id || null,
    raw: data,
  };
}

/**
 * Refund a captured payment (POST /v2/payments/captures/{capture_id}/refund)
 */
export async function refundPayPalCapture(captureId, { amount, currency, note } = {}) {
  if (!isRealPayPalConfigured() || String(captureId).startsWith('CAP-')) {
    return {
      refundId: `REF-${Date.now().toString(36).toUpperCase()}`,
      status: 'COMPLETED',
    };
  }

  const token = await getAccessToken();
  const body = {};
  if (amount !== undefined && amount !== null) {
    body.amount = {
      value: Number(amount).toFixed(2),
      currency_code: currency || process.env.PAYPAL_CURRENCY || 'INR',
    };
  }
  if (note) {
    body.note_to_payer = note;
  }

  const res = await fetch(`${getPayPalBaseUrl()}/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `refund-${captureId}-${Date.now()}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PayPal Refund failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    refundId: data.id,
    status: data.status,
  };
}

/**
 * Verify PayPal Webhook Signature via PayPal's Notification API
 * Endpoint: POST /v1/notifications/verify-webhook-signature
 */
export async function verifyPayPalWebhookSignature({ headers, eventBody }) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  // In DEV_MODE without real PayPal keys, allow simulated webhook testing if header x-dev-webhook is present
  if (!isRealPayPalConfigured() && process.env.DEV_MODE === 'true') {
    if (headers['x-dev-webhook'] === 'true' || headers['paypal-transmission-sig'] === 'SANDBOX_SIMULATED_SIG') {
      return true;
    }
  }

  const authAlgo = headers['paypal-auth-algo'];
  const certUrl = headers['paypal-cert-url'];
  const transmissionId = headers['paypal-transmission-id'];
  const transmissionSig = headers['paypal-transmission-sig'];
  const transmissionTime = headers['paypal-transmission-time'];

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime || !webhookId) {
    return false;
  }

  const token = await getAccessToken();
  const verifyPayload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: webhookId,
    webhook_event: eventBody,
  };

  const res = await fetch(`${getPayPalBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(verifyPayload),
  });

  if (!res.ok) {
    return false;
  }

  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}

