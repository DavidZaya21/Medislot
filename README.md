# Medislot

Medislot is a full-stack medical appointment scheduling project.

## Project Idea

The system supports four roles:

- `PATIENT`
- `DOCTOR`
- `RECEPTIONIST`
- `ADMIN`

Main workflow:

- Patients register themselves
- Public registration creates only `PATIENT` accounts
- Admin creates doctor and receptionist accounts
- Patients choose a free calendar slot when making an appointment
- The system checks slot availability automatically and creates a `CONFIRMED` appointment
- Receptionists can manually create phone-booked appointments
- Receptionists manage daily operations such as cancellations, patient check-in, and `NO_SHOW` marking
- Doctors view confirmed appointments and finished visits can be marked as `COMPLETED`

## Technical Stack

- **Frontend:** Next.js + TypeScript
- **Backend:** NestJS + TypeScript
- **Database:** Supabase PostgreSQL
- **ORM:** Prisma
- **Authentication:** JWT
- **API Spec:** OpenAPI YAML

## Repository Structure

- `frontend/` - Next.js application for patient and staff interfaces
- `backend/` - NestJS API application
- `prisma/` - shared Prisma schema and migrations
- `docs/openapi.yaml` - API contract used in Swagger UI

## Database Design

The database currently uses 3 main tables:

- `User`
- `Calendar`
- `Appointment`

Key design ideas:

- all accounts are stored in `User`
- doctors use `role = DOCTOR` and store `specialization` directly in `User`
- `Calendar` stores doctor time slots and availability
- appointments connect a patient, a doctor, and one selected calendar slot
- role-based access is controlled by the `role` column in `User`

## API Design

The OpenAPI file is located at:

- [docs/openapi.yaml](/Users/davidzayar/Desktop/Medislot/docs/openapi.yaml)

The API is designed around resource-based endpoints such as:

- `/users`
- `/doctors`
- `/receptionists`
- `/appointments`
- `/sessions`

Filtering should be done with query parameters where appropriate, for example:

- `/appointments?status=CONFIRMED`

## Development Commands

Install dependencies:

```bash
npm install
```

Run the NestJS backend:

```bash
npm run dev:backend
```

Run the Next.js frontend:

```bash
npm run dev:frontend
```

Build the full workspace:

```bash
npm run build
```

## Prisma Commands

```bash
npm run prisma:migrate -- --name init
npm run prisma:generate
```

## Development Notes

- Swagger/OpenAPI is served by the NestJS backend at `/docs`
- Prisma migrations should be used to create and update the database schema
- Tables should not be created manually
- Backend authorization will control which roles can access which endpoints
- The frontend and backend are separated so the UI can evolve independently from the API
