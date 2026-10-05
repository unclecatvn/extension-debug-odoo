// The Odoo session cookie, as far as the panel may see it.

/** session_id cookie flags only: the token value never leaves this function. */
export async function cookieFlags(url: string) {
  try {
    const c = await chrome.cookies.get({ url, name: 'session_id' });
    return c && { httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, session: c.session };
  } catch {
    return null;
  }
}
