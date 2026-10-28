/** Browser connectivity and foreground events at the screen boundary. */
export const browserLifecycle = {
  online: () => navigator.onLine,
  subscribe(online: () => void, foreground: () => void): () => void {
    const visible = () => { if (document.visibilityState === 'visible') foreground(); };

    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    document.addEventListener('visibilitychange', visible);

    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
      document.removeEventListener('visibilitychange', visible);
    };
  },
};
