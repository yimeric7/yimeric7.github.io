import { liveCampaignUtmFromLocation } from './attribution.js';
/**
 * Rides on every beacon so the dashboard can tell which connector build a
 * pageview came from. Must match packages/site-connector/package.json —
 * bump both together when releasing.
 */
export const SABLE_CONNECTOR_VERSION = '0.8.2';
function captureAllowed() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined')
        return false;
    const privacy = navigator;
    return privacy.globalPrivacyControl !== true && privacy.doNotTrack !== '1';
}
let fallbackEventCounter = 0;
let lastEventTime = 0;
function eventTimestamp() {
    lastEventTime = Math.max(Date.now(), lastEventTime + 1);
    return lastEventTime;
}
function normalizeApiUrl(value) {
    return value.trim().replace(/\/+$/, '');
}
function sourceFromUrl(value) {
    try {
        const url = new URL(value);
        return url.hostname.replace(/^www\./i, '').toLowerCase();
    }
    catch {
        return '';
    }
}
function getSourceLabel(firstTouchSource) {
    if (typeof window === 'undefined')
        return 'Direct';
    if (firstTouchSource?.trim())
        return firstTouchSource.trim();
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source')?.trim();
    if (utmSource)
        return utmSource;
    const referrer = document.referrer ? sourceFromUrl(document.referrer) : '';
    if (referrer &&
        referrer !== window.location.hostname.replace(/^www\./i, '')) {
        return referrer;
    }
    return 'Direct';
}
function getDeviceType() {
    if (typeof navigator === 'undefined')
        return 'Desktop';
    const userAgent = navigator.userAgent.toLowerCase();
    if (/ipad|tablet/.test(userAgent))
        return 'Tablet';
    if (/mobi|android|iphone|ipod/.test(userAgent))
        return 'Mobile';
    return 'Desktop';
}
function createEventId() {
    if (typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    fallbackEventCounter += 1;
    return [
        'sable',
        Date.now().toString(36),
        fallbackEventCounter.toString(36),
        Math.random().toString(36).slice(2),
    ].join('-');
}
function getPageProperties() {
    if (typeof window === 'undefined') {
        return {
            sable_pathname: '/',
            sable_source: 'Direct',
            sable_device_type: 'Desktop',
        };
    }
    // Analytics never invokes lead attribution: no cookies, click IDs, or browser
    // storage. Lead first-touch persistence remains a separate opt-in API.
    const campaignUtm = liveCampaignUtmFromLocation();
    return {
        sable_pathname: window.location.pathname || '/',
        sable_source: getSourceLabel(campaignUtm?.source),
        sable_device_type: getDeviceType(),
        ...(campaignUtm ? { sable_utm: campaignUtm } : {}),
    };
}
function sendPageviewBeacon(context) {
    if (!captureAllowed())
        return;
    const properties = getPageProperties();
    const baseUrl = context.analyticsApiUrl ?? context.apiUrl;
    const url = `${normalizeApiUrl(baseUrl)}/public/analytics/pageview`;
    const body = JSON.stringify({
        siteSlug: context.siteSlug,
        visitorId: 'cookieless',
        eventId: createEventId(),
        path: properties.sable_pathname,
        source: properties.sable_source,
        utm: properties.sable_utm,
        device: properties.sable_device_type,
        timestamp: eventTimestamp(),
        connectorVersion: SABLE_CONNECTOR_VERSION,
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'text/plain' });
        if (navigator.sendBeacon(url, blob)) {
            return;
        }
    }
    void fetch(url, {
        method: 'POST',
        credentials: 'omit',
        headers: {
            'Content-Type': 'text/plain',
        },
        body,
        keepalive: true,
    }).catch(() => undefined);
}
function safeEventProperties(properties) {
    if (!properties)
        return undefined;
    const entries = Object.entries(properties).slice(0, 40);
    const safe = {};
    for (const [rawKey, value] of entries) {
        const key = rawKey.trim().slice(0, 80);
        if (!key ||
            (!['phone_href', 'phone_number'].includes(key) &&
                /email|phone|name|message|text|token|password|cookie|click.?id|address/i.test(key)))
            continue;
        if (typeof value === 'string') {
            safe[key] = value.slice(0, 500);
        }
        else if (typeof value === 'number' && Number.isFinite(value)) {
            safe[key] = value;
        }
        else if (typeof value === 'boolean' || value === null) {
            safe[key] = value;
        }
    }
    return Object.keys(safe).length > 0 ? safe : undefined;
}
function sendEventBeacon(event, properties, context) {
    if (!captureAllowed())
        return;
    const eventName = event.trim().slice(0, 120);
    if (!eventName)
        return;
    const pageProperties = getPageProperties();
    const baseUrl = context.analyticsApiUrl ?? context.apiUrl;
    const url = `${normalizeApiUrl(baseUrl)}/public/analytics/event`;
    const body = JSON.stringify({
        siteSlug: context.siteSlug,
        visitorId: 'cookieless',
        eventId: createEventId(),
        event: eventName,
        path: pageProperties.sable_pathname,
        source: pageProperties.sable_source,
        utm: pageProperties.sable_utm,
        device: pageProperties.sable_device_type,
        timestamp: eventTimestamp(),
        connectorVersion: SABLE_CONNECTOR_VERSION,
        properties: safeEventProperties(properties),
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'text/plain' });
        if (navigator.sendBeacon(url, blob)) {
            return;
        }
    }
    void fetch(url, {
        method: 'POST',
        credentials: 'omit',
        headers: {
            'Content-Type': 'text/plain',
        },
        body,
        keepalive: true,
    }).catch(() => undefined);
}
export async function initializeSableSiteAnalytics({ config, siteProfile, }) {
    if (typeof window === 'undefined')
        return false;
    if (!config)
        return false;
    if (config.captureEnabled === false)
        return false;
    if (config.apiUrl)
        return true;
    return siteProfile !== null;
}
export function captureSableSitePageview(context) {
    sendPageviewBeacon(context);
}
export function captureSableSiteEvent(event, properties, context) {
    sendEventBeacon(event, properties, context);
}
//# sourceMappingURL=analytics.js.map