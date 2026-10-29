/**
 * The app's entry. A page that sets `splitnextLabHostPage` before loading it,
 * the local lab, gets the many-device host instead of the router; a lab device's
 * frame, which sets `splitnextLabFramePage`, gets that one device.
 */
declare global {
  interface Window {
    splitnextLabHostPage?: boolean;
    splitnextLabHostMount?: typeof import('./src/lab/host').mountLabHost;
  }
}

if (typeof window !== 'undefined' && window.splitnextLabFramePage) {
  require('./src/lab/frame').mountLabFrame();
} else if (typeof window !== 'undefined' && window.splitnextLabHostPage) {
  window.splitnextLabHostMount = require('./src/lab/host').mountLabHost;
} else {
  require('expo-router/entry');
}

export {};
