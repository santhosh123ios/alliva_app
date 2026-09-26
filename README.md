# Alliva

Alliva is a multi-merchant delivery platform for Bahrain. Customers discover local businesses, order for delivery, takeaway, or dine-in, pay, and track orders. Staff, operations, and merchants use separate web portals on one NestJS API.

Currency is **BHD** (3 decimal places). The platform timezone is **Asia/Bahrain**. Interfaces are English and Arabic, with RTL for Arabic.

## Assumptions

- Money is stored as `Decimal(19, 3)`. The API recalculates prices, tax, discounts, commissions, and totals. The browser never decides what a customer pays.
- Staff and merchants sign in with email and password. Customers sign in with a Bahrain mobile OTP. In development the SMS provider logs the code and accepts `123456`.
- Access tokens last 15 minutes. Refresh tokens rotate and live in HTTP-only cookies. A readable CSRF cookie must be echoed as `x-csrf-token` on mutations.
- Finance manager demo login asks for a second factor. The development code is `000000`.
- Tap, BENEFIT, Google Maps, Firebase, email, and S3 are provider interfaces with development mocks. No live secrets are shipped.
- Subscription features are database rows (`key` + JSON `value`). Visibility is `MARKETPLACE` or `EXCLUSIVE_STOREFRONT`.
- Marketing commission is created only when a referred merchant's subscription payment is verified. Recruitment alone does not pay commission.
- Ledger rows are append-only. A Postgres trigger rejects updates and deletes.
- PostGIS geography columns sit beside latitude and longitude. Nearby search uses distance sorting and can use `ST_DWithin` when the extension is present.
- Admin and Operations share `apps/admin-web`. Merchant tools are `apps/merchant-web`. Customers use the installable `apps/customer-web` PWA.
- An exclusive storefront session hides other merchants after a merchant QR or dedicated link is opened.
- Demo businesses are fictional. They are not real Bahrain brands.

## Apps

| App | URL | Package |
| --- | --- | --- |
| Customer | http://localhost:3000 | `@alliva/customer-web` |
| Admin and operations | http://localhost:3001 | `@alliva/admin-web` |
| Merchant | http://localhost:3002 | `@alliva/merchant-web` |
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

## Tests

```bash
pnpm --filter @alliva/api test
pnpm e2e
```

Unit tests cover pricing, the order state machine, entitlements, marketing commission, and the ledger. Integration tests for login, orders, and payment webhooks run when `DATABASE_URL` points at a migrated database.

## Deployment

1. Provision PostgreSQL with PostGIS and Redis.
2. Set the variables in `.env.example`. Use a long `JWT_ACCESS_SECRET`, a 32-byte `ENCRYPTION_KEY`, and real provider secrets.
3. Set `COOKIE_SECURE=true` and `NODE_ENV=production`.
4. Run `pnpm db:migrate` and start the API with `pnpm --filter @alliva/api start`.
5. Build the three Next.js apps and serve them behind HTTPS. Point `API_INTERNAL_URL` at the API so browser cookies stay on each portal origin.
6. Put uploads on S3 by setting `STORAGE_DRIVER=s3`.

Business rules stay in the NestJS services. React portals call the typed client in `@alliva/api-client`.
