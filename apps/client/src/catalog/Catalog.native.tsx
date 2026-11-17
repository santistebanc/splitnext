import { Redirect } from 'expo-router';

/** The component workbench runs in the browser. Native keeps the real app only. */
export function Catalog() { return <Redirect href="/app" />; }
