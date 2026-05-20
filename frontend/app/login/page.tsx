export default function LoginPage() {
  return (
    <main className="simple-page">
      <p className="eyebrow">Authentication</p>
      <h1>JWT login entry point</h1>
      <p>
        All roles authenticate through the same login flow. The frontend will call the NestJS
        `POST /sessions` endpoint and store the returned bearer token.
      </p>
    </main>
  );
}
