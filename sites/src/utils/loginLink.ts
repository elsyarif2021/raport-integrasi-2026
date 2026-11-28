export function readLoginLinkToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('akses');
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function loginReturnPath(token: string | null): string {
  return token && /^[a-f0-9]{64}$/.test(token) ? '/#akses=' + token : '/';
}
export function readPinLinkSlug(hash:string):string|null {
  const slug=new URLSearchParams(hash.replace(/^#/, '')).get('masuk');
  return slug && /^[a-z0-9][a-z0-9-]{35,159}$/.test(slug)?slug:null;
}
