# Medislot

Medislot is a full-stack medical appointment scheduling project. It includes a NestJS REST API, a Next.js frontend, Prisma migrations, and an OpenAPI contract served through Swagger UI.

## Tech Stack

- Backend: NestJS, TypeScript
- Frontend: Next.js, TypeScript
- Database: Supabase PostgreSQL
- ORM: Prisma
- Authentication: JWT bearer tokens
- API docs: OpenAPI YAML and Swagger UI

## Repository Structure

- `backend/` - NestJS API application
- `frontend/` - Next.js application
- `prisma/` - Prisma schema and migrations
- `docs/openapi.yaml` - OpenAPI contract used by Swagger UI

## Roles

The API supports these roles:

- `PATIENT`
- `DOCTOR`
- `RECEPTIONIST`
- `ADMIN`

Public registration only creates `PATIENT` accounts. Admin users create doctor and receptionist accounts through protected API endpoints.

## Configuration

Create a `.env` file in the repository root. You can start from `.env.example`:

```bash
cp .env.example .env
```

Required variables:

```bash
DATABASE_URL="postgresql://..."
```

`DATABASE_URL` should point to your Supabase PostgreSQL database. 

## Install

Use Node.js `v22.12.0`. The repository includes `.nvmrc`, so you can switch to the expected version with:

```bash
nvm use
```

Then install workspace dependencies:

```bash
npm install
```

## Database Setup

Generate Prisma client:

```bash
npm run prisma:generate
```

Apply migrations to the configured database:

```bash
npm run prisma:migrate
```

## Running The App

Start the backend in development mode:

```bash
npm run dev:backend
```

Start the frontend:

```bash
npm run dev:frontend
```

Build everything:

```bash
npm run build
```

Run the compiled backend:

```bash
npm run build:backend
npm --workspace backend run start
```

## API Documentation

When the backend is running, Swagger UI is available at:

```text
http://localhost:4000/docs
```

The raw OpenAPI file is available at:

```text
http://localhost:4000/openapi.yaml
```

## Authentication

Create a session by calling:

```http
POST /sessions
```

Example body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Use the returned token on protected endpoints:

```http
Authorization: Bearer <accessToken>
```

Expected behavior:

- Missing or invalid token returns `401 Unauthorized`
- Valid token with the wrong role returns `403 Forbidden`
- `GET /users` is allowed for `ADMIN`, `RECEPTIONIST`, and `DOCTOR`
- `GET /users` is blocked for `PATIENT`
- `GET /users` supports `role`, `search`, `page`, and `pageSize` query parameters for filtered pagination
- Patients can only access their own user profile and their own appointment list
- `GET /doctors` is allowed for patients so they can browse doctors before booking

## Account Creation Notes

Patient accounts are created publicly through:

```http
POST /users
```

Doctor accounts are created by admins through:

```http
POST /doctors
```

Receptionist accounts are created by admins through:

```http
POST /receptionists
```

Duplicate emails return:

```json
{
  "message": "Email is already registered",
  "code": "CONFLICT"
}
```

## Main Workflows

- Patients register themselves
- Patients browse doctors and available calendar slots
- Patients book appointments into free calendar slots
- The API checks slot availability before creating appointments
- Doctors manage their calendar slots
- Receptionists can create and manage appointments
- Admins manage staff accounts

## Testing And Validation

Run backend tests:

```bash
npm run test:backend
```

Run backend type checks:

```bash
npm run lint:backend
```

Run all configured checks:

```bash
npm run lint
npm run build
```

## Useful Endpoints

- `GET /health` - health check
- `POST /sessions` - login and receive a JWT
- `POST /users` - register a patient
- `GET /users` - list users for staff roles with pagination and filtering
- `GET /doctors` - list doctors
- `POST /doctors` - create a doctor as admin
- `POST /receptionists` - create a receptionist as admin
- `GET /calendars` - list calendar slots
- `POST /appointments` - create an appointment

## Disruption notifications and local email capture

See [notification/email local setup](docs/notification-email-local.md) for the disposable
PostgreSQL/Mailpit setup, explicit worker configuration, retry/lease policy, SMTP
delivery limitations, approved reference detachment and unfinished account-closure work.
No real-provider transport is enabled in this milestone. Do not apply its migration to
Supabase until separately authorized.

## Reception follow-up

See [reception follow-up](docs/reception-follow-up.md) for case deadlines, role scope,
phone privacy, manual contact records, migration preservation and disposable tests.
Migration `20261123000000_reception_follow_ups` is pending separate Supabase deployment authorization.

Patient account closure, retained history, token invalidation and email limitations: [implementation notes](docs/patient-account-closure.md). The closure migration is pending deployment; tests use disposable PostgreSQL only.

Appointment status transitions, audit retention, timing and test evidence: [lifecycle implementation](docs/appointment-lifecycle.md).
