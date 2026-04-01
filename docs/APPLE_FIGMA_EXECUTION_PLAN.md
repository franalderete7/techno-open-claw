# Apple Content Design Execution Plan

## Why Start Here

Yes, this is the right move.

If Orshot is going to scale production, then the real leverage is not "generate more images". The leverage is defining a taste system first so every generated asset inherits a consistent look, hierarchy, and sales logic.

Right now the repo already has the correct product/content structure:

- Brand profiles exist.
- The `iphone` brand is already seeded as `premium sobrio y percepción de valor`.
- Templates already exist for `feed`, `story`, `whatsapp`, `hero`, `comparison`, and `banner`.

What is missing is not structure. It is visual taste, rules, and a repeatable Figma base that Orshot can later follow.

## Reinforced With Official Apple References

This plan was reinforced on April 1, 2026 using current Apple references:

- Apple iPhone 17 product page
- Apple iPhone 17 Pro product page
- Apple Buy iPhone page
- Apple Newsroom launch pages for iPhone 17 and iPhone 17 Pro
- Apple Developer typography documentation

The most useful patterns from those sources are not "copy this layout exactly". They are:

- Apple leads with the device first, not with dense commercial copy.
- Headlines are short, often split into one or two compact lines.
- Product surfaces and materials are treated as the hero, especially the camera area and edge finish.
- The shopping page stays clean even when it becomes commercial: one strong title, one clear next action, few supporting points.
- Pro models use darker, deeper, more dramatic staging; non-Pro models are often brighter and friendlier.
- Color usage is restrained. The device finish provides the color story more than the background does.

For TechnoStore, the takeaway is:

- keep the Apple feel of restraint,
- but add a clearer conversion block than Apple does,
- and never let the commercial CTA destroy the premium mood.

## The Main Decision

Do not design Apple assets directly from the current storefront look.

The storefront should stay commercially clear and general. Apple content should feel more controlled, more spacious, more precise, and more premium than the storefront. The storefront is the catalog. The Apple system is the conversion layer.

## Goal For Phase 1

Build an Apple-first Figma system that can produce:

1. One premium hero direction for anchor models.
2. One commercial feed template.
3. One story template.
4. One WhatsApp card template.
5. One small component library so these templates scale across multiple iPhones.

Success in this phase is not "award-winning design". Success is:

- the product looks expensive,
- the offer is easy to understand,
- the templates are reusable,
- and the same system works for multiple Apple models without redesigning from zero.

## What Good Apple Design Means Here

For TechnoStore, "good Apple design" should mean:

- quiet luxury, not flashy luxury,
- exact product rendering, not fake cinematic nonsense,
- very little text,
- strong spacing,
- clean material feel,
- one clear commercial action.

If a piece feels crowded, noisy, or too similar to a random ecommerce ad, it is off track.

## The Taste System

Start with a very small system. Do not invent too many styles.

### Color

Use one neutral premium palette and one action accent.

- `Ink`: `#0E0E10`
- `Graphite`: `#1B1D22`
- `Titanium`: `#B8BDC7`
- `Mist`: `#F5F4F1`
- `Slate Blue`: `#2E3A4F`
- `Divider`: `#D8DBE1`
- `Success / WhatsApp CTA`: `#25D366`

Rules:

- Use dark backgrounds for Pro / Pro Max / hero pieces.
- Use soft light backgrounds for base iPhone or price-driven commercial pieces.
- Use WhatsApp green only in the CTA element, never as a dominant aesthetic color.
- Avoid gradients unless they are extremely subtle.

### Typography

Use one family only in v1.

Recommended production font:

- `Inter`

Why:

- it is neutral and highly legible,
- it stays clean in ecommerce use,
- and it avoids licensing ambiguity that comes with Apple system fonts in non-Apple commercial artwork.

Important:

- Apple Developer documentation describes `SF Pro` as Apple’s system typeface, but the Apple font license is restricted to Apple-platform mockups and related uses.
- For TechnoStore marketing assets, use `Inter` as the safe default.
- If you later license a premium commercial family, you can swap it system-wide.

Do not mix multiple type families in v1.

Suggested scale:

- Headline XL: `48 / 52` semibold
- Headline L: `36 / 40` semibold
- Price: `40 / 44` bold
- Body: `18 / 24` medium
- Support: `16 / 22` regular
- Meta / legal: `14 / 20` regular

Rules:

- One headline max.
- Two support lines max.
- Never stack five different font sizes in one piece.
- If text is getting long, reduce copy first, not font size first.
- Use medium or semibold more often than bold. Apple-like premium layouts usually rely on restraint, not heavy weight everywhere.

### Spacing

Use an 8pt system and do not improvise.

- `8`
- `16`
- `24`
- `32`
- `48`
- `64`

Rules:

- Feed outer margins: `64`
- Story outer margins: `40`
- Gap between text blocks: `16` or `24`
- Gap between product and text zones: `32` to `48`
- Align to a visible grid, even if it is simple. Apple’s pages feel expensive partly because elements lock into clean invisible structure.

If spacing feels random, the design will feel cheap even if the image is good.

## Apple-Inspired But Conversion-Adjusted

Apple’s official site is not a local conversion ad system, so we should adapt it instead of copying it.

Keep from Apple:

- device-first composition,
- minimal text,
- premium material focus,
- restrained color use,
- generous whitespace.

Add for TechnoStore:

- stronger price visibility,
- warranty and shipping reassurance,
- WhatsApp CTA,
- one practical selling reason.

That gives you "Apple mood with retail clarity", which is the right target.

## Layout Rules

### Feed Template

Frame:

- `1080 x 1350`

Structure:

- top-left: brand or premium kicker
- center-left: model name + one selling line
- lower-left: price / warranty / CTA
- right or center-right: large product render

Rules:

- Product should occupy around `45%` to `60%` of the composition.
- Leave negative space around the phone.
- Do not place text over important hardware details.
- Camera module must stay visible and premium.
- If the device finish is light, make sure the background value is different enough so the silhouette stays elegant and readable.

### Story Template

Frame:

- `1080 x 1920`

Structure:

- top: brand / model context
- middle: large product hero
- bottom: offer, warranty, CTA

Rules:

- The user should understand the story in under 2 seconds.
- Bottom CTA block must be obvious and clean.
- No more than one main benefit on the story.

### WhatsApp Card

Frame:

- `1080 x 1080`

Structure:

- product image
- model name
- price
- guarantee / shipping
- CTA

Rules:

- This card must optimize for scanning, not mood.
- Keep the product large, but the hierarchy even clearer than feed.
- If a seller sends it quickly in chat, it should work immediately without explanation.
- Use the darkest text on the cleanest background here. WhatsApp cards are where commercial clarity wins.

### Hero Template

Frame:

- `1920 x 1080` reference canvas

Structure:

- almost no text
- exact device
- premium light sweep
- restrained reflections
- negative space for optional future overlays

Rules:

- This is where value perception is built.
- Do not turn hero pieces into cluttered sales flyers.

## Figma Setup

Create one file for Apple v1 with these pages:

1. `00 Foundations`
2. `01 Components`
3. `02 Apple Templates`
4. `03 Production Variants`
5. `99 Graveyard`

Inside `00 Foundations`, define:

- color styles
- text styles
- spacing reference
- example backgrounds
- approved product shadow styles
- approved grid widths and safe text zones

Inside `01 Components`, build:

- kicker label
- headline block
- price block
- warranty / shipping strip
- CTA button
- product stage background
- badge for promo or cuotas

Inside `02 Apple Templates`, create:

- `APPLE_FEED_PREMIUM_V1`
- `APPLE_STORY_OFFER_V1`
- `APPLE_WA_CARD_V1`
- `APPLE_HERO_V1`

Inside `03 Production Variants`, duplicate only from approved templates.

Do not design final pieces inside the component page.

## What You Need To Learn In Figma

Only learn these five things first:

1. Frames
2. Auto layout
3. Components
4. Text styles and color styles
5. Pages and naming

Ignore for now:

- advanced prototyping,
- plugins for decoration,
- complex effects,
- giant design systems,
- animations inside Figma.

Your first job is not to become a designer. Your first job is to become consistent.

## The Production Logic

Build the Apple system in this order:

1. Foundations
2. Components
3. One feed template
4. One story template
5. One WhatsApp card
6. One hero direction
7. Variant production across models

Do not start by making ten finished ads.

Start by making one system that can make ten ads.

## Apple-Specific Rules By Product Tier

### High Tier

For `iPhone 17 Pro Max 256`:

- dark or titanium backgrounds,
- more negative space,
- less copy,
- stronger focus on materiality and camera,
- hero asset is mandatory.

### Mid Tier

For `iPhone 17 256` and `iPhone 16 Plus 128`:

- keep premium feel,
- increase commercial clarity,
- allow slightly more price visibility,
- story and WhatsApp card become more important than hero.

### Lower Tier

For `iPhone 16 128` and `iPhone 15 128`:

- keep Apple elegance,
- but prioritize readability, price, warranty, and ease of asking on WhatsApp,
- use cleaner and brighter layouts if needed.

## The First Pilot

Do not test the system on all iPhones at once.

Pilot with only these three:

1. `iPhone 17 Pro Max 256`
2. `iPhone 17 256`
3. `iPhone 15 128`

Why:

- one anchor premium model,
- one mid-tier current model,
- one lower-friction entry model.

If the system works across those three, it will probably scale to the rest.

## The Review Checklist

Before approving any Apple template or variant, check:

1. Does the phone look exact and believable?
2. Is the camera module clearly visible?
3. Can the hierarchy be understood in 2 seconds?
4. Is there enough empty space?
5. Is there only one main message?
6. Does the CTA stand out without ruining the premium feel?
7. Would this still look good for five other Apple models?
8. Does this feel more premium than the storefront, not just different?
9. Is the text block small enough that the phone still feels like the hero?
10. Would this still work if price or financing changes tomorrow?

If the answer to `7` is no, it is probably not a scalable template.

## Common Failure Modes

This is likely what made the previous Apple attempt weak:

- too much influence from the generic storefront,
- too much text,
- no fixed spacing system,
- no fixed typography system,
- not enough negative space,
- product treated like any generic phone,
- premium mood replaced by "busy ecommerce poster".

Avoiding these mistakes will matter more than finding a fancy visual trick.

## Handoff To Orshot

Only move into Orshot after Figma defines:

- approved templates,
- text zones,
- safe product zones,
- color tokens,
- typography rules,
- examples for high / medium / low Apple tiers.

Orshot should scale a system you already like. It should not discover taste for you.

For each approved template, document:

- template name,
- purpose,
- frame size,
- text zones,
- required variables,
- optional variables,
- do not cross lines,
- one exported reference image.

## Suggested 10-Day Execution Plan

### Days 1-2

- Review existing bad Apple work.
- Collect 10 references that feel right.
- Mark what you like: background, lighting, spacing, text amount, CTA style.

### Days 3-4

- Build `00 Foundations`.
- Lock colors, typography, spacing, shadows, and basic backgrounds.

### Days 5-6

- Build components in `01 Components`.
- Keep them boring and reusable.

### Days 7-8

- Build the 4 Apple templates.
- Test with the 3 pilot models.

### Day 9

- Review with a strict checklist.
- Remove anything decorative that does not improve clarity or value perception.

### Day 10

- Freeze v1.
- Document template rules.
- Then move those rules into Orshot and content generation.

## My Recommendation

Yes, start with Apple.

Apple is the best first brand because:

- it is easiest to simplify,
- it benefits the most from spacing and restraint,
- it exposes weak taste immediately,
- and once you can make Apple look credible, Samsung and Xiaomi become easier to systematize.

But the key is this:

Do not try to "be a designer" all at once.

Build one opinionated Apple system with:

- one palette,
- one type family,
- one spacing logic,
- four reusable templates,
- and three pilot products.

That is enough to start making designs that sell.

## Next Best Move

Open or create the Apple Figma file and do only this first:

1. create the page structure,
2. add the color styles,
3. add the text styles,
4. place the iPhone reference image,
5. build one feed template before touching stories or banners.

If that first feed template looks right, the rest gets much easier.

## Source Notes

These Apple references were used to reinforce the plan:

- `https://www.apple.com/iphone-17/`
- `https://www.apple.com/iphone-17-pro/`
- `https://www.apple.com/shop/buy-iphone`
- `https://www.apple.com/newsroom/2025/09/apple-debuts-iphone-17/`
- `https://www.apple.com/newsroom/2025/09/apple-unveils-iphone-17-pro-and-iPhone-17-pro-max/`
- `https://developer.apple.com/fonts/index.html`
