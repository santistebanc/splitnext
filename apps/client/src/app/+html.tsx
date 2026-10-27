import { type ReactNode } from 'react';
import {
  ScrollViewStyleReset,
  useServerDocumentContext,
} from 'expo-router/html';
import { colors } from '../ui/theme';

type DocumentProps = { children: ReactNode };

export default function DocumentRoot(props: DocumentProps) {
  const document = useServerDocumentContext();

  return (
    <html lang="en" {...document.htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, interactive-widget=resizes-content"
        />
        <title>Splitnext · Your people, together</title>
        <meta
          name="description"
          content="Bring your group together. Create a group, add your people, and invite friends. No account needed."
        />
        <meta name="theme-color" content={colors.background} />
        <meta name="color-scheme" content="light" />
        <link rel="preload" href="/assets/instrument-sans.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/assets/geist-mono.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <ScrollViewStyleReset />
        {/* React Native Web removes outlines from some controls; keep a
            visible keyboard focus indicator everywhere. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              '@font-face{font-family:"Instrument Sans";src:url(/assets/instrument-sans.woff2) format("woff2");font-style:normal;font-weight:400 700;font-display:swap}' +
              '@font-face{font-family:"Geist Mono";src:url(/assets/geist-mono.woff2) format("woff2");font-style:normal;font-weight:400 700;font-display:swap}' +
              `html,body{background:${colors.background};color-scheme:light;-webkit-font-smoothing:antialiased}` +
              `:focus-visible{outline:3px solid ${colors.action}!important;outline-offset:2px}` +
              // Fields show focus by their caret over the ink underline, as the design draws them.
              'input:focus-visible,textarea:focus-visible{outline:none!important}',
          }}
        />
        {document.headNodes}
      </head>
      <body {...document.bodyAttributes}>
        {props.children}
        {document.bodyNodes}
      </body>
    </html>
  );
}
