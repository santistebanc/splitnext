# Appearance assets

- `ibm-plex-sans.woff2`: variable IBM Plex Sans, Latin subset, from Google
  Fonts, https://github.com/google/fonts/tree/main/ofl/ibmplexsans. Used for
  body text, labels, and controls.
- `ibm-plex-mono-500.woff2` and `ibm-plex-mono-600.woff2`: IBM Plex Mono
  Medium and SemiBold, Latin subset, from Google Fonts,
  https://github.com/google/fonts/tree/main/ofl/ibmplexmono. Used for amounts,
  currency codes, and invite links.
- `bricolage-grotesque.woff2`: variable Bricolage Grotesque, Latin subset,
  from Google Fonts,
  https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque. Used for
  page titles, group names, and empty-state titles.

The IBM Plex fonts are distributed under the SIL Open Font License in
`ibm-plex-OFL.txt`, and Bricolage Grotesque under the same license in
`bricolage-grotesque-OFL.txt`.

All fonts are served locally, without runtime requests to Google or another
font CDN, and the service worker precaches them for offline use.

The original blue split-S favicon in `../icon.svg` and the shared
`src/ui/BrandMark.tsx` artwork come from the earlier Splitnext app. The app
renders the mark on the groups list and the join screen.
