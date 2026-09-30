/**
 * The fixed tag vocabulary. Models may only answer from these lists; anything
 * else is counted as off-vocab and dropped. Product screen names follow Mobbin's
 * screen patterns so "all the paywalls" means the same thing in both places.
 * Edit the lists to fit your library; the prompt and the parser both read them.
 *
 * Client and project tags are deliberately absent: those are human-only and no
 * model ever assigns them.
 *
 * v2 (2026-09-23): surfaces grouped by KIND, and kind is DERIVED from surface
 * in code, never asked of the model, so the two can never disagree. Added the
 * component facet (UI elements, Mobbin-style), the move line and the app name.
 */

/** Every surface belongs to exactly one kind. Kind routes an item to a craft skill. */
export const SURFACES_BY_KIND = {
  site: [
    "landing page", "hero", "nav", "feature sections", "bento", "pricing", "testimonials",
    "logo wall", "faq", "cta", "footer", "about page", "article", "case study", "product page",
    "sign-up", "email", "404", "gallery", "team", "contact", "content", "product grid", "stats",
  ],
  product: [
    "onboarding", "sign-in", "home", "feed", "detail", "list", "search", "settings", "paywall",
    "checkout", "profile", "empty state", "dashboard", "chat", "map", "notifications",
    "calendar", "player", "app store listing", "app icon", "widget",
  ],
  graphic: ["poster", "deck slide", "social post", "cover", "packaging", "print", "illustration", "ad", "icon set"],
  brand: ["logo", "wordmark", "identity system", "brand guide"],
  type: ["type specimen", "type in use", "lettering"],
  motion: ["transition", "micro-interaction", "reveal", "loop", "promo video"],
  "photo-art": ["photo", "art", "color palette"],
};

/**
 * A section of a full-page capture gets a SECTION type, never a page type. The
 * 100-item sample (2026-09-23) labelled 55 of 120 sections "about page",
 * "landing page", "case study" etc. when page types were on offer.
 */
export const SECTION_SURFACES = [
  "hero", "nav", "feature sections", "bento", "pricing", "testimonials", "logo wall", "faq",
  "cta", "footer", "sign-up", "gallery", "team", "contact", "content", "product grid", "stats",
];

export const KIND_OF = Object.fromEntries(
  Object.entries(SURFACES_BY_KIND).flatMap(([kind, list]) => list.map((s) => [s, kind])),
);

export const FACETS = {
  surface: {
    pick: "one",
    hint: "what the image IS, as a whole",
    values: Object.values(SURFACES_BY_KIND).flat(),
  },
  platform: {
    pick: "one",
    hint: "where it lives",
    values: ["desktop web", "mobile web", "ios", "android", "tablet", "print", "social", "none"],
  },
  theme: {
    pick: "one",
    hint: "overall background and tone",
    values: ["light", "dark", "mixed", "bold color"],
  },
  type: {
    pick: "many", max: 2,
    hint: "dominant typefaces",
    values: ["serif", "sans", "mono", "display", "script", "none"],
  },
  style: {
    pick: "many", max: 3,
    hint: "visual character",
    values: [
      "minimal", "editorial", "luxury", "playful", "brutalist", "technical", "retro", "organic",
      "corporate", "pastel", "gradient", "glow", "grain", "3d", "geometric", "rounded", "duotone",
      "photo-led", "illustrated", "hand-drawn", "swiss",
    ],
  },
  pattern: {
    pick: "many", max: 3,
    hint: "how the layout is built",
    values: [
      "card grid", "bento grid", "device mockup", "full-bleed photo", "big type", "split layout",
      "stats", "marquee", "asymmetric layout", "centered stack", "overlapping layers", "collage", "none",
    ],
  },
  component: {
    pick: "many", max: 5,
    hint: "UI elements visible, like Mobbin's UI elements; 'none' for non-interface images",
    values: [
      "nav bar", "tab bar", "sidebar", "bottom sheet", "modal", "card", "carousel", "tabs",
      "segmented control", "toggle", "form", "search bar", "chips", "list", "table", "chart",
      "calendar", "map", "media player", "pricing table", "testimonial", "accordion", "stepper",
      "progress", "toast", "avatar", "rating", "button group", "empty state", "keyboard", "none",
    ],
  },
  industry: {
    pick: "one",
    hint: "the business it is for; 'unclear' when you cannot tell",
    values: [
      "fintech", "saas", "ai", "dev tools", "crypto", "hospitality", "food", "health", "fitness",
      "beauty", "fashion", "music", "media", "real estate", "legal", "education", "nonprofit",
      "ecommerce", "retail", "logistics", "travel", "agency", "consumer app", "sports", "automotive", "unclear",
    ],
  },
};

/** kind is derived, but scored and filtered like a single-choice facet. */
export const SINGLE = ["kind", ...Object.keys(FACETS).filter((f) => FACETS[f].pick === "one")];
export const MULTI = Object.keys(FACETS).filter((f) => FACETS[f].pick === "many");

/**
 * The move line must name a relationship, not a look (graphic-craft rule 11):
 * no colour, no typeface, no subject. Colour and typeface are checkable in code;
 * subject is judged by eye on the contact sheet.
 */
export const MOVE_BANNED = [
  // colour
  "red", "blue", "green", "yellow", "orange", "purple", "pink", "black", "white", "grey", "gray",
  "teal", "beige", "cream", "gold", "silver", "neon", "pastel", "monochrome", "colour", "color",
  "colored", "coloured", "hue", "palette", "gradient",
  // typeface
  "serif", "sans", "sans-serif", "mono", "monospace", "typeface", "font", "helvetica", "grotesk",
  "grotesque", "script", "italic",
];
