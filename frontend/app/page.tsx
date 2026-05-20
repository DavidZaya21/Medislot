const roleCards = [
  {
    title: "Patient",
    description: "Registers, logs in, and requests appointments that start in PENDING state.",
  },
  {
    title: "Receptionist",
    description: "Reviews pending requests and confirms or cancels them after checking availability.",
  },
  {
    title: "Doctor",
    description: "Views confirmed appointments and manages their schedule from the staff side.",
  },
  {
    title: "Admin",
    description: "Creates doctor and receptionist accounts and controls internal access.",
  },
];

const quickLinks = [
  { label: "Patient registration", href: "/register" },
  { label: "Login", href: "/login" },
  { label: "Doctor dashboard", href: "/doctor/appointments" },
  { label: "Reception desk", href: "/receptionist/appointments" },
  { label: "Admin staff tools", href: "/admin/staff" },
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Medislot</p>
          <h1>Next.js frontend for a role-based medical scheduling system.</h1>
          <p className="lede">
            This workspace now separates the UI from the API. Next.js handles the patient and
            staff views, while the NestJS backend exposes the REST contract and Swagger docs.
          </p>
          <div className="actions">
            <a className="button button-primary" href={process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/docs"}>
              Open API Docs
            </a>
            <a className="button button-secondary" href="/register">
              View Patient Flow
            </a>
          </div>
        </div>
        <div className="hero-panel">
          <h2>Core workflow</h2>
          <ol>
            <li>Patient submits an appointment request.</li>
            <li>Request is stored with status PENDING.</li>
            <li>Receptionist reviews availability.</li>
            <li>Doctor sees only confirmed appointments.</li>
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">Roles</p>
          <h2>Access is driven by the user role stored in the database.</h2>
        </div>
        <div className="grid">
          {roleCards.map((card) => (
            <article className="card" key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">Screens</p>
          <h2>Initial route map</h2>
        </div>
        <div className="link-list">
          {quickLinks.map((link) => (
            <a className="link-card" href={link.href} key={link.href}>
              <span>{link.label}</span>
              <span aria-hidden="true">→</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
