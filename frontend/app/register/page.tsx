export default function RegisterPage() {
  return (
    <main className="simple-page">
      <p className="eyebrow">Patient Flow</p>
      <h1>Public registration creates only PATIENT accounts.</h1>
      <p>
        In the current architecture, doctors and receptionists are created by admins from the
        protected staff side. This page will later call the NestJS `POST /users` endpoint.
      </p>
    </main>
  );
}
