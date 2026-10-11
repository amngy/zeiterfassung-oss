// Sign-in outcomes the login form has to tell apart (#14). Thrown from the
// credentials `authorize` in src/auth.ts; Auth.js passes them through to the
// server-side signIn() call unchanged, `code` included. Every other failure
// stays a plain CredentialsSignin with the one generic message.

import { CredentialsSignin } from "next-auth";

/** Password correct; the account has a second factor and none was sent. */
export class SecondFactorRequired extends CredentialsSignin {
  code = "2fa_required";
}

/** Password correct; the code was wrong or already used. */
export class SecondFactorInvalid extends CredentialsSignin {
  code = "2fa_invalid";
}

/** Too many wrong codes in a row — the second factor is blocked for a while. */
export class SecondFactorBlocked extends CredentialsSignin {
  code = "2fa_blocked";
}
