const ATTRIBUTION_STORAGE_KEY = 'sable:lead-attribution:v1';
const PROTOCOL_ATTRIBUTION_STORAGE_KEY = 'protocol:first-touch-attribution:v1';
const EXTREME_STEAM_LEGACY_STORAGE_KEY = 'es_ad_attribution_v1';
const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLICK_SOURCE_BY_PARAM = {
    fbclid: { source: 'facebook', medium: 'paid_social' },
    gclid: { source: 'google', medium: 'paid_search' },
    gbraid: { source: 'google', medium: 'paid_search' },
    wbraid: { source: 'google', medium: 'paid_search' },
    msclkid: { source: 'microsoft', medium: 'paid_search' },
    ttclid: { source: 'tiktok', medium: 'paid_social' },
};
/**
 * Referrer hosts treated as organic search rather than plain referral.
 * Prefix patterns (trailing dot) must match from the start of the host so
 * mail.google.com stays a referral while google.com and google.co.uk count
 * as search.
 */
const ORGANIC_SEARCH_HOST_PREFIXES = ['google.', 'yandex.'];
const ORGANIC_SEARCH_HOST_SUBSTRINGS = [
    'bing.com',
    'duckduckgo.com',
    'search.yahoo.com',
    'ecosia.org',
    'search.brave.com',
    'startpage.com',
    'baidu.com',
];
function isOrganicSearchHost(host) {
    return (ORGANIC_SEARCH_HOST_PREFIXES.some((prefix) => host.startsWith(prefix)) ||
        ORGANIC_SEARCH_HOST_SUBSTRINGS.some((pattern) => host.includes(pattern)));
}
function cleanTag(value, maxLength = 300) {
    if (typeof value !== 'string')
        return undefined;
    const cleaned = value.trim().slice(0, maxLength);
    return cleaned || undefined;
}
function createEventId() {
    if (typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return [
        'sable',
        Date.now().toString(36),
        Math.random().toString(36).slice(2),
    ].join('-');
}
function getSearchParam(params, name) {
    return cleanTag(params.get(name));
}
function readCookie(name) {
    if (typeof document === 'undefined')
        return undefined;
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
        const cookie = part.trim();
        if (!cookie.startsWith(prefix))
            continue;
        try {
            return cleanTag(decodeURIComponent(cookie.slice(prefix.length)));
        }
        catch {
            return cleanTag(cookie.slice(prefix.length));
        }
    }
    return undefined;
}
function fbcFromFbclid(fbclid, timestamp) {
    if (!fbclid)
        return undefined;
    return `fb.1.${timestamp}.${fbclid}`;
}
function normalizeUtm(value) {
    const source = cleanTag(value?.source);
    const medium = cleanTag(value?.medium);
    const campaign = cleanTag(value?.campaign);
    const content = cleanTag(value?.content);
    const term = cleanTag(value?.term);
    if (!source && !medium && !campaign && !content && !term)
        return undefined;
    return {
        ...(source ? { source } : {}),
        ...(medium ? { medium } : {}),
        ...(campaign ? { campaign } : {}),
        ...(content ? { content } : {}),
        ...(term ? { term } : {}),
    };
}
function hasLeadAttributionSignal(value) {
    if (!value)
        return false;
    return Boolean(value.utm?.source ||
        value.utm?.medium ||
        value.utm?.campaign ||
        value.utm?.content ||
        value.utm?.term ||
        value.fbclid ||
        value.fbc);
}
export function mergeSableAttribution(primary, fallback) {
    // Attribution is one touch, not a bag of independently mergeable fields.
    // Choosing one complete signal prevents impossible hybrids such as a stored
    // Google source paired with a later Instagram campaign.
    const touch = hasLeadAttributionSignal(primary) ? primary : fallback;
    const utm = normalizeUtm(touch?.utm);
    const fbclid = cleanTag(touch?.fbclid);
    const fbp = cleanTag(touch?.fbp);
    const fbc = cleanTag(touch?.fbc);
    const eventId = cleanTag(primary?.eventId) ?? cleanTag(fallback?.eventId);
    const attribution = {
        ...(utm ? { utm } : {}),
        ...(fbclid ? { fbclid } : {}),
        ...(fbp ? { fbp } : {}),
        ...(fbc ? { fbc } : {}),
        ...(eventId ? { eventId } : {}),
    };
    return Object.keys(attribution).length > 0 ? attribution : undefined;
}
function storage() {
    if (typeof window === 'undefined')
        return undefined;
    try {
        return window.localStorage;
    }
    catch {
        return undefined;
    }
}
function readStoredAttribution(now) {
    const store = storage();
    if (!store)
        return undefined;
    for (const key of [
        ATTRIBUTION_STORAGE_KEY,
        PROTOCOL_ATTRIBUTION_STORAGE_KEY,
        EXTREME_STEAM_LEGACY_STORAGE_KEY,
    ]) {
        try {
            const raw = store.getItem(key);
            if (!raw)
                continue;
            const parsed = JSON.parse(raw);
            if (typeof parsed.capturedAt !== 'number' ||
                now - parsed.capturedAt > ATTRIBUTION_TTL_MS) {
                store.removeItem(key);
                continue;
            }
            const restored = mergeSableAttribution(parsed.attribution, {
                ...(parsed.utm ? { utm: parsed.utm } : {}),
                ...(parsed.fbclid ? { fbclid: parsed.fbclid } : {}),
            });
            if (!hasLeadAttributionSignal(restored))
                continue;
            // Rows written before origins existed could only have been campaign
            // touches — referrer capture did not exist yet.
            const origin = parsed.origin === 'referrer' ? 'referrer' : 'campaign';
            if (key !== ATTRIBUTION_STORAGE_KEY) {
                writeStoredAttribution(restored, parsed.capturedAt, origin);
            }
            return { attribution: restored, origin };
        }
        catch {
            store.removeItem(key);
        }
    }
    return undefined;
}
function writeStoredAttribution(attribution, now, origin) {
    const store = storage();
    if (!store)
        return;
    try {
        const stored = { capturedAt: now, attribution, origin };
        store.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(stored));
    }
    catch {
        // Storage can be unavailable in private browsing or locked-down embeds.
    }
}
function attributionFromBrowser(now) {
    if (typeof window === 'undefined')
        return undefined;
    const params = new URLSearchParams(window.location.search);
    const fbclid = getSearchParam(params, 'fbclid');
    const fbp = readCookie('_fbp');
    const fbc = readCookie('_fbc') ?? fbcFromFbclid(fbclid, now);
    const explicitUtm = {
        source: getSearchParam(params, 'utm_source'),
        medium: getSearchParam(params, 'utm_medium'),
        campaign: getSearchParam(params, 'utm_campaign'),
        content: getSearchParam(params, 'utm_content'),
        term: getSearchParam(params, 'utm_term'),
    };
    const inferredClick = Object.entries(CLICK_SOURCE_BY_PARAM).find(([param]) => getSearchParam(params, param))?.[1] ?? (fbc ? CLICK_SOURCE_BY_PARAM.fbclid : undefined);
    const utm = normalizeUtm({
        source: explicitUtm.source ?? inferredClick?.source,
        medium: explicitUtm.medium ?? inferredClick?.medium,
        campaign: explicitUtm.campaign,
        content: explicitUtm.content,
        term: explicitUtm.term,
    });
    const attribution = mergeSableAttribution({
        ...(utm ? { utm } : {}),
        ...(fbclid ? { fbclid } : {}),
        ...(fbp ? { fbp } : {}),
        ...(fbc ? { fbc } : {}),
    }, undefined);
    return hasLeadAttributionSignal(attribution) ? attribution : undefined;
}
function externalReferrerHost() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return undefined;
    }
    const referrer = cleanTag(document.referrer, 500);
    if (!referrer)
        return undefined;
    try {
        const host = new URL(referrer).hostname.replace(/^www\./i, '').toLowerCase();
        const ownHost = (window.location.hostname || '')
            .replace(/^www\./i, '')
            .toLowerCase();
        if (!host || host === ownHost)
            return undefined;
        return host;
    }
    catch {
        return undefined;
    }
}
function referrerAttributionFromBrowser() {
    const host = externalReferrerHost();
    if (!host)
        return undefined;
    const medium = isOrganicSearchHost(host) ? 'organic_search' : 'referral';
    return { utm: { source: host, medium } };
}
/**
 * Live campaign tags on the current URL only — explicit utm params, or a
 * source/medium inferred from an ad click id when the ad forgot its tags.
 * Unlike the stored first touch this never looks at storage, so it answers
 * "did THIS pageview arrive from a tagged link?"
 */
export function liveCampaignUtmFromLocation() {
    if (typeof window === 'undefined')
        return undefined;
    const params = new URLSearchParams(window.location.search);
    const inferredClick = Object.entries(CLICK_SOURCE_BY_PARAM).find(([param]) => getSearchParam(params, param))?.[1];
    return normalizeUtm({
        source: getSearchParam(params, 'utm_source') ?? inferredClick?.source,
        medium: getSearchParam(params, 'utm_medium') ?? inferredClick?.medium,
        campaign: getSearchParam(params, 'utm_campaign'),
        content: getSearchParam(params, 'utm_content'),
        term: getSearchParam(params, 'utm_term'),
    });
}
/**
 * Read-or-capture the first touch, with its origin.
 *
 * A stored campaign touch is immutable for its full TTL — direct return
 * visits must not extend the expiry or blend in later campaign data. A stored
 * referrer touch may be upgraded exactly once by a live campaign landing, so
 * an ad click is never masked by an earlier organic guess.
 */
export function captureSableAttributionDetailed() {
    const now = Date.now();
    const stored = readStoredAttribution(now);
    if (stored?.origin === 'campaign')
        return stored;
    const campaign = attributionFromBrowser(now);
    if (hasLeadAttributionSignal(campaign)) {
        writeStoredAttribution(campaign, now, 'campaign');
        return { attribution: campaign, origin: 'campaign' };
    }
    if (stored)
        return stored;
    const referral = referrerAttributionFromBrowser();
    if (referral) {
        writeStoredAttribution(referral, now, 'referrer');
        return { attribution: referral, origin: 'referrer' };
    }
    return undefined;
}
export function captureSableAttributionFromLocation() {
    return captureSableAttributionDetailed()?.attribution;
}
export function getSableAttribution() {
    const attribution = captureSableAttributionFromLocation();
    if (!attribution)
        return undefined;
    return {
        ...attribution,
        eventId: attribution.eventId ?? createEventId(),
    };
}
//# sourceMappingURL=attribution.js.map