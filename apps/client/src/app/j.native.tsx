import { Redirect } from 'expo-router';

/** Keep one native app shell. Startup and the link listener retain the full URL. */
export default function NativeInvite() { return <Redirect href="/app" />; }
