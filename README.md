# AAOptom 2026 contact lookup

Internal EVOQ tool for AAOptom 2026. Staff search the COTO CRM, open a contact, and save an inquiry as a separate contact note. COTO stays the source of truth. The browser never receives the private integration token.

## Local setup

Requires Node.js 22+.

```bash
npm install
cp .env.example .env
npm run staff:add -- --name "Alex Rivera" --email "alex@evoq.example" --password "use-a-long-password"
npm run dev
```

Open http://localhost:5173. The API runs on port 3001 and the Vite dev server proxies `/api`.

`staff:add` creates or updates `data/staff.json`. That file is gitignored. Run the command again with the same email to reset a password. Passwords must be at least 12 characters. You can also set `STAFF_NAME`, `STAFF_EMAIL`, and `STAFF_PASSWORD` instead of arguments.

`npm run staff:list` prints names and emails only.

## COTO configuration

Put the private integration token only in the server `.env`:

```bash
COTO_PRIVATE_INTEGRATION_TOKEN=your_token
COTO_USE_MOCK=false
```

Do not put the token in frontend env vars, source control, or chat. If the token is missing, local development uses clearly labeled mock contacts. Production refuses to start in mock mode.

Verified read operations use the same request you already tested:

`POST https://services.leadconnectorhq.com/contacts/search`

with `locationId`, `page`, `pageLimit`, and `query`, plus `Authorization: Bearer` and `Version: 2021-07-28`.

These additional official endpoints are implemented:

| Action | Method and path | Scope |
| --- | --- | --- |
| Get contact | `GET /contacts/:contactId` | `contacts.readonly` |
| Create contact | `POST /contacts/` | `contacts.write` |
| Update contact | `PUT /contacts/:contactId` | `contacts.write` |
| List notes | `GET /contacts/:contactId/notes` | `contacts.readonly` |
| Create note | `POST /contacts/:contactId/notes` | `contacts.write` |
| Custom fields | `GET /locations/:locationId/customFields?model=contact` | `locations/customFields.readonly` |

`businesses.readonly` and `locations.readonly` are not used. Company name comes from the contact record (`companyName` or `businessName`).

Current HighLevel docs label the version header `v3`. This app sends `2021-07-28` because that is the version your private integration already accepted. Change `COTO_API_VERSION` only if COTO support tells you to.

NPI and professional title are shown only when a contact custom field matches those names, or when `COTO_FIELD_NPI` / `COTO_FIELD_TITLE` is set to the field id. A missing value on a mapped field is shown as "Not provided". An unmapped field is hidden rather than shown as empty.

After the token is in `.env`, run:

```bash
npm run coto:check
```

Set `COTO_TEST_QUERY` and, for a single-contact read, `COTO_TEST_CONTACT_ID`. The script prints counts and field presence, not contact details. It does not create or edit contacts.

## Inquiries

Questions live in `shared/questionnaire.ts`. Each question needs `id`, `label`, `type`, and `required`. Options are required for `single-select` and `multi-select`. Supported types are `short-text`, `long-text`, `single-select`, `multi-select`, and `yes-no`. Follow-up questions can use `visibleWhen` or `attachTo`.

Saving an inquiry creates a new COTO contact note. It does not overwrite earlier notes or description fields. The note starts with `AAOPTOM 2026 INQUIRY` and includes the inquiry id, timestamp, staff name, contact id, each question and answer, and optional general notes. The profile splits those notes from ordinary CRM notes.

The same inquiry id is sent again if a save is retried, so a lost response does not create a second note. The form stays filled in when a save fails.

## Production

```bash
npm ci
npm run build
npm run staff:add -- --name "Alex Rivera" --email "alex@evoq.example" --password "use-a-long-password"
NODE_ENV=production npm start
```

Set `SESSION_SECRET` to at least 32 random characters, set the COTO token, and serve the app over HTTPS. Behind a proxy, set `TRUST_PROXY=true`. Sessions are stored in memory on one server, so run a single instance and expect staff to sign in again after a restart. Keep `data/staff.json` on a persistent volume.

A `Dockerfile` is included. Mount `/app/data` so staff accounts survive redeploys, and pass the environment variables at runtime. Do not bake `.env` into the image.

The "Open in COTO" link uses:

`https://crm.coto.services/v2/location/{locationId}/contacts/detail/{contactId}`

Change `COTO_APP_BASE_URL` if your CRM uses a different path.

## Checks

```bash
npm test
npm run typecheck
```

## Before AAOptom

- Review the booth questionnaire in `shared/questionnaire.ts` before the event.
- Create real staff accounts and remove any test account.
- Confirm the token, location id, and note permissions against one authorized test contact.
- Confirm NPI and title field detection, or set the field id overrides.
- Confirm the COTO contact URL opens the right record.
- Do not run the event on mock mode.
