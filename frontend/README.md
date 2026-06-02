# Medislot Frontend

This is the Next.js GUI for the Medislot API.

## Configuration

The frontend reads the backend URL from:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

This variable should be set in the repository root `.env` file.

## Run

From the repository root:

```bash
npm run dev:frontend
```

The app runs on the Next.js default port:

```text
http://localhost:3000
```

The backend must also be running:

```bash
npm run dev:backend
```

## Implemented GUI Flows

- Login with `POST /sessions`
- Patient registration with `POST /users`
- Role-aware dashboard and navigation
- Paginated and filtered user table using `GET /users`
- Doctor browsing using `GET /doctors`
- Calendar filtering and management using `GET /calendars`, `POST /calendars`, `PUT /calendars/:id`, and `DELETE /calendars/:id`
- Appointment booking and management using `GET /appointments`, `POST /appointments`, `PUT /appointments/:id`, `DELETE /appointments/:id`, and `GET /users/:userId/appointments`
- Admin staff creation using `POST /doctors` and `POST /receptionists`
- Profile viewing and updating using `GET /users/:userId` and `PUT /users/:userId`

## Roles

Navigation changes after login based on the JWT role.

- `ADMIN`: users, doctors, calendars, appointments, staff tools, profile
- `RECEPTIONIST`: users, doctors, appointments, profile
- `DOCTOR`: users, doctors, calendars, appointments, profile
- `PATIENT`: doctors, calendars, own appointments, profile

Frontend checks are for user experience. Backend role guards remain the real security layer.

## Validation

Forms use HTML validation attributes such as:

- `required`
- `type="email"`
- `type="number"`
- `type="date"`
- `type="datetime-local"`
- `min`
- `minLength`
- `maxLength`

