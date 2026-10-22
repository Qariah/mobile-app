# Qariah Trademark Policy

Qariah's source code is licensed under the GNU Affero General Public License v3.0 or later, inherited from its upstream project [Bayaan](https://github.com/thebayaan/Bayaan). **The name "Qariah" and the Qariah logo are not covered by that license.**

**QARIAH® is a registered trademark of the Qariah project** (U.S. Reg. No. 7437102, Principal Register, International Classes 009 + 041), and together with the Qariah logo, app icons, and associated brand assets, is governed by this policy. Registered-trademark status entitles the Qariah project to the enhanced remedies available to registered mark holders under applicable law, which may include statutory damages and recovery of attorney's fees.

This separation between code license and brand protection is standard for open-source projects. It lets anyone study, run, and contribute to the code while preventing confusion about which builds are the official Qariah.

This policy is additional to (and does not modify or override) the [Bayaan Trademark Policy](./TRADEMARKS.md), which continues to govern any use of Bayaan's name and brand assets that remain in the codebase.

---

## What this policy covers

- The registered word mark **QARIAH®** and any equivalent presentation of the name "Qariah" (including common variations like "Qariah App", "Qariah Beta", "Qariah PB").
- The Qariah logo, app icons (all variants — light, dark, tinted, public-beta), splash-screen artwork, notification icon, and any associated brand marks under `assets/branding/` and the platform-native asset directories (`ios/Qariah/Images.xcassets/`, `android/app/src/main/res/mipmap-*/`).
- The Qariah color palette (Sage, Teal, and accent values) when used in a way that suggests endorsement.
- Any stylized use of "Qariah" that suggests the project endorses a product, fork, or service.
- The bundle identifiers `com.qariah.app` and `com.qariah.app.beta`, and the production iOS App Store / Google Play listings derived from them.

---

## What forks and derivatives **must** do

If you fork, modify, or redistribute Qariah, you must:

1. **Choose a new name.** Your fork cannot be called "Qariah", "Qariah 2", "Qariah Plus", "New Qariah", "Qariah Pro", or any confusingly similar variant. The name must be distinct enough that an end user could not reasonably believe your fork is the official Qariah project.
2. **Use your own icons and splash artwork.** Replace every PNG under `assets/branding/`, every variant under `ios/Qariah/Images.xcassets/AppIcon.appiconset/`, and every mipmap under `android/app/src/main/res/mipmap-*/`. **No build, binary, package, or distribution of your fork — through any channel — may use the original Qariah icons in any variant** (including the BETA and Public-Beta variants).
3. **Use your own bundle identifier.** Change the iOS bundle ID and Android application ID from `com.qariah.app` (and `com.qariah.app.beta`) to your own. **Any build, binary, package, or distribution of your fork must use your own identifiers, not Qariah's, regardless of how it is distributed** — including but not limited to the App Store, Google Play, TestFlight, F-Droid, sideloaded APKs, alternative app stores, internal or enterprise distribution, web install, EAS submit, ad-hoc IPA distribution, or any other channel public or private.
4. **Remove or replace brand strings.** If your fork displays "Qariah" anywhere — in its UI, settings, About screen, metadata, store listings, in-app notifications, error messages, or anywhere else end users or operators could encounter the name — replace those strings with your own product name. The branding-conformance lint at `.github/workflows/branding-conformance.yml` is a starting point; do not assume it is exhaustive.
5. **Comply with both Bayaan's and Qariah's trademark policies.** Bayaan's policy continues to apply to any Bayaan-derived code or brand references that remain in your fork.
6. **Comply with the AGPL.** The code license applies whether or not you comply with this policy; this policy is additional.

---

## What you **may** do without asking

You do not need permission to:

- Refer to "Qariah" by name when reviewing, writing about, tutorial-ing, or critiquing the project (nominative fair use).
- State accurately that your fork is "based on Qariah" or "forked from Qariah", as long as it is clear your fork is not the original and not endorsed by the Qariah project. The same applies to mentioning Bayaan as the upstream chain.
- Use the Qariah name in academic, journalistic, or educational contexts.
- Link to the official Qariah repository, App Store listing, Play Store listing, or website.
- Translate the app or contribute reciter content under a community arrangement, provided the resulting build still ships under the Qariah name and branding (i.e. you are contributing *to* Qariah, not making a parallel-branded fork).

---

## What you **may not** do

- **Build, package, distribute, ship, or operate** a product, app, service, website, library, plugin, container image, or any other software or hosted offering that uses "Qariah" in its name or branding without written permission — regardless of distribution channel (public or private, commercial or non-commercial, free or paid, online or offline).
- Use the Qariah logo or icons (in any variant) in your own product's marketing, app-store listings, source assets, documentation, or UI.
- Imply that your fork or product is endorsed by, affiliated with, or maintained by the Qariah project.
- Register domain names, social media handles, App Store / Play Store developer-account display names, or trademarks containing "Qariah" that could be confused with the official project.
- Monetize products, services, or content that use the Qariah name, logo, or registered mark.
- Distribute Qariah's bundled reciter assets (photos, biographical content where licensing is not explicitly redistributable, curated catalog metadata) as a standalone dataset. These assets are governed by separate licensing arrangements with individual reciters and content partners; AGPL does not extend redistribution rights to them.

---

## Reciter content + curated data

Reciter photos, biographical text, audio recordings, and the curated catalog metadata shipped with or referenced by Qariah are **not licensed under AGPL** and are not covered by this trademark policy.

These materials are governed by [`DATA-LICENSE.md`](./DATA-LICENSE.md). See that file for asset-specific terms, redistribution rules, and the permission-request pathway.

If you are forking Qariah, replace `assets/data/catalog.json`, `data/reciters-fallback.json`, and any reciter-associated assets with your own content under your own arrangements.

---

## Requesting permission

If you would like to use the Qariah name or logo for a purpose not permitted above — for example, a community event, a translation partnership, or an officially-endorsed fork — open a GitHub issue on the Qariah repository or contact the maintainers at the email listed in the App Store / Play Store listings.

Permission is granted case-by-case in writing. A "no" today is not a "yes" tomorrow; do not assume prior grants extend to new uses.

---

## Enforcement

The Qariah project reserves the right to:

- Request takedown of any listing or distribution using the Qariah name or logo — including but not limited to the App Store, Google Play, F-Droid, alternative app stores, third-party download sites, social platforms, and search-index entries.
- File DMCA notices, registered-trademark complaints, App Store / Play Store brand-infringement reports, UDRP / URS domain complaints, and equivalent processes on other platforms.
- Pursue the enhanced remedies available to registered trademark holders under applicable law, including but not limited to injunctive relief, statutory damages, recovery of profits, and attorney's fees in jurisdictions where these are available to registered-mark holders.

Most conflicts are resolved amicably when people understand the policy. If you are unsure whether your use is permitted, ask first.

---

## Precedent

This policy follows the pattern used by Bayaan (the upstream project) and by established open-source projects that separate code licensing from brand protection — most notably Mozilla (Firefox), Signal, Element, and the Linux Foundation. The underlying principle is the same: the code is free, the name is not.
