# Alliva

Alliva is a multi-merchant delivery platform for Bahrain. Customers discover local businesses, order for delivery, takeaway, or dine-in, pay, and track orders. Staff, operations, and merchants use separate web portals on one Node.js API.

The API is Express on Node.js with Prisma and PostgreSQL. The portals are React single-page apps built with Vite and React Router.

Currency is **BHD** (3 decimal places). The platform timezone is **Asia/Bahrain**. Interfaces are English and Arabic, with RTL for Arabic.

## Assumptions

- Money is stored as `Decimal(19, 3)`. The API recalculates prices, tax, discounts, commissions, and totals. The browser never decides what a customer pays.
- Staff and merchants sign in with email and password. Customers sign in with a Bahrain mobile OTP sent on WhatsApp. In development, with no WhatsApp token, the API logs the code and accepts `123456`.
- Access tokens last 15 minutes. Refresh tokens rotate and live in HTTP-only cookies. A readable CSRF cookie must be echoed as `x-csrf-token` on mutations.
- Finance manager demo login asks for a second factor. The development code is `000000`.
- Tap, BENEFIT, Google Maps, Firebase, email, and S3 are provider interfaces with development mocks. No live secrets are shipped.
- Subscription features are database rows (`key` + JSON `value`). Visibility is `MARKETPLACE` or `EXCLUSIVE_STOREFRONT`.
- Marketing commission is created only when a referred merchant's subscription payment is verified. Recruitment alone does not pay commission.
- Ledger rows are append-only. A Postgres trigger rejects updates and deletes.
- PostGIS geography columns sit beside latitude and longitude. Nearby search uses distance sorting and can use `ST_DWithin` when the extension is present.
- Admin and Operations share `apps/admin-web`. Marketing staff use `apps/marketing-web`. Merchant tools are `apps/merchant-web`. Customers use the installable `apps/customer-web` PWA.
- An exclusive storefront session hides other merchants after a merchant QR or dedicated link is opened.
- Demo businesses are fictional. They are not real Bahrain brands.

## Apps

| App | URL | Package |
| --- | --- | --- |
| Customer | http://localhost:3000 | `@alliva/customer-web` |
| Admin and operations | http://localhost:3001 | `@alliva/admin-web` |
| Merchant | http://localhost:3002 | `@alliva/merchant-web` |
| Marketing staff | http://localhost:3003 | `@alliva/marketing-web` |
| API and Swagger | http://localhost:4000/api/docs | `@alliva/api` |

## Setup

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm db:migrate` applies the committed PostGIS migration. The schema lives in `apps/api/prisma/schema`, and the migration lives beside it. The API, seed, and tests read `DATABASE_URL` from the repository `.env`.

## Demo accounts

Password for every staff and merchant account: `Alliva123!`

| Email | Role |
| --- | --- |
| superadmin@alliva.bh | Super Admin |
| admin@alliva.bh | Admin |
| ops.manager@alliva.bh | Operations Manager |
| ops.staff@alliva.bh | Operations Staff |
| marketing.head@alliva.bh | Marketing Head |
| marketing.staff@alliva.bh | Marketing Staff |
| finance.manager@alliva.bh | Finance Manager (2FA code `000000`) |
| finance.staff@alliva.bh | Finance Staff |
| support@alliva.bh | Customer Support |
| owner@saffronhouse.bh | Merchant Owner, Saffron House |
| manager@saffronhouse.bh | Merchant Manager |
| orders@saffronhouse.bh | Order-Taking Staff |
| kitchen@saffronhouse.bh | Kitchen Staff |
| billing@saffronhouse.bh | Billing Staff |
| driver@saffronhouse.bh | Delivery Staff |
| reports@saffronhouse.bh | Report Viewer |

Customer phone: `+97336000001`. Development OTP: `123456`.

Promo code: `WELCOME10` (10 percent, max 2.000 BHD, minimum 5.000, first order).

QR codes: `SAFFRON`, `TABLE12`, `NIGHTSOUQ` (exclusive storefront).

## Marketing management

Hierarchy: Super Admin, Marketing Head, Marketing Staff, referred stores. The same console (`packages/marketing-console`) serves all three roles; what each role sees is decided by the API.

| Who | Where |
| --- | --- |
| Admin | Admin portal, **Marketing** group in the sidebar (heads, staff, leads, appointments, referral tracking, commissions, wallets and withdrawals, promo codes, reports, activity, settings) |
| Head and staff | Marketing portal (`apps/marketing-web`) |

Rules enforced by the API (`apps/api/src/modules/marketing`):

- A **referral code** (`ALV-XXXXXX`, one per staff member) attributes a store. A **promo code** is a subscription discount. They are separate fields and never substitute for each other.
- Commission is created only for a store's **first verified** subscription payment. An admin marks a payment as paid (Subscriptions, Merchant subscriptions, **Payments**); that is the verification. Renewals and unverified payments never earn commission.
- Rates are read from settings (defaults 10% staff, 1% head), copied onto each commission when it is created, and a later change affects future payments only.
- Verification is idempotent (a conditional claim on the referral row and a unique key per payment and tier), so concurrent calls credit once.
- Refunds (full or partial) reverse commission in proportion. If it was already withdrawn, the shortfall is recorded as recovery debt and netted against later credits.
- The wallet ledger is the source of truth for pending, available, reserved and recovery balances. Withdrawals go through requested, review, approved, processing and paid (or rejected or cancelled); reserved funds return on rejection.
- A staff member sees only their own records; a head sees their team; anything out of scope answers 404.
- Reminders for appointments and follow-ups are in-app notifications created by a scheduler in the API (`MARKETING_JOBS_ENABLED`, default on). There is no SMS, email or WhatsApp delivery for them.
- Invitations: creating a head or staff member returns a one-time link to `/<locale>/reset?token=...` on the marketing portal. Share it with the person; it is not emailed.
- There is no payment gateway integration for subscriptions. "Mark as paid" is the verification step and "Refund" records the refund in the system; moving money is done outside Alliva.

### Database changes

The marketing work adds two migrations, both additive: `20261020140000_marketing_team` and `20261021090000_marketing_system`. Nothing is dropped (the only column changes relax `NOT NULL`). Existing promo codes assigned to staff (for example `OMAR20`) stay as ordinary promo codes, and existing referral codes are copied into the new referral code table so earlier attributions keep working.

```bash
pnpm db:migrate   # applies both migrations (prisma migrate deploy)
pnpm db:seed      # only for a fresh or demo database
```

Apply the migrations to a hosted database yourself after reviewing the SQL in `apps/api/prisma/schema/migrations`. Back the database up first.

## Tests

```bash
pnpm --filter @alliva/api test
pnpm e2e
```

Unit tests cover pricing, the order state machine, entitlements, marketing commission, reversal, wallet and promo rules, and reminders. Integration tests (`apps/api/test`) run against a real Postgres and cover attribution, verification, idempotency under concurrency, refunds, wallet and withdrawals, reports and authorization. They create users, stores and payments, so the marketing suite **only runs when `DATABASE_URL` points at localhost**.

End-to-end tests (`e2e/`) drive the portals in a browser. The marketing specs create leads and stores; point them at a throw-away database through `E2E_ADMIN_URL`, `E2E_MERCHANT_URL` and `E2E_MARKETING_URL`, and use `E2E_CHANNEL=chrome` to reuse an installed Chrome. The API allows 10 sign-ins per minute, so wait a minute between runs.

## Deployment

1. Provision PostgreSQL with PostGIS and Redis.
2. Set the variables in `.env.example`. Use a long `JWT_ACCESS_SECRET`, a 32-byte `ENCRYPTION_KEY`, and real provider secrets.
3. Set `COOKIE_SECURE=true` and `NODE_ENV=production`.
4. Run `pnpm db:migrate` and start the API with `pnpm --filter @alliva/api start`.
5. Build the web apps with `pnpm build`. Each app writes static files to `apps/<app>/dist`. Set `VITE_API_URL` at build time to the public API URL used for live order updates.
6. Serve each `dist` folder behind HTTPS. Send unknown paths to `index.html`, and proxy `/api` and `/uploads` on the same origin to the API so browser cookies stay on each portal origin. `pnpm --filter <app> preview` does this locally, using `API_INTERNAL_URL` as the proxy target.
7. Put uploads on S3 by setting `STORAGE_DRIVER=s3`.

Business rules stay in the API services. React portals call the typed client in `@alliva/api-client`.
