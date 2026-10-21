import { NextRequest, NextResponse } from "next/server";

const FLASK = process.env.FLASK_URL ?? "http://127.0.0.1:5000";
const LOGIN = process.env.FLASK_LOGIN_PATH ?? "/login";

/** Forwards the credentials to Flask's existing login form and relays its session cookie. */
export async function POST(req: NextRequest) {
  const { user, password, remember } = await req.json();
  const body = new URLSearchParams({ user: String(user ?? ""), password: String(password ?? "") });
  if (remember) body.set("remember", "1");

  const r = await fetch(`${FLASK}${LOGIN}`, {
    method: "POST",
    body,
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  // Flask redirects on success and re-renders the form (HTTP 200) on failure.
  if (r.status >= 300 && r.status < 400) {
    const res = NextResponse.json({ ok: true });
    for (const c of r.headers.getSetCookie()) res.headers.append("set-cookie", c);
    return res;
  }

  const html = await r.text();
  const m = html.match(/class="auth-error"[\s\S]*?<span>([\s\S]*?)<\/span>/);
  return NextResponse.json({ ok: false, error: m?.[1]?.trim() || "Invalid credentials." }, { status: 401 });
}
