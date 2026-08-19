# Putting Cosign somewhere

One Node process, one SQLite file, no services. This is the whole of it.

Everything below is a decision somebody has to make with an account in their own
name — a domain, a machine, a certificate — which is why it is a document rather
than a script.

## What it needs

| | |
|---|---|
| Node | **24 or newer.** Persistence is the built-in `node:sqlite`; 22 will not start. |
| Disk | The database is one file. The seeded build is ~330 kB. |
| Network | One port. Put a TLS terminator in front of it. |
| Anything else | Nothing. No database server, no Redis, no object store, no API key. |

## The five environment variables

Only the first three matter, and getting `COSIGN_RP_ID` wrong is the one that
breaks passkeys in a way that looks like a bug in the browser.

```sh
NODE_ENV=production          # turns the credential-free user switcher OFF
COSIGN_RP_ID=cosign.example  # the REGISTRABLE DOMAIN, no scheme, no port, no path
COSIGN_ORIGINS=https://cosign.example    # every origin allowed to sign in, comma separated
PORT=8787                    # default
COSIGN_DB=/var/lib/cosign/cosign.db      # default is server/data/cosign.db
```

**`COSIGN_RP_ID` is a domain, not a URL.** `cosign.example`, never
`https://cosign.example`. A passkey is bound to it forever: change it later and
every passkey anybody has registered stops working, with no way to migrate them,
because the binding is inside a credential stored on somebody else's phone.
Pick the domain you intend to keep.

If you serve both the apex and `www`, put **both** in `COSIGN_ORIGINS` and set
`COSIGN_RP_ID` to the apex (`cosign.example`) — a passkey registered against the
apex works on the subdomain, and the reverse is not true.

**Do not set `COSIGN_DEV_AUTH`.** It re-opens `POST /api/auth/switch`, which
hands out a session for any user id with no credential at all. It exists so the
e2e suites can sign in. In production its absence is the security model.

## HTTPS is not optional

WebAuthn requires a secure context, so passkeys work on `https://` and on
`http://localhost` and nowhere else. Over plain HTTP on a LAN address the sign-in
button does not appear at all — `src/lib/passkey.ts` checks `isSecureContext` and
the front door says why instead of rendering a control that throws.

Terminate TLS in front of the process (Caddy will do it in three lines; nginx or
a cloud load balancer are equally fine) and forward to `PORT`. Nothing in the app
reads `X-Forwarded-*`; it does not need to.

## Running it

```sh
git clone <this repo> && cd cosign/cosign-app
npm ci
npm run seed          # once, and only once — it builds the database from seed/
NODE_ENV=production COSIGN_RP_ID=cosign.example \
  COSIGN_ORIGINS=https://cosign.example npm run prod
```

`npm run prod` builds the SPA and then serves it, the SSR share and profile
pages, and the JSON API from the one process.

Keep it alive with whatever the machine already has — systemd, `pm2`, a Docker
restart policy. There is deliberately no unit file or Dockerfile in the repo:
either would be a guess about somebody else's machine.

## Check these four things after the first deploy

```sh
# 1. the credential-free door is SHUT (this is the one that matters)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{"userId":"u_maya"}' \
  https://cosign.example/api/auth/switch
# expect 403

# 2. the roster is not readable
curl -s https://cosign.example/api/auth/users
# expect {"users":[],"dev_auth":false}

# 3. sign-in options exist and name nobody
curl -s -X POST -H 'content-type: application/json' -d '{}' \
  https://cosign.example/api/auth/passkey/authenticate/options
# expect a challenge, an rpId that matches your domain, and NO allowCredentials

# 4. a share link renders logged out
curl -s -o /dev/null -w '%{http_code}\n' https://cosign.example/s/<a-token>
# expect 200
```

Then register a passkey on your own phone and sign in with it. That is the one
test nothing in `evidence/` can do for you.

## Backups

Stop the process, copy the file, start it again. The database is a lock while
the server holds it, so copying a live one can give you a torn read.

```sh
systemctl stop cosign && cp /var/lib/cosign/cosign.db /backups/cosign-$(date +%F).db && systemctl start cosign
```

`server/data/` also holds `cookie-secret.txt`, generated on first run. Losing it
signs everybody out; it is not otherwise precious. Uploaded log photos live in
`server/data/uploads/` and are not in the database — back up the directory, not
just the file.

## What is NOT solved, and you should decide before real people arrive

**There is no account recovery.** A person whose only passkey is on a phone they
lost cannot get back in, and nobody can let them in, because there is nobody
here — no email to send a link to, no support inbox, no admin. That is what
"zero external services" costs, and it is a real cost.

What the product does about it today: the profile screen says plainly how many
devices open the account, tells a person with one device that there is no way
back, and makes adding a second one a single tap. The server refuses to remove
the last passkey.

The options if that is not enough:
1. **Recovery codes.** Generated at signup, shown once, stored hashed, one-time
   use. Keeps the zero-services rule. Somebody has to actually keep the code.
2. **A person vouches.** Two accepted friends confirm it is you. Fits this
   product's model better than anything else, and is a real design problem, not
   a small one.
3. **Email.** Solves it properly and breaks the rule. It is your rule.

Nothing has been built for any of these — this is written down so the choice is
made deliberately rather than discovered by the first person who drops a phone.
