export const usesSharedBackend = import.meta.env.VITE_RAPORT_HOST === 'vercel'
  || (typeof window !== 'undefined' && /^(raport-integrasi-2026|raport-integrasi-2627)\.vercel\.app$/.test(window.location.hostname));
export const ownerAccessUrl='https://raport-pondok.abumumtaz.chatgpt.site/';
