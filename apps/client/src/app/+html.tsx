import { type ReactNode } from 'react';
import {
  ScrollViewStyleReset,
  useServerDocumentContext,
} from 'expo-router/html';

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
        <meta name="theme-color" content="#246b56" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <ScrollViewStyleReset />
        {/* React Native Web removes outlines from some controls; keep a
            visible keyboard focus indicator everywhere. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              ':focus-visible{outline:2px solid #246b56!important;outline-offset:2px}' +
              'input:focus-visible,textarea:focus-visible{outline-offset:-2px}',
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
